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

const CORNER_SQUARES = new Set([0, 7, 56, 63]); // a1, h1, a8, h8

const HILL_SQUARES = new Set([
  toIdx(3, 3), toIdx(4, 3), toIdx(3, 4), toIdx(4, 4),
]);

const HILL_PROMOTION = { p: "n", n: "b", b: "r", r: "q", q: "q" };

class Game {
  constructor({ roomCode, debugMode = false }) {
    this.roomCode = roomCode;
    this.debugMode = !!debugMode;
    this.ruleChoiceEveryPlies = Math.max(1, Number(process.env.RULE_CHOICE_EVERY_PLIES || 7));
    this.ruleChoiceDurationMs = Math.max(5_000, Number(process.env.RULE_CHOICE_DURATION_MS || 30_000));

    this.initMatchState();
  }

  initMatchState() {
    this.started = false;
    this.players = []; // {id,name,color}

    this.state = initialState();
    this.ply = 0;
    this.phase = "lobby"; // "lobby" | "play" | "ruleChoice" | "rps"

    this.result = null;
    this.resultInfo = null;

    this.readyByPlayerId = {};
    this.rematchId = (this.rematchId || 0) + 1;

    this.ruleManager = new RuleManager(this);
    this.ruleChoicesByPlayerId = {};
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = null;

    this.effects = [];
    this.effectSeq = 1;

    this.visualFlipPlies = 0;
    this.colourBlindPlies = 0;
    this.asteroidPlies = 0;
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

    this.hazards = { deadly: new Set(), lava: new Set(), asteroid: new Set() };
    this.missingSquares = new Set();
    this.marks = { lightning: new Set() };

    this.lastMoveSquares = [];

    this.trailBlocks = [];
    this.requestTimeReverse = 0;
    this.history = [];

    // Mini-games.
    this.rps = null; // { round, byColor:{w,b}, pickedByColor:{w,b}, deadlineMs }

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
    this.effects = [];
  }

  start(players) {
    this.started = true;
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.phase = "play";
    this.result = null;
    this.resultInfo = null;
    this.readyByPlayerId = {};
    this.effects.push({ type: "log", id: this.nextEffectId(), text: "Game started." });
  }

  playerColor(playerId) {
    const p = this.players.find((pl) => pl.id === playerId);
    return p?.color || null;
  }

  currentModifiers() {
    const mods = this.ruleManager.computeModifiers();
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
    const beforePhase = this.phase;
    const white = this.players.find((p) => p.color === "w");
    const black = this.players.find((p) => p.color === "b");
    const ids = [];
    if (white) ids.push(this.ruleChosenByPlayerId[white.id]);
    if (black) ids.push(this.ruleChosenByPlayerId[black.id]);
    for (const id of ids) if (id) this.ruleManager.addRule(id);

    this.ruleChoicesByPlayerId = {};
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = null;
    if (this.phase === beforePhase) this.phase = "play";
    this.evaluateGameEnd();
  }

  maybeStartRuleChoice() {
    if (!this.started || this.result) return;
    if (this.ply > 0 && this.ply % this.ruleChoiceEveryPlies === 0) {
      this.phase = "ruleChoice";
      this.ruleChoicesByPlayerId = {};
      this.ruleChosenByPlayerId = {};
      for (const p of this.players) {
        const isDebugPicker = this.debugMode && p?.name === "DEBUG";
        this.ruleChoicesByPlayerId[p.id] = isDebugPicker ? this.ruleManager.allChoices() : this.ruleManager.randomChoices(3);
      }
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

  enforceMiniGameTimeoutIfNeeded() {
    if (this.phase !== "rps" || !this.rps) return;
    if (this.rps.deadlineMs == null) return;
    if (Date.now() < this.rps.deadlineMs) return;

    const opts = ["rock", "paper", "scissors"];
    for (const c of ["w", "b"]) {
      if (this.rps.byColor[c]) continue;
      this.rps.byColor[c] = opts[Math.floor(Math.random() * opts.length)];
      this.rps.pickedByColor[c] = true;
    }
    this.effects.push({ type: "log", id: this.nextEffectId(), text: "RPS duel timed out; auto-picked." });
    this.resolveRpsIfReady();
  }

  startRpsDuel() {
    if (!this.started || this.result) return { ok: false, error: "Game not active" };
    if (this.players.length !== 2) return { ok: false, error: "Need two players" };
    if (this.rps) return { ok: false, error: "RPS already running" };

    this.phase = "rps";
    this.rps = {
      round: 1,
      byColor: { w: null, b: null },
      pickedByColor: { w: false, b: false },
      deadlineMs: Date.now() + 20_000,
    };
    this.effects.push({ type: "log", id: this.nextEffectId(), text: "RPS duel! Pick rock, paper, or scissors." });
    return { ok: true };
  }

  submitRpsChoice(playerId, choice) {
    if (this.phase !== "rps" || !this.rps) return { ok: false, error: "No RPS duel active" };
    if (this.result) return { ok: false, error: "Game over" };

    const color = this.playerColor(playerId);
    if (color !== "w" && color !== "b") return { ok: false, error: "Not a player" };

    const normalized = String(choice || "").toLowerCase();
    if (!["rock", "paper", "scissors"].includes(normalized)) return { ok: false, error: "Invalid choice" };

    if (this.rps.byColor[color]) return { ok: false, error: "Already picked" };
    this.rps.byColor[color] = normalized;
    this.rps.pickedByColor[color] = true;

    if (this.rps.deadlineMs != null) {
      this.rps.deadlineMs = Math.max(this.rps.deadlineMs, Date.now() + 10_000);
    }

    this.resolveRpsIfReady();
    return { ok: true };
  }

  resolveRpsIfReady() {
    if (!this.rps) return;
    const w = this.rps.byColor.w;
    const b = this.rps.byColor.b;
    if (!w || !b) return;

    const beats = { rock: "scissors", paper: "rock", scissors: "paper" };

    if (w === b) {
      this.effects.push({ type: "log", id: this.nextEffectId(), text: `RPS round ${this.rps.round}: tie (${w}). Pick again!` });
      this.rps.round += 1;
      this.rps.byColor = { w: null, b: null };
      this.rps.pickedByColor = { w: false, b: false };
      this.rps.deadlineMs = Date.now() + 15_000;
      return;
    }

    const winner = beats[w] === b ? "w" : beats[b] === w ? "b" : null;
    if (!winner) {
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "RPS duel error; resetting round." });
      this.rps.byColor = { w: null, b: null };
      this.rps.pickedByColor = { w: false, b: false };
      this.rps.deadlineMs = Date.now() + 15_000;
      return;
    }

    const loser = winner === "w" ? "b" : "w";
    const loserSq = this.randomPieceSquare(loser, (p) => p.type !== "k");
    if (loserSq != null) {
      this.state.board[loserSq] = null;
      this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [loserSq], reason: "rps" });
    }
    this.effects.push({
      type: "rule",
      id: this.nextEffectId(),
      text: `RPS duel: ${winner === "w" ? "White" : "Black"} wins (${w} vs ${b}). ${loser === "w" ? "White" : "Black"} loses a random piece.`,
    });

    this.rps = null;
    this.phase = "play";
    this.evaluateGameEnd();
  }

  randomPieceSquare(color, filterFn) {
    const squares = [];
    for (let i = 0; i < 64; i++) {
      const p = this.state.board[i];
      if (!p || p.color !== color) continue;
      if (filterFn && !filterFn(p)) continue;
      squares.push(i);
    }
    if (!squares.length) return null;
    return squares[Math.floor(Math.random() * squares.length)];
  }

  findKingSquare(color) {
    for (let i = 0; i < 64; i++) {
      const p = this.state.board[i];
      if (p && p.color === color && p.type === "k") return i;
    }
    return null;
  }

  setResult({ winner, loser, reason, detail }) {
    this.resultInfo = { winner, loser, reason, detail };
    const winnerName = winner === "w" ? "White" : "Black";
    const loserName = loser === "w" ? "White" : "Black";
    this.result = `${winnerName} wins (${loserName} ${reason === "checkmate" ? "checkmated" : "lost"}).`;
    this.effects.push({ type: "log", id: this.nextEffectId(), text: detail || this.result });
  }

  evaluateGameEnd() {
    if (this.resultInfo || this.result) return true;
    if (!this.started || this.phase === "lobby") return false;

    const wKing = this.findKingSquare("w");
    const bKing = this.findKingSquare("b");
    if (wKing == null || bKing == null) {
      const loser = wKing == null ? "w" : "b";
      const winner = loser === "w" ? "b" : "w";
      const loserName = loser === "w" ? "White" : "Black";
      this.setResult({
        winner,
        loser,
        reason: "king_deleted",
        detail: `${loserName}'s king was destroyed or deleted by a rule.`,
      });
      return true;
    }

    const color = this.state.turn;
    const mods = this.currentModifiers();
    const legal = generateLegalMoves(this.state, color, mods);
    if (legal.length === 0) {
      const inCheck = require("./ChessEngine").isInCheck(this.state, color, mods);
      const loser = color;
      const winner = other(color);
      const loserName = loser === "w" ? "White" : "Black";
      const winnerName = winner === "w" ? "White" : "Black";
      this.setResult({
        winner,
        loser,
        reason: inCheck ? "checkmate" : "no_moves",
        detail: inCheck
          ? `${winnerName} wins by checkmate: ${loserName} has no legal moves while in check.`
          : `${winnerName} wins: ${loserName} has no legal moves (blocked by rules/position).`,
      });
      return true;
    }

    return false;
  }

  toggleReady(playerId) {
    if (!this.resultInfo) return { ok: false, error: "Game is not over" };
    if (!this.players.some((p) => p.id === playerId)) return { ok: false, error: "Unknown player" };
    this.readyByPlayerId[playerId] = !this.readyByPlayerId[playerId];

    const allReady = this.players.length > 0 && this.players.every((p) => !!this.readyByPlayerId[p.id]);
    if (allReady) {
      const players = [...this.players];
      this.initMatchState();
      this.started = true;
      this.players = players;
      this.phase = "play";
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Rematch started." });
    }

    return { ok: true, allReady };
  }

  applyHazardsAfterMove(toSquare) {
    if (this.hazards.deadly.has(toSquare) || this.hazards.lava.has(toSquare)) {
      const p = this.state.board[toSquare];
      if (p && p.color !== "x") {
        this.state.board[toSquare] = null;
        this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [toSquare], reason: "hazard" });
      }
    }
    // Asteroid debris: destroy piece that lands on it, then remove the debris.
    if (this.hazards.asteroid.has(toSquare)) {
      const p = this.state.board[toSquare];
      if (p && p.color !== "x") {
        this.state.board[toSquare] = null;
        this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [toSquare], reason: "asteroid" });
      }
      this.hazards.asteroid.delete(toSquare);
    }
  }

  applyGravityStep() {
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
    moved.sort((a, b) => idxToRank(a.from) - idxToRank(b.from));
    for (const m of moved) {
      if (!this.state.board[m.from] || this.state.board[m.to]) continue;
      this.state.board[m.to] = this.state.board[m.from];
      this.state.board[m.from] = null;
      this.state.board[m.to].moved = true;
    }
  }

  applyRandomShift() {
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
    for (const sq of this.missingSquares) this.state.board[sq] = null;
  }

  // King of the Hill: promote pieces standing on central squares.
  applyKingOfHill() {
    for (const sq of HILL_SQUARES) {
      const p = this.state.board[sq];
      if (!p || p.color === "x" || p.type === "k") continue;
      const next = HILL_PROMOTION[p.type];
      if (next && next !== p.type) {
        p.type = next;
        this.effects.push({ type: "log", id: this.nextEffectId(), text: `King of the Hill: piece at ${String.fromCharCode(97 + idxToFile(sq))}${idxToRank(sq) + 1} promoted to ${next}!` });
      }
    }
  }

  // Echo Chamber: mirror each move across the vertical axis (file 0↔7, 1↔6, etc.)
  applyEchoChamberMove(from, to) {
    const mf = 7 - idxToFile(from);
    const mr = idxToRank(from);
    const mirrorFrom = toIdx(mf, mr);
    const mt = 7 - idxToFile(to);
    const mirrorTo = toIdx(mt, idxToRank(to));

    if (this.missingSquares.has(mirrorFrom) || this.missingSquares.has(mirrorTo)) return;

    const piece = this.state.board[mirrorFrom];
    if (!piece || piece.color === "x" || piece.type === "k") return;

    // Destroy whatever is on the mirror destination (if enemy or neutral).
    const target = this.state.board[mirrorTo];
    if (target && target.type === "k") return; // never destroy a king via echo
    if (target) {
      this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [mirrorTo], reason: "echoChamber" });
    }

    this.state.board[mirrorTo] = { ...piece, moved: true };
    this.state.board[mirrorFrom] = null;
  }

  // Teleporter corners: if a piece just landed on a corner, send it somewhere random.
  applyTeleporterCorner(sq) {
    if (!CORNER_SQUARES.has(sq)) return;
    const p = this.state.board[sq];
    if (!p || p.color === "x") return;

    const empties = [];
    for (let i = 0; i < 64; i++) {
      if (!this.state.board[i] && !this.missingSquares.has(i) && !CORNER_SQUARES.has(i)) empties.push(i);
    }
    if (!empties.length) return;

    const dest = empties[Math.floor(Math.random() * empties.length)];
    this.state.board[dest] = { ...p, moved: true };
    this.state.board[sq] = null;
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Teleporter! Piece zapped from corner to ${String.fromCharCode(97 + idxToFile(dest))}${idxToRank(dest) + 1}.` });
  }

  // Fog of War: compute visible squares for a given player color (within radius 1 of any friendly piece).
  computeFogSquares(color) {
    const visible = new Set();
    for (let i = 0; i < 64; i++) {
      const p = this.state.board[i];
      if (!p || p.color !== color) continue;
      const f = idxToFile(i);
      const r = idxToRank(i);
      for (let dr = -1; dr <= 1; dr++) {
        for (let df = -1; df <= 1; df++) {
          const nf = f + df;
          const nr = r + dr;
          if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
          visible.add(toIdx(nf, nr));
        }
      }
    }
    return [...visible];
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

    this.history.push(deepCloneState(this));
    if (this.history.length > 20) this.history.shift();

    const capture = !!this.state.board[to] || (piece.type === "p" && this.state.enPassant != null && to === this.state.enPassant);

    const next = applyMoveNoValidation(this.state, { from, to, promotion }, mods);
    this.state = next;
    this.ply += 1;
    let finalTo = to;
    this.lastMoveSquares = [from, to];

    const wouldCheckNext = require("./ChessEngine").isInCheck(this.state, this.state.turn, { ...mods, shield: { w: 0, b: 0 } });
    if (wouldCheckNext && this.shield[this.state.turn] > 0) this.shield[this.state.turn] -= 1;

    // Restore temp queen.
    if (piece.tags?.includes("tempQueen")) {
      const movedPiece = this.state.board[to];
      if (movedPiece && movedPiece._tempOriginalType) {
        movedPiece.type = movedPiece._tempOriginalType;
        delete movedPiece._tempOriginalType;
        movedPiece.tags = (movedPiece.tags || []).filter((t) => t !== "tempQueen");
      }
    }

    // Ice Board.
    if (mods.iceBoard) {
      const movedPiece = this.state.board[finalTo];
      if (movedPiece) {
        finalTo = this.applyIceSlide(from, finalTo);
        this.lastMoveSquares = [from, finalTo];
      }
    }

    // Echo Trail.
    if (mods.echoTrail) {
      const movedPiece = this.state.board[finalTo];
      const path = this.movePathSquares(from, finalTo);
      this.applyEchoTrail(path, movedPiece);
    } else if (mods.trails) {
      if (!this.state.board[from] && !this.missingSquares.has(from)) {
        this.state.board[from] = { type: "x", color: "x", moved: true };
        this.trailBlocks.push(from);
      }
    }

    // Echo Chamber: mirror the move across the vertical axis.
    if (mods.echoChamber) {
      this.applyEchoChamberMove(from, finalTo);
    }

    // Teleporter corners.
    if (mods.teleporterCorners) {
      this.applyTeleporterCorner(finalTo);
      // finalTo may be stale after teleport, but we don't need to track it further.
    }

    // Chain explosions on capture.
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

    // Respawn as pawns.
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

    // Shapeshifters.
    if (mods.randomTypeAfterMove) {
      const p2 = this.state.board[finalTo];
      if (p2 && p2.type !== "k" && p2.color !== "x") {
        const types = ["p", "n", "b", "r", "q"];
        p2.type = types[Math.floor(Math.random() * types.length)];
      }
    }

    // Hazards after move (includes asteroid).
    this.applyHazardsAfterMove(finalTo);

    // King of the Hill: promote pieces on central squares.
    if (mods.kingOfHill) this.applyKingOfHill();

    // Gravity / shifting / vanishing tiles.
    if (mods.gravity || this.permanent.gravity) this.applyGravityStep();
    if (mods.randomShift) this.applyRandomShift();
    if (mods.vanishingTiles) this.refreshVanishingTiles();

    // Move-twice.
    if (mods.moveTwice) this.extraMoves[color] += 1;

    if (this.extraMoves[color] > 0) {
      this.extraMoves[color] -= 1;
      this.state.turn = color;
      this.effects.push({ type: "log", id: this.nextEffectId(), text: `${color === "w" ? "White" : "Black"} gets an extra move.` });
    }

    // Visual flip countdown.
    if (this.visualFlipPlies > 0) this.visualFlipPlies -= 1;

    // Colour blind countdown.
    if (this.colourBlindPlies > 0) this.colourBlindPlies -= 1;

    // Asteroid countdown — clear remaining debris when it expires.
    if (this.asteroidPlies > 0) {
      this.asteroidPlies -= 1;
      if (this.asteroidPlies === 0 && this.hazards.asteroid.size > 0) {
        this.hazards.asteroid.clear();
        this.effects.push({ type: "log", id: this.nextEffectId(), text: "Asteroid debris cleared." });
      }
    }

    // Time reversal.
    if (this.requestTimeReverse > 0) {
      this.requestTimeReverse -= 1;
      if (this.requestTimeReverse === 0) {
        this.timeReverseNow(2);
      }
    }

    this.ruleManager.tickAfterPly();
    this.evaluateGameEnd();
    this.maybeStartRuleChoice();
    return { ok: true };
  }

  toClientState() {
    this.enforceRuleChoiceTimeoutIfNeeded();
    this.enforceMiniGameTimeoutIfNeeded();
    const mods = this.currentModifiers();
    const inCheck = require("./ChessEngine").isInCheck(this.state, this.state.turn, mods);
    const checkLabel = inCheck ? (this.state.turn === "w" ? "White" : "Black") : null;

    // Invisible pieces: show only kings + last move squares.
    let visibleSquares = null;
    if (mods.invisiblePieces) {
      visibleSquares = new Set(this.lastMoveSquares);
      for (let i = 0; i < 64; i++) if (this.state.board[i]?.type === "k") visibleSquares.add(i);
    }

    // Fog of War: per-player visibility. We send the union here for server state;
    // the client filters per its own color using fogOfWarSquares[color].
    let fogOfWarSquares = null;
    if (mods.fogOfWar) {
      fogOfWarSquares = {
        w: this.computeFogSquares("w"),
        b: this.computeFogSquares("b"),
      };
    }

    // Colour blind is visual-only; keep true colors in the serialized board so gameplay remains unchanged.
    const board = this.state.board;

    const hazards = {
      deadly: [...this.hazards.deadly],
      lava: [...this.hazards.lava],
      asteroid: [...this.hazards.asteroid],
    };

    const marks = {
      lightning: [...(this.marks?.lightning || [])],
    };

    return {
      roomCode: this.roomCode,
      started: this.started,
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
      board: serializeBoard(board),
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
      readyByPlayerId: this.readyByPlayerId,
      rematchId: this.rematchId,
      hazards,
      marks,
      missingSquares: [...this.missingSquares],
      visualFlip: this.visualFlipPlies > 0,
      colourBlind: this.colourBlindPlies > 0,
      lastMoveSquares: this.lastMoveSquares,
      invisiblePieces: !!mods.invisiblePieces,
      visibleSquares: visibleSquares ? [...visibleSquares] : null,
      fogOfWar: !!mods.fogOfWar,
      fogOfWarSquares,
      rps: this.rps
        ? { active: true, round: this.rps.round, pickedByColor: { ...this.rps.pickedByColor }, deadlineMs: this.rps.deadlineMs }
        : null,
      lastMove: this.state.lastMove || null,
      resultInfo: this.resultInfo,
    };
  }
}

module.exports = { Game };
