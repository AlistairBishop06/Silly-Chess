const {
  initialState,
  generateLegalMoves,
  applyMoveNoValidation,
  other,
  idxToFile,
  idxToRank,
  toIdx,
} = require("./ChessEngine");
const { RuleManager } = require("./rules/RuleManager");
const { getRuleById } = require("./rules/ruleset");

function cloneSet(set) {
  return new Set([...set]);
}

function serializeBoard(board) {
  return board.map((p) => (p ? { type: p.type, color: p.color, tags: p.tags } : null));
}

function deepCloneState(game) {
  return {
    state: {
      ...game.state,
      board: game.state.board.map((p) => (p ? { ...p, tags: p.tags ? [...p.tags] : undefined } : null)),
      castling: { w: { ...game.state.castling.w }, b: { ...game.state.castling.b } },
    },
    ply: game.ply,
    permanent: { ...game.permanent },
    hazards: { deadly: [...game.hazards.deadly], lava: [...game.hazards.lava] },
    missingSquares: [...game.missingSquares],
    extraMoves: { ...game.extraMoves },
    shield: { ...game.shield },
    marks: { lightning: [...(game.marks?.lightning || [])] },
  };
}

class Game {
  constructor({ roomCode }) {
    this.roomCode = roomCode;
    this.started = false;
    this.players = []; // {id,name,color}

    this.state = initialState();
    this.ply = 0;
    this.phase = "lobby"; // "lobby" | "play" | "ruleChoice"
    this.result = null;

    this.ruleManager = new RuleManager(this);
    this.ruleChoicesByPlayerId = {};
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = null;

    this.ruleChoiceEveryPlies = Math.max(1, Number(process.env.RULE_CHOICE_EVERY_PLIES || 3));
    this.ruleChoiceDurationMs = Math.max(5_000, Number(process.env.RULE_CHOICE_DURATION_MS || 30_000));

    this.effects = [];
    this.effectSeq = 1;

    this.visualFlipPlies = 0;
    this.extraMoves = { w: 0, b: 0 };
    this.shield = { w: 0, b: 0 };
    this.permanent = {
      wrapEdges: false,
      gravity: false,
      bishopsRookLike: false,
      forcedKingMove: false,
      allPiecesKingLike: false,
      chainExplosions: false,
    };

    this.hazards = { deadly: new Set(), lava: new Set() };
    this.missingSquares = new Set();
    this.marks = { lightning: new Set() };

    this.lastMoveSquares = [];

    this.trailBlocks = []; // squares created by trails rule
    this.requestTimeReverse = 0;
    this.history = []; // snapshots for time reversal

    this.onRuleEnded = (ruleId) => {
      if (ruleId === "dur_trails_6") {
        for (const sq of this.trailBlocks) {
          if (this.state.board[sq]?.color === "x") this.state.board[sq] = null;
        }
        this.trailBlocks = [];
      }
      if (ruleId === "dur_tiles_disappear_6") {
        this.missingSquares = new Set();
      }
    };
  }

  nextEffectId() {
    return `${this.roomCode}-${this.effectSeq++}`;
  }

  clearTransientEffects() {
    // effects are included in state once; client dedupes.
    this.effects = [];
  }

  start(players) {
    this.started = true;
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.phase = "play";
    this.effects.push({ type: "log", id: this.nextEffectId(), text: "Game started." });
  }

  playerColor(playerId) {
    const p = this.players.find((pl) => pl.id === playerId);
    return p?.color || null;
  }

  currentModifiers() {
    const mods = this.ruleManager.computeModifiers();
    // Always pass in missingSquares and shield (shield is consumed during check evaluation).
    mods.missingSquares = this.missingSquares;
    mods.shield = this.shield;
    return mods;
  }

  getLegalDestinations(playerId, from) {
    if (this.phase !== "play" || this.result) return [];
    const color = this.playerColor(playerId);
    if (!color) return [];
    if (color !== this.state.turn) return [];
    if (from == null || from < 0 || from > 63) return [];
    const p = this.state.board[from];
    if (!p || p.color !== color) return [];

    const mods = this.currentModifiers();
    // Mirrored moves: if active, require copying last move if possible.
    if (mods.mirroredMoves && this.state.lastMove) mods.requiredMove = { ...this.state.lastMove };
    const legal = generateLegalMoves(this.state, color, mods);
    return legal.filter((m) => m.from === from).map((m) => m.to);
  }

  chooseRule(playerId, ruleId) {
    if (this.phase !== "ruleChoice") return { ok: false, error: "Not choosing rules right now" };
    if (!this.ruleChoicesByPlayerId[playerId]) return { ok: false, error: "No choices for you" };
    if (this.ruleChosenByPlayerId[playerId]) return { ok: false, error: "Already chosen" };
    if (!this.ruleChoicesByPlayerId[playerId].some((r) => r.id === ruleId)) return { ok: false, error: "Invalid choice" };

    this.ruleChosenByPlayerId[playerId] = ruleId;
    const name = getRuleById(ruleId)?.name || ruleId;
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Rule picked: ${name}` });

    const allChosen = this.players.length === 2 && this.players.every((p) => this.ruleChosenByPlayerId[p.id]);
    if (allChosen) this.applyChosenRulesAndResume();
    return { ok: true };
  }

  applyChosenRulesAndResume() {
    // Apply in stable order: white then black.
    const white = this.players.find((p) => p.color === "w");
    const black = this.players.find((p) => p.color === "b");
    const ids = [];
    if (white) ids.push(this.ruleChosenByPlayerId[white.id]);
    if (black) ids.push(this.ruleChosenByPlayerId[black.id]);
    for (const id of ids) if (id) this.ruleManager.addRule(id);

    this.ruleChoicesByPlayerId = {};
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = null;
    this.phase = "play";
  }

  maybeStartRuleChoice() {
    if (!this.started || this.result) return;
    // Every N combined turns (ply), trigger a choice after the move resolves.
    if (this.ply > 0 && this.ply % this.ruleChoiceEveryPlies === 0) {
      this.phase = "ruleChoice";
      this.ruleChoicesByPlayerId = {};
      this.ruleChosenByPlayerId = {};
      for (const p of this.players) this.ruleChoicesByPlayerId[p.id] = this.ruleManager.randomChoices(3);
      this.ruleChoiceDeadlineMs = Date.now() + this.ruleChoiceDurationMs;
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Rule choice time!" });
    }
  }

  enforceRuleChoiceTimeoutIfNeeded() {
    if (this.phase !== "ruleChoice") return;
    if (this.ruleChoiceDeadlineMs == null) return;
    if (Date.now() < this.ruleChoiceDeadlineMs) return;
    for (const p of this.players) {
      if (this.ruleChosenByPlayerId[p.id]) continue;
      const choice = this.ruleChoicesByPlayerId[p.id] || [];
      const pick = choice[Math.floor(Math.random() * Math.max(1, choice.length))];
      if (pick) this.ruleChosenByPlayerId[p.id] = pick.id;
    }
    this.effects.push({ type: "log", id: this.nextEffectId(), text: "Rule choice timed out; auto-picked." });
    this.applyChosenRulesAndResume();
  }

  applyHazardsAfterMove(toSquare) {
    // Deadly/lava squares destroy pieces that end on them.
    if (this.hazards.deadly.has(toSquare) || this.hazards.lava.has(toSquare)) {
      const p = this.state.board[toSquare];
      if (p && p.color !== "x") {
        this.state.board[toSquare] = null;
        this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [toSquare], reason: "hazard" });
      }
    }
  }

  applyGravityStep() {
    // Gravity pulls toward rank 0 (down on the canvas for both players).
    // One step per ply to keep it playable.
    const moved = [];
    for (let i = 0; i < 64; i++) {
      const p = this.state.board[i];
      if (!p || p.color === "x") continue;
      const f = idxToFile(i);
      const r = idxToRank(i);
      const nr = r - 1;
      if (nr < 0) continue;
      const to = toIdx(f, nr);
      if (this.missingSquares.has(to) || this.state.board[to]) continue;
      moved.push({ from: i, to });
    }
    // Apply bottom-up to avoid cascades in same tick.
    moved.sort((a, b) => idxToRank(a.from) - idxToRank(b.from));
    for (const m of moved) {
      if (!this.state.board[m.from] || this.state.board[m.to]) continue;
      this.state.board[m.to] = this.state.board[m.from];
      this.state.board[m.from] = null;
      this.state.board[m.to].moved = true;
    }
  }

  applyRandomShift() {
    // Shift each rank by -1/0/+1 with wrapping (visual chaos, still deterministic server-side).
    const next = Array(64).fill(null);
    for (let r = 0; r < 8; r++) {
      const shift = [-1, 0, 1][Math.floor(Math.random() * 3)];
      for (let f = 0; f < 8; f++) {
        const from = toIdx(f, r);
        const nf = (f + shift + 8) % 8;
        const to = toIdx(nf, r);
        next[to] = this.state.board[from];
      }
    }
    this.state.board = next;
  }

  refreshVanishingTiles() {
    // Randomly remove ~8 squares, but keep king squares.
    this.missingSquares = new Set();
    const keep = new Set();
    for (let i = 0; i < 64; i++) {
      const p = this.state.board[i];
      if (p?.type === "k") keep.add(i);
    }
    const candidates = [...Array(64).keys()].filter((i) => !keep.has(i));
    while (this.missingSquares.size < 8 && candidates.length) {
      const idx = Math.floor(Math.random() * candidates.length);
      const sq = candidates.splice(idx, 1)[0];
      this.missingSquares.add(sq);
    }
    // Pieces on missing squares vanish.
    for (const sq of this.missingSquares) this.state.board[sq] = null;
  }

  timeReverseNow(plies) {
    const idx = this.history.length - plies;
    const snap = this.history[idx];
    if (!snap) return false;
    this.state = snap.state;
    this.ply = snap.ply;
    this.permanent = { ...snap.permanent };
    this.hazards.deadly = new Set(snap.hazards.deadly);
    this.hazards.lava = new Set(snap.hazards.lava);
    this.missingSquares = new Set(snap.missingSquares);
    this.extraMoves = { ...snap.extraMoves };
    this.shield = { ...snap.shield };
    this.marks = { lightning: new Set(snap.marks?.lightning || []) };
    this.effects.push({ type: "rule", id: this.nextEffectId(), text: `Time reversed ${plies} turns!` });
    return true;
  }

  movePathSquares(from, to) {
    const ff = idxToFile(from);
    const fr = idxToRank(from);
    const tf = idxToFile(to);
    const tr = idxToRank(to);
    const df = tf - ff;
    const dr = tr - fr;

    const absDf = Math.abs(df);
    const absDr = Math.abs(dr);
    const isLine = df === 0 || dr === 0 || absDf === absDr;
    if (!isLine) return [from, to];

    const sf = Math.sign(df);
    const sr = Math.sign(dr);
    const out = [from];
    let f = ff;
    let r = fr;
    while (f !== tf || r !== tr) {
      f += sf;
      r += sr;
      out.push(toIdx(f, r));
      if (out.length > 64) break;
    }
    return out;
  }

  applyIceSlide(from, to) {
    const ff = idxToFile(from);
    const fr = idxToRank(from);
    const tf = idxToFile(to);
    const tr = idxToRank(to);
    const df = tf - ff;
    const dr = tr - fr;

    const absDf = Math.abs(df);
    const absDr = Math.abs(dr);
    const isLine = df === 0 || dr === 0 || absDf === absDr;
    if (!isLine) return to;

    const stepF = Math.sign(df);
    const stepR = Math.sign(dr);
    if (stepF === 0 && stepR === 0) return to;

    let cur = to;
    while (true) {
      const f = idxToFile(cur) + stepF;
      const r = idxToRank(cur) + stepR;
      if (f < 0 || f > 7 || r < 0 || r > 7) break;
      const next = toIdx(f, r);
      if (this.missingSquares.has(next)) break;
      if (this.state.board[next]) break;
      this.state.board[next] = this.state.board[cur];
      this.state.board[cur] = null;
      cur = next;
    }
    return cur;
  }

  applyEchoTrail(pathSquares, movedPiece) {
    if (!movedPiece || movedPiece.color === "x") return;
    if (movedPiece.type === "k") return;

    const clonePiece = (p) => ({
      type: p.type,
      color: p.color,
      moved: true,
      tags: p.tags ? [...p.tags] : undefined,
    });

    for (const sq of pathSquares) {
      if (this.missingSquares.has(sq)) continue;
      if (this.state.board[sq]?.type === "k") continue;
      this.state.board[sq] = clonePiece(movedPiece);
    }
  }

  tryMove(playerId, { from, to, promotion }) {
    this.enforceRuleChoiceTimeoutIfNeeded();
    if (this.phase !== "play") return { ok: false, error: "Not in play phase" };
    if (this.result) return { ok: false, error: "Game over" };
    const color = this.playerColor(playerId);
    if (!color) return { ok: false, error: "Unknown player" };
    if (color !== this.state.turn) return { ok: false, error: "Not your turn" };
    if (from == null || to == null) return { ok: false, error: "Bad move" };

    const piece = this.state.board[from];
    if (!piece || piece.color !== color) return { ok: false, error: "No piece" };

    const mods = this.currentModifiers();
    if (mods.mirroredMoves && this.state.lastMove) mods.requiredMove = { ...this.state.lastMove };
    const legal = generateLegalMoves(this.state, color, mods);
    const isLegal = legal.some((m) => m.from === from && m.to === to);
    if (!isLegal) return { ok: false, error: "Illegal move" };

    // Snapshot for time reversal.
    this.history.push(deepCloneState(this));
    if (this.history.length > 20) this.history.shift();

    const capture = !!this.state.board[to] || (piece.type === "p" && this.state.enPassant != null && to === this.state.enPassant);

    // Apply move.
    const next = applyMoveNoValidation(this.state, { from, to, promotion }, mods);
    this.state = next;
    this.ply += 1;
    let finalTo = to;
    this.lastMoveSquares = [from, to];

    // Consume shield if it would have mattered (next player is in check).
    // We do this lazily: next state's check evaluation will hide it; we decrement when it prevented check.
    const wouldCheckNext = require("./ChessEngine").isInCheck(this.state, this.state.turn, { ...mods, shield: { w: 0, b: 0 } });
    if (wouldCheckNext && this.shield[this.state.turn] > 0) this.shield[this.state.turn] -= 1;

    // Clear one-move queen tags when used.
    if (piece.tags?.includes("tempQueen")) {
      // Restore original type after the move.
      const movedPiece = this.state.board[to];
      if (movedPiece && movedPiece._tempOriginalType) {
        movedPiece.type = movedPiece._tempOriginalType;
        delete movedPiece._tempOriginalType;
        movedPiece.tags = (movedPiece.tags || []).filter((t) => t !== "tempQueen");
      }
    }

    // Ice Board: slide moved piece along its move direction.
    if (mods.iceBoard) {
      const movedPiece = this.state.board[finalTo];
      if (movedPiece) {
        finalTo = this.applyIceSlide(from, finalTo);
        this.lastMoveSquares = [from, finalTo];
      }
    }

    // Echo Trail: copy the moved piece along its path.
    if (mods.echoTrail) {
      const movedPiece = this.state.board[finalTo];
      const path = this.movePathSquares(from, finalTo);
      this.applyEchoTrail(path, movedPiece);
    } else if (mods.trails) {
      // Trails: leave blocks behind (but not if Echo Trail filled the origin).
      if (!this.state.board[from] && !this.missingSquares.has(from)) {
        this.state.board[from] = { type: "x", color: "x", moved: true };
        this.trailBlocks.push(from);
      }
    }

    // Captures cause explosions in chain mode.
    if (capture && this.permanent.chainExplosions) {
      const adj = [];
      const f = idxToFile(to);
      const r = idxToRank(to);
      for (let dr = -1; dr <= 1; dr++) {
        for (let df = -1; df <= 1; df++) {
          if (!df && !dr) continue;
          const nf = f + df;
          const nr = r + dr;
          if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
          adj.push(toIdx(nf, nr));
        }
      }
      for (const sq of adj) {
        const p = this.state.board[sq];
        if (p && p.type !== "k") this.state.board[sq] = null;
      }
      this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [to, ...adj], reason: "chain" });
    }

    // Respawn as pawns (duration mod): captured piece returns as pawn on home rank.
    if (capture && mods.respawnAsPawn) {
      const homeRank = color === "w" ? 1 : 6;
      for (let f = 0; f < 8; f++) {
        const sq = toIdx(f, homeRank);
        if (!this.state.board[sq] && !this.missingSquares.has(sq) && !this.hazards.deadly.has(sq)) {
          this.state.board[sq] = { type: "p", color, moved: true, tags: ["respawned"] };
          break;
        }
      }
    }

    // Shapeshifters: randomize moved piece type (exclude king).
    if (mods.randomTypeAfterMove) {
      const p2 = this.state.board[finalTo];
      if (p2 && p2.type !== "k" && p2.color !== "x") {
        const types = ["p", "n", "b", "r", "q"];
        p2.type = types[Math.floor(Math.random() * types.length)];
      }
    }

    // Hazards after move.
    this.applyHazardsAfterMove(finalTo);

    // Gravity / shifting / vanishing tiles after move.
    if (mods.gravity || this.permanent.gravity) this.applyGravityStep();
    if (mods.randomShift) this.applyRandomShift();
    if (mods.vanishingTiles) this.refreshVanishingTiles();

    // Move-twice: grant extra move to the player who just moved.
    if (mods.moveTwice) this.extraMoves[color] += 1;

    // Extra move counters override turn switch.
    if (this.extraMoves[color] > 0) {
      this.extraMoves[color] -= 1;
      this.state.turn = color;
      this.effects.push({ type: "log", id: this.nextEffectId(), text: `${color === "w" ? "White" : "Black"} gets an extra move.` });
    }

    // Visual flip countdown.
    if (this.visualFlipPlies > 0) this.visualFlipPlies -= 1;

    // Time reversal request (delayed rule) triggers after move resolution.
    if (this.requestTimeReverse > 0) {
      this.requestTimeReverse -= 1;
      if (this.requestTimeReverse === 0) {
        this.timeReverseNow(2);
      }
    }

    // Tick rules after ply.
    this.ruleManager.tickAfterPly();

    // Check game end.
    const nextColor = this.state.turn;
    const endMods = this.currentModifiers();
    const nextLegal = generateLegalMoves(this.state, nextColor, endMods);
    const inCheck = require("./ChessEngine").isInCheck(this.state, nextColor, endMods);
    if (nextLegal.length === 0) {
      this.result = inCheck ? `${nextColor === "w" ? "White" : "Black"} is checkmated.` : "Stalemate.";
      this.effects.push({ type: "log", id: this.nextEffectId(), text: this.result });
    }

    this.maybeStartRuleChoice();
    return { ok: true };
  }

  toClientState() {
    this.enforceRuleChoiceTimeoutIfNeeded();
    const mods = this.currentModifiers();
    const inCheck = require("./ChessEngine").isInCheck(this.state, this.state.turn, mods);
    const checkLabel = inCheck ? (this.state.turn === "w" ? "White" : "Black") : null;

    // Invisible pieces: show only kings + last move squares.
    let visibleSquares = null;
    if (mods.invisiblePieces) {
      visibleSquares = new Set(this.lastMoveSquares);
      for (let i = 0; i < 64; i++) if (this.state.board[i]?.type === "k") visibleSquares.add(i);
    }

    const hazards = {
      deadly: [...this.hazards.deadly],
      lava: [...this.hazards.lava],
    };

    const marks = {
      lightning: [...(this.marks?.lightning || [])],
    };

    return {
      started: this.started,
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
      board: serializeBoard(this.state.board),
      turn: this.state.turn,
      ply: this.ply,
      phase: this.phase,
      result: this.result,
      check: checkLabel,
      activeRules: this.ruleManager.getActiveClientCards(),
      ruleChoicesByPlayerId: this.ruleChoicesByPlayerId,
      ruleChosenByPlayerId: this.ruleChosenByPlayerId,
      ruleChoiceDeadlineMs: this.ruleChoiceDeadlineMs,
      effects: this.effects,
      hazards,
      marks,
      missingSquares: [...this.missingSquares],
      visualFlip: this.visualFlipPlies > 0,
      lastMoveSquares: this.lastMoveSquares,
      invisiblePieces: !!mods.invisiblePieces,
      visibleSquares: visibleSquares ? [...visibleSquares] : null,
      lastMove: this.state.lastMove || null,
    };
  }
}

module.exports = { Game };
