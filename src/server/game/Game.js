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
  return board.map((p) =>
    p
      ? {
          type: p.type,
          color: p.color,
          tags: p.tags,
          hp: typeof p._hp === "number" ? p._hp : null,
          maxHp: typeof p._maxHp === "number" ? p._maxHp : null,
        }
      : null
  );
}

const DEMOTE_TYPE = { q: "r", r: "b", b: "n", n: "p", p: "p" };
const PAWN_SOLDIER_HP = { p: 1, n: 3, b: 3, r: 5, q: 9 };

function defaultPermanentFlags() {
  return {
    wrapEdges: false,
    gravity: false,
    bishopsRookLike: false,
    forcedKingMove: false,
    allPiecesKingLike: false,
    chainExplosions: false,
  };
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
    hazards: { deadly: [...game.hazards.deadly], lava: [...game.hazards.lava], asteroid: [...game.hazards.asteroid] },
    missingSquares: [...game.missingSquares],
    extraMoves: { ...game.extraMoves },
    shield: { ...game.shield },
    marks: {
      lightning: [...(game.marks?.lightning || [])],
      blackHole: [...(game.marks?.blackHole || [])],
      plague: [...(game.marks?.plague || [])],
      swap: [...(game.marks?.swap || [])],
    },
    fans: game.fans.map((fan) => ({ ...fan })),
    ghostSquares: [...game.ghostSquares],
    stickySquares: [...game.stickySquares],
    backupPlanActive: { ...game.backupPlanActive },
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
    this.phase = "lobby"; // "lobby" | "play" | "ruleChoice" | "bonusRuleChoice" | "targetRule" | "pawnSoldierShot" | "rps" | "wager"

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
    this.permanent = defaultPermanentFlags();

    this.hazards = { deadly: new Set(), lava: new Set(), asteroid: new Set() };
    this.missingSquares = new Set();
    this.marks = { lightning: new Set(), blackHole: new Set(), plague: new Set(), swap: new Set() };
    this.fans = [];
    this.ghostSquares = new Set();
    this.stickySquares = new Set();

    this.lastMoveSquares = [];

    this.trailBlocks = [];
    this.requestTimeReverse = 0;
    this.history = [];
    this.pendingTargetRules = [];
    this.pendingPawnSoldierShot = null;
    this.backupPlanActive = { w: false, b: false };

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
      if (ruleId === "dur_haunted_board_5") {
        this.ghostSquares = new Set();
      }
      if (ruleId === "dur_sticky_squares_6") {
        this.stickySquares = new Set();
        for (const piece of this.state.board) {
          if (!piece) continue;
          delete piece._stickyLocked;
          piece.tags = (piece.tags || []).filter((tag) => tag !== "stickyStuck");
        }
      }
    };
  }

  nextEffectId() {
    return `${this.roomCode}-${this.effectSeq++}`;
  }

  clearTransientEffects() {
    this.effects = [];
  }

  resetBoardState({ keepRules }) {
    this.removeTitanBodies();
    this.state = initialState();
    this.ply = 0;
    this.result = null;
    this.resultInfo = null;
    this.readyByPlayerId = {};
    this.lastMoveSquares = [];
    this.history = [];
    this.rps = null;
    this.wager = null;
    this.bonusRuleChoice = null; // { playerId, remainingPicks }
    this.ruleChoicesByPlayerId = {};
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = null;

    this.visualFlipPlies = 0;
    this.colourBlindPlies = 0;
    this.asteroidPlies = 0;
    this.extraMoves = { w: 0, b: 0 };
    this.shield = { w: 0, b: 0 };
    this.trailBlocks = [];
    this.requestTimeReverse = 0;
    this.pendingTargetRules = [];
    this.pendingPawnSoldierShot = null;
    this.backupPlanActive = { w: false, b: false };
    this.ghostSquares = new Set();
    this.stickySquares = new Set();

    if (!keepRules) {
      this.ruleManager = new RuleManager(this);
      this.permanent = defaultPermanentFlags();
      this.hazards = { deadly: new Set(), lava: new Set(), asteroid: new Set() };
      this.missingSquares = new Set();
      this.marks = { lightning: new Set(), blackHole: new Set(), plague: new Set(), swap: new Set() };
      this.fans = [];
      this.ghostSquares = new Set();
      this.stickySquares = new Set();
    }
  }

  enqueueTargetRule(targetRule) {
    if (!targetRule?.playerId || !targetRule?.color) return;
    this.pendingTargetRules.push(targetRule);
  }

  currentPendingTarget() {
    return this.pendingTargetRules[0] || null;
  }

  submitRuleTarget(playerId, square) {
    if (this.phase !== "targetRule") return { ok: false, error: "No targeted rule is waiting" };
    const pending = this.currentPendingTarget();
    if (!pending) return { ok: false, error: "No targeted rule is waiting" };
    if (pending.playerId !== playerId) return { ok: false, error: "Waiting for the other player to choose a target" };
    if (square == null || square < 0 || square > 63) return { ok: false, error: "Bad target" };

    if (pending.ruleId === "inst_lawnmower") {
      const rank = idxToRank(square);
      const res = this.runLawnmower(rank, pending.color);
      if (!res.ok) return res;
      this.pendingTargetRules.shift();
      this.phase = this.pendingTargetRules.length ? "targetRule" : "play";
      this.evaluateGameEnd();
      if (this.phase === "play") this.resumeBonusRuleChoiceIfNeeded();
      return { ok: true };
    }

    const piece = this.state.board[square];
    if (!piece || piece.color !== pending.color || piece.color === "x") return { ok: false, error: "Choose one of your own pieces" };

    let res = { ok: false, error: "Unknown targeted rule" };
    if (pending.ruleId === "inst_titan") res = this.makeTitan(square, pending.color);
    if (pending.ruleId === "inst_suicide_bomber") res = this.armSuicideBomber(square, pending.color);
    if (pending.ruleId === "inst_pawn_soldier") res = this.armPawnSoldier(square, pending.color);
    if (pending.ruleId === "inst_backup_plan") res = this.assignBackupVital(square, pending.color);
    if (!res.ok) return res;

    this.pendingTargetRules.shift();
    this.phase = this.pendingTargetRules.length ? "targetRule" : "play";
    this.evaluateGameEnd();
    if (this.phase === "play") this.resumeBonusRuleChoiceIfNeeded();
    return { ok: true };
  }

  titanAnchorForSquare(sq) {
    return toIdx(Math.min(idxToFile(sq), 6), Math.min(idxToRank(sq), 6));
  }

  titanFootprint(anchor) {
    const f = idxToFile(anchor);
    const r = idxToRank(anchor);
    if (f < 0 || f > 6 || r < 0 || r > 6) return [];
    return [anchor, toIdx(f + 1, r), toIdx(f, r + 1), toIdx(f + 1, r + 1)];
  }

  isTitan(piece) {
    return !!piece?.tags?.includes("titan");
  }

  isTitanBody(piece) {
    return !!piece?.tags?.includes("titanBody");
  }

  removeTitanBodies() {
    for (let i = 0; i < 64; i++) {
      if (this.isTitanBody(this.state.board[i])) this.state.board[i] = null;
    }
  }

  syncTitanBodies({ destructive = false } = {}) {
    const titans = [];
    for (let i = 0; i < 64; i++) {
      const p = this.state.board[i];
      if (this.isTitan(p)) titans.push({ sq: i, p });
      if (this.isTitanBody(p)) this.state.board[i] = null;
    }

    for (const { sq, p } of titans) {
      const anchor = this.titanAnchorForSquare(sq);
      if (anchor !== sq) {
        if (!this.state.board[anchor] || this.state.board[anchor] === p || destructive) {
          this.state.board[sq] = null;
          this.state.board[anchor] = p;
        }
      }
      const finalAnchor = this.state.board[anchor] === p ? anchor : sq;
      for (const bodySq of this.titanFootprint(finalAnchor).slice(1)) {
        if (destructive && this.state.board[bodySq] && this.state.board[bodySq].type !== "k") {
          this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [bodySq], reason: "titan" });
        }
        if (!this.state.board[bodySq] || destructive) {
          this.state.board[bodySq] = { type: "x", color: "x", moved: true, tags: ["titanBody"] };
        }
      }
    }
  }

  makeTitan(square, color) {
    this.removeTitanBodies();
    const piece = this.state.board[square];
    if (!piece || piece.color !== color || piece.color === "x") return { ok: false, error: "Choose one of your own pieces" };

    const anchor = this.titanAnchorForSquare(square);
    const footprint = this.titanFootprint(anchor);
    if (footprint.length !== 4 || footprint.some((sq) => this.missingSquares.has(sq))) return { ok: false, error: "Titan will not fit there" };

    piece.tags = [...new Set([...(piece.tags || []).filter((t) => t !== "titanBody"), "titan"])];
    piece._titanOriginalType = piece._titanOriginalType || piece.type;
    const destroyed = [];
    if (anchor !== square && this.state.board[anchor]) destroyed.push(anchor);
    this.state.board[square] = null;
    this.state.board[anchor] = piece;

    for (const sq of footprint.slice(1)) {
      if (this.state.board[sq] && this.state.board[sq]?.type !== "x") destroyed.push(sq);
      this.state.board[sq] = { type: "x", color: "x", moved: true, tags: ["titanBody"] };
    }
    if (destroyed.length) this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: destroyed, reason: "titan" });
    this.effects.push({ type: "rule", id: this.nextEffectId(), text: `${color === "w" ? "White" : "Black"} created a titan.` });
    return { ok: true };
  }

  armSuicideBomber(square, color) {
    const piece = this.state.board[square];
    if (!piece || piece.color !== color || piece.color === "x") return { ok: false, error: "Choose one of your own pieces" };
    piece.tags = [...new Set([...(piece.tags || []), "suicideBomber"])];
    this.effects.push({ type: "rule", id: this.nextEffectId(), text: `${color === "w" ? "White" : "Black"} armed a suicide bomber.` });
    return { ok: true };
  }

  armPawnSoldier(square, color) {
    const piece = this.state.board[square];
    if (!piece || piece.color !== color || piece.color === "x" || piece.type !== "p") return { ok: false, error: "Choose one of your pawns" };
    piece.tags = [...new Set([...(piece.tags || []), "pawnSoldier"])];
    this.effects.push({ type: "rule", id: this.nextEffectId(), text: `${color === "w" ? "White" : "Black"} armed a pawn soldier.` });
    return { ok: true };
  }

  firstPawnSoldierHitSquare(from, target) {
    if (from == null || target == null || from === target) return null;
    const fromFile = idxToFile(from);
    const fromRank = idxToRank(from);
    const targetFile = idxToFile(target);
    const targetRank = idxToRank(target);
    const df = targetFile - fromFile;
    const dr = targetRank - fromRank;
    const steps = Math.max(Math.abs(df), Math.abs(dr)) * 20;
    if (steps <= 0) return null;

    const seen = new Set([from]);
    for (let i = 1; i <= steps; i++) {
      const file = Math.round(fromFile + (df * i) / steps);
      const rank = Math.round(fromRank + (dr * i) / steps);
      if (file < 0 || file > 7 || rank < 0 || rank > 7) continue;
      const sq = toIdx(file, rank);
      if (seen.has(sq)) continue;
      seen.add(sq);
      const p = this.state.board[sq];
      if (!p || p.color === "x" || p.type === "k") continue;
      if (!PAWN_SOLDIER_HP[p.type]) continue;
      return sq;
    }
    return null;
  }

  applyPawnSoldierDamage(square) {
    const piece = this.state.board[square];
    if (!piece || piece.color === "x" || piece.type === "k") return false;
    const maxHp = PAWN_SOLDIER_HP[piece.type];
    if (!maxHp) return false;
    piece._maxHp = piece._maxHp || maxHp;
    piece._hp = typeof piece._hp === "number" ? piece._hp : piece._maxHp;
    piece._hp -= 1;
    if (piece._hp <= 0) {
      this.state.board[square] = null;
      this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [square], reason: "pawnSoldier" });
    }
    return true;
  }

  submitPawnSoldierShot(playerId, target) {
    if (this.phase !== "pawnSoldierShot" || !this.pendingPawnSoldierShot) return { ok: false, error: "No pawn soldier shot is waiting" };
    const pending = this.pendingPawnSoldierShot;
    if (pending.playerId !== playerId) return { ok: false, error: "Waiting for the other player to shoot" };
    if (target == null || target < 0 || target > 63) return { ok: false, error: "Bad shot target" };

    const hits = [];
    for (let i = 0; i < 3; i++) {
      const hit = this.firstPawnSoldierHitSquare(pending.from, target);
      if (hit == null) continue;
      if (this.applyPawnSoldierDamage(hit)) hits.push(hit);
    }

    this.effects.push({ type: "bullets", id: this.nextEffectId(), from: pending.from, to: target, hits });
    this.effects.push({
      type: "log",
      id: this.nextEffectId(),
      text: `Pawn Soldier fired 3 shot(s)${hits.length ? ` and hit ${hits.length} time(s).` : "."}`,
    });

    this.pendingPawnSoldierShot = null;
    this.phase = "play";
    this.evaluateGameEnd();
    if (this.phase === "play") this.maybeStartRuleChoice();
    return { ok: true };
  }

  assignBackupVital(square, color) {
    const piece = this.state.board[square];
    if (!piece || piece.color !== color || piece.color === "x" || piece.type === "k") {
      return { ok: false, error: "Choose one of your non-king pieces" };
    }
    for (const p of this.state.board) {
      if (p && p._backupVital === color) delete p._backupVital;
    }
    piece._backupVital = color;
    this.backupPlanActive[color] = true;
    this.effects.push({ type: "rule", id: this.nextEffectId(), text: `${color === "w" ? "White" : "Black"} set a backup plan.` });
    return { ok: true };
  }

  findBackupVitalSquare(color) {
    if (!this.backupPlanActive?.[color]) return null;
    for (let i = 0; i < 64; i++) {
      const p = this.state.board[i];
      if (p && p.color === color && p._backupVital === color) return i;
    }
    return null;
  }

  syncDynamicMarks() {
    this.marks.plague.clear();
    for (let i = 0; i < 64; i++) {
      if (this.state.board[i]?._plagueInfected) this.marks.plague.add(i);
    }
  }

  runLawnmower(rank, color) {
    if (typeof rank !== "number" || rank < 0 || rank > 7) return { ok: false, error: "Choose a valid row" };
    const row = [];
    for (let file = 0; file < 8; file++) {
      const sq = toIdx(file, rank);
      row.push(sq);
      if (this.state.board[sq]?.type === "k") return { ok: false, error: "You can't choose a row with a king on it" };
    }
    const destroyed = [];
    for (const sq of row) {
      if (!this.state.board[sq]) continue;
      this.state.board[sq] = null;
      destroyed.push(sq);
    }
    this.effects.push({ type: "lawnmower", id: this.nextEffectId(), row: rank, color, squares: row });
    if (destroyed.length) this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: destroyed, reason: "lawnmower" });
    this.effects.push({ type: "rule", id: this.nextEffectId(), text: `Lawnmower cleared row ${rank + 1}.` });
    return { ok: true };
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
    if (this.colourBlindPlies > 0) mods.friendlyFire = true;
    mods.missingSquares = this.missingSquares;
    mods.shield = this.shield;
    mods.stickySquares = this.stickySquares;
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
    if (this.isTitan(p)) return this.getTitanLegalDestinations(from, color);

    const mods = this.currentModifiers();
    if (mods.mirroredMoves && this.state.lastMove) mods.requiredMove = { ...this.state.lastMove };
    const legal = generateLegalMoves(this.state, color, mods);
    return legal.filter((m) => m.from === from).map((m) => m.to);
  }

  chooseRule(playerId, ruleId) {
    if (this.phase === "bonusRuleChoice") {
      if (!this.bonusRuleChoice || this.bonusRuleChoice.playerId !== playerId) return { ok: false, error: "No bonus choices for you" };
      if (this.bonusRuleChoice.remainingPicks <= 0) return { ok: false, error: "No bonus picks left" };
      const choice = this.ruleChoicesByPlayerId[playerId] || [];
      if (!choice.some((r) => r.id === ruleId)) return { ok: false, error: "Invalid choice" };

      const color = this.playerColor(playerId);
      const name = getRuleById(ruleId)?.name || ruleId;
      this.effects.push({ type: "log", id: this.nextEffectId(), text: `Bonus rule picked: ${name}` });
      this.ruleManager.addRule(ruleId, { playerId, color });

      this.bonusRuleChoice.remainingPicks -= 1;
      if (this.bonusRuleChoice.remainingPicks > 0) {
        if (this.phase !== "bonusRuleChoice") {
          // A mini-game / interrupting phase took over; resume bonus picks once we're back to play.
          this.ruleChoicesByPlayerId = {};
          this.ruleChosenByPlayerId = {};
          this.ruleChoiceDeadlineMs = null;
          return { ok: true };
        }
        // Refresh choices (exclude Pot of Greed to avoid infinite loops).
        this.ruleChoicesByPlayerId = {
          [playerId]: this.ruleManager.allChoices().filter((r) => r.id !== "inst_pot_of_greed"),
        };
        this.ruleChoiceDeadlineMs = Date.now() + this.ruleChoiceDurationMs;
        return { ok: true };
      }

      // End bonus choice unless a mini-game took over the phase.
      this.bonusRuleChoice = null;
      this.ruleChoicesByPlayerId = {};
      this.ruleChosenByPlayerId = {};
      this.ruleChoiceDeadlineMs = null;
      if (this.phase === "bonusRuleChoice") {
        this.phase = this.pendingTargetRules.length ? "targetRule" : "play";
        if (this.phase === "play") this.resumeBonusRuleChoiceIfNeeded();
      }
      this.evaluateGameEnd();
      return { ok: true };
    }

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
    const picks = [];
    if (white) picks.push({ player: white, ruleId: this.ruleChosenByPlayerId[white.id] });
    if (black) picks.push({ player: black, ruleId: this.ruleChosenByPlayerId[black.id] });
    this.ruleChoicesByPlayerId = {};
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = null;

    for (const pick of picks) {
      if (pick.ruleId) this.ruleManager.addRule(pick.ruleId, { playerId: pick.player.id, color: pick.player.color });
    }

    if (this.phase === beforePhase) {
      this.phase = this.pendingTargetRules.length ? "targetRule" : "play";
    }
    if (this.phase === "play") this.resumeBonusRuleChoiceIfNeeded();
    this.evaluateGameEnd();
  }

  resumeBonusRuleChoiceIfNeeded() {
    if (!this.bonusRuleChoice || this.bonusRuleChoice.remainingPicks <= 0) return false;
    const pid = this.bonusRuleChoice.playerId;
    if (!pid) return false;
    this.phase = "bonusRuleChoice";
    this.ruleChoicesByPlayerId = {
      [pid]: this.ruleManager.allChoices().filter((r) => r.id !== "inst_pot_of_greed"),
    };
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = Date.now() + this.ruleChoiceDurationMs;
    return true;
  }

  startBonusRuleChoice(playerId, extraPicks = 2) {
    if (!this.started || this.result) return { ok: false, error: "Game not active" };
    if (!playerId) return { ok: false, error: "Bad player" };

    if (!this.bonusRuleChoice || this.bonusRuleChoice.playerId !== playerId) {
      this.bonusRuleChoice = { playerId, remainingPicks: Math.max(1, Number(extraPicks) || 0) };
    } else {
      this.bonusRuleChoice.remainingPicks += Math.max(1, Number(extraPicks) || 0);
    }

    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Pot of Greed! Pick ${this.bonusRuleChoice.remainingPicks} extra rule(s).` });
    this.resumeBonusRuleChoiceIfNeeded();
    return { ok: true };
  }

  maybeStartRuleChoice() {
    if (!this.started || this.result) return;
    if (this.phase !== "play") return;
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

  enforceBonusRuleChoiceTimeoutIfNeeded() {
    if (this.phase !== "bonusRuleChoice") return;
    if (!this.bonusRuleChoice || this.bonusRuleChoice.remainingPicks <= 0) {
      this.phase = this.pendingTargetRules.length ? "targetRule" : "play";
      return;
    }
    if (this.ruleChoiceDeadlineMs == null) return;
    if (Date.now() < this.ruleChoiceDeadlineMs) return;

    const pid = this.bonusRuleChoice.playerId;
    const choice = this.ruleChoicesByPlayerId[pid] || [];
    const pick = choice[Math.floor(Math.random() * Math.max(1, choice.length))];
    if (pick) {
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Bonus rule choice timed out; auto-picked." });
      this.chooseRule(pid, pick.id);
      return;
    }

    // Nothing to pick; end bonus choice.
    this.bonusRuleChoice.remainingPicks = 0;
    this.bonusRuleChoice = null;
    this.ruleChoicesByPlayerId = {};
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = null;
    this.phase = this.pendingTargetRules.length ? "targetRule" : "play";
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
    if (this.phase === "play") this.resumeBonusRuleChoiceIfNeeded();
  }

  enforceWagerTimeoutIfNeeded() {
    if (this.phase !== "wager" || !this.wager) return;

    const now = Date.now();

    if (this.wager.stage === "select") return;

    if (this.wager.stage === "flip") {
      if (this.wager.resolveAtMs != null && now >= this.wager.resolveAtMs) {
        this.applyWagerResult();
      }
      return;
    }

    if (this.wager.stage === "result") {
      if (this.wager.closeAtMs != null && now >= this.wager.closeAtMs) {
        this.wager = null;
        this.phase = "play";
        this.evaluateGameEnd();
        if (this.phase === "play") this.resumeBonusRuleChoiceIfNeeded();
      }
    }
  }

  startCoinflipWager() {
    if (!this.started || this.result) return { ok: false, error: "Game not active" };
    if (this.players.length !== 2) return { ok: false, error: "Need two players" };
    if (this.wager) return { ok: false, error: "Wager already running" };

    this.phase = "wager";
    this.wager = {
      stage: "select",
      selectedByColor: { w: [], b: [] },
      confirmedByColor: { w: false, b: false },
      assignedByColor: null, // { w: "heads"|"tails", b: "heads"|"tails" }
      outcome: null, // "heads"|"tails"
      winner: null,
      loser: null,
      deadlineMs: null,
      resolveAtMs: null,
      closeAtMs: null,
    };

    this.effects.push({ type: "log", id: this.nextEffectId(), text: "Coinflip Wager! Select pieces to wager, then confirm." });
    return { ok: true };
  }

  setWagerSelection(playerId, squares) {
    if (this.phase !== "wager" || !this.wager) return { ok: false, error: "No wager active" };
    if (this.wager.stage !== "select") return { ok: false, error: "Wager already locked in" };

    const color = this.playerColor(playerId);
    if (color !== "w" && color !== "b") return { ok: false, error: "Not a player" };
    if (this.wager.confirmedByColor[color]) return { ok: false, error: "Already confirmed" };

    const raw = Array.isArray(squares) ? squares : [];
    const uniq = [...new Set(raw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 63))];
    if (uniq.length > 63) return { ok: false, error: "Too many pieces" };

    for (const sq of uniq) {
      const p = this.state.board[sq];
      if (!p || p.color !== color || p.color === "x") return { ok: false, error: "Selections must be your own pieces" };
      if (p.type === "k") return { ok: false, error: "You can't wager your king" };
    }

    this.wager.selectedByColor[color] = uniq;
    return { ok: true };
  }

  confirmWager(playerId) {
    if (this.phase !== "wager" || !this.wager) return { ok: false, error: "No wager active" };
    if (this.wager.stage !== "select") return { ok: false, error: "Wager already locked in" };

    const color = this.playerColor(playerId);
    if (color !== "w" && color !== "b") return { ok: false, error: "Not a player" };

    this.wager.confirmedByColor[color] = true;
    this.beginWagerFlipIfReady();
    return { ok: true };
  }

  beginWagerFlipIfReady() {
    if (!this.wager || this.wager.stage !== "select") return;
    if (!this.wager.confirmedByColor.w || !this.wager.confirmedByColor.b) return;

    const wIsHeads = Math.random() < 0.5;
    this.wager.assignedByColor = { w: wIsHeads ? "heads" : "tails", b: wIsHeads ? "tails" : "heads" };
    this.wager.outcome = Math.random() < 0.5 ? "heads" : "tails";
    const winner = this.wager.assignedByColor.w === this.wager.outcome ? "w" : "b";
    const loser = winner === "w" ? "b" : "w";
    this.wager.winner = winner;
    this.wager.loser = loser;

    this.wager.stage = "flip";
    this.wager.resolveAtMs = Date.now() + 2_500;
    this.wager.closeAtMs = this.wager.resolveAtMs + 2_000;
    this.effects.push({ type: "log", id: this.nextEffectId(), text: "Coin flipped..." });
  }

  applyWagerResult() {
    if (!this.wager || this.wager.stage !== "flip") return;
    const winner = this.wager.winner;
    const loser = this.wager.loser;
    if (winner !== "w" && winner !== "b") return;
    if (loser !== "w" && loser !== "b") return;

    const squares = this.wager.selectedByColor[loser] || [];
    let changed = 0;
    for (const sq of squares) {
      const p = this.state.board[sq];
      if (!p) continue;
      if (p.color !== loser) continue;
      if (p.color === "x" || p.type === "k") continue;
      this.state.board[sq] = { ...p, color: winner };
      changed += 1;
    }

    this.effects.push({
      type: "rule",
      id: this.nextEffectId(),
      text: `Coinflip Wager: ${winner === "w" ? "White" : "Black"} wins (${this.wager.outcome}). ${changed} piece(s) switched sides.`,
    });

    this.wager.stage = "result";
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
    const wVital = this.findBackupVitalSquare("w");
    const bVital = this.findBackupVitalSquare("b");
    if ((this.backupPlanActive.w && wVital == null) || (this.backupPlanActive.b && bVital == null)) {
      const loser = this.backupPlanActive.w && wVital == null ? "w" : "b";
      const winner = loser === "w" ? "b" : "w";
      const loserName = loser === "w" ? "White" : "Black";
      this.setResult({
        winner,
        loser,
        reason: "backup_lost",
        detail: `${loserName}'s backup-plan piece was destroyed.`,
      });
      return true;
    }

    if ((wKing == null && !this.backupPlanActive.w) || (bKing == null && !this.backupPlanActive.b)) {
      const loser = wKing == null && !this.backupPlanActive.w ? "w" : "b";
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
      if (inCheck && this.backupPlanActive?.[color] && this.findBackupVitalSquare(color) != null) return false;
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

  noteCaptureSquare(square) {
    if (square == null) return;
    const mods = this.currentModifiers();
    if (mods.hauntedBoard) this.ghostSquares.add(square);
  }

  demotePieceForGhostPath(pathSquares, finalSquare) {
    const mods = this.currentModifiers();
    if (!mods.hauntedBoard || !pathSquares?.some((sq) => sq !== pathSquares[0] && this.ghostSquares.has(sq))) return;
    const piece = this.state.board[finalSquare];
    if (!piece || piece.color === "x" || piece.type === "k") return;
    const next = DEMOTE_TYPE[piece.type];
    if (!next || next === piece.type) return;
    piece.type = next;
    piece.tags = [...new Set([...(piece.tags || []), "haunted"])];
    this.effects.push({ type: "rule", id: this.nextEffectId(), text: `Haunted Board demoted a piece at ${this.squareName(finalSquare)}.` });
  }

  clearStickyLocks(color) {
    for (const piece of this.state.board) {
      if (!piece || piece.color !== color || !piece._stickyLocked) continue;
      delete piece._stickyLocked;
      piece.tags = (piece.tags || []).filter((tag) => tag !== "stickyStuck");
    }
  }

  applyStickyLanding(square) {
    const mods = this.currentModifiers();
    if (!mods.stickySquaresActive || square == null) return;
    const piece = this.state.board[square];
    if (!piece || piece.color === "x") return;
    const wasSticky = this.stickySquares.has(square);
    this.stickySquares.add(square);
    if (wasSticky) {
      piece._stickyLocked = true;
      piece.tags = [...new Set([...(piece.tags || []), "stickyStuck"])];
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
    if (!CORNER_SQUARES.has(sq)) return sq;
    const p = this.state.board[sq];
    if (!p || p.color === "x") return sq;

    const empties = [];
    for (let i = 0; i < 64; i++) {
      if (!this.state.board[i] && !this.missingSquares.has(i) && !CORNER_SQUARES.has(i)) empties.push(i);
    }
    if (!empties.length) return sq;

    const dest = empties[Math.floor(Math.random() * empties.length)];
    this.state.board[dest] = { ...p, moved: true };
    this.state.board[sq] = null;
    this.effects.push({
      type: "move",
      style: "teleport",
      id: this.nextEffectId(),
      from: sq,
      to: dest,
      piece: serializeBoard([p])[0],
    });
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Teleporter! Piece zapped from corner to ${String.fromCharCode(97 + idxToFile(dest))}${idxToRank(dest) + 1}.` });
    return dest;
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

  titanCanOccupy(board, anchor, color, currentFootprint = new Set()) {
    const footprint = this.titanFootprint(anchor);
    if (footprint.length !== 4) return false;
    for (const sq of footprint) {
      if (this.missingSquares.has(sq)) return false;
      const occupant = board[sq];
      if (!occupant) continue;
      if (currentFootprint.has(sq)) continue;
      if (occupant.color === "x") return false;
      if (occupant.color === color) return false;
      if (occupant.type === "k") return false;
    }
    return true;
  }

  titanMoveLeavesKingSafe(from, to, color) {
    const board = this.state.board.map((p) => (p ? { ...p, tags: p.tags ? [...p.tags] : undefined } : null));
    const piece = board[from];
    const currentFootprint = new Set(this.titanFootprint(from));
    for (const sq of currentFootprint) {
      if (sq !== from && this.isTitanBody(board[sq])) board[sq] = null;
    }
    for (const sq of this.titanFootprint(to)) board[sq] = null;
    board[to] = piece ? { ...piece, moved: true, tags: piece.tags ? [...piece.tags] : undefined } : null;
    for (const sq of this.titanFootprint(to).slice(1)) board[sq] = { type: "x", color: "x", moved: true, tags: ["titanBody"] };
    const nextState = { ...this.state, board };
    return !require("./ChessEngine").isInCheck(nextState, color, this.currentModifiers());
  }

  getTitanLegalDestinations(from, color) {
    const piece = this.state.board[from];
    if (!this.isTitan(piece)) return [];
    const currentFootprint = new Set(this.titanFootprint(from));
    const type = piece._titanOriginalType || piece.type;
    const file = idxToFile(from);
    const rank = idxToRank(from);
    const candidates = new Set();

    const add = (f, r) => {
      if (f < 0 || f > 6 || r < 0 || r > 6) return;
      const to = toIdx(f, r);
      if (!this.titanCanOccupy(this.state.board, to, color, currentFootprint)) return;
      if (!this.titanMoveLeavesKingSafe(from, to, color)) return;
      candidates.add(to);
    };

    const addRay = (df, dr) => {
      for (let step = 1; step <= 7; step++) {
        const f = file + df * step;
        const r = rank + dr * step;
        if (f < 0 || f > 6 || r < 0 || r > 6) break;
        const to = toIdx(f, r);
        if (!this.titanCanOccupy(this.state.board, to, color, currentFootprint)) break;
        add(f, r);
        const footprint = this.titanFootprint(to);
        if (footprint.some((sq) => this.state.board[sq] && !currentFootprint.has(sq))) break;
      }
    };

    const diagonals = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const orth = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    if (type === "p") {
      const dir = color === "w" ? 1 : -1;
      add(file, rank + dir);
      add(file, rank + dir * 2);
      add(file + 1, rank + dir);
      add(file - 1, rank + dir);
      add(file + 2, rank + dir * 2);
      add(file - 2, rank + dir * 2);
    } else if (type === "n") {
      const jumps = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
      for (const [df, dr] of jumps) {
        add(file + df, rank + dr);
        add(file + df * 2, rank + dr * 2);
      }
    } else if (type === "k") {
      for (const [df, dr] of diagonals.concat(orth)) {
        add(file + df, rank + dr);
        add(file + df * 2, rank + dr * 2);
      }
    } else {
      const dirs = [];
      if (type === "b" || type === "q") dirs.push(...diagonals);
      if (type === "r" || type === "q") dirs.push(...orth);
      for (const [df, dr] of dirs) addRay(df, dr);
    }

    return [...candidates].filter((sq) => sq !== from);
  }

  applyTitanMove(from, to) {
    const piece = this.state.board[from];
    const oldFootprint = this.titanFootprint(from);
    const newFootprint = this.titanFootprint(to);
    const destroyed = [];

    for (const sq of oldFootprint) {
      if (sq !== from && this.isTitanBody(this.state.board[sq])) this.state.board[sq] = null;
    }
    this.state.board[from] = null;
    for (const sq of newFootprint) {
      const occupant = this.state.board[sq];
      if (occupant && occupant.color !== piece.color && occupant.color !== "x") destroyed.push(sq);
      this.state.board[sq] = null;
    }

    this.state.board[to] = { ...piece, moved: true, tags: piece.tags ? [...piece.tags] : ["titan"] };
    for (const sq of newFootprint.slice(1)) {
      this.state.board[sq] = { type: "x", color: "x", moved: true, tags: ["titanBody"] };
    }
    if (destroyed.length) this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: destroyed, reason: "titan" });
    this.state.lastMove = { from, to, promotion: "q" };
    this.state.turn = other(this.state.turn);
  }

  applyFansToSquare(sq) {
    const piece = this.state.board[sq];
    if (!piece || piece.color === "x" || this.isTitan(piece)) return sq;
    const fan = this.fans.find((f) => f.rank === idxToRank(sq));
    if (!fan) return sq;

    let cur = sq;
    while (true) {
      const nf = idxToFile(cur) + fan.dir;
      const rank = idxToRank(cur);
      if (nf < 0 || nf > 7) break;
      const next = toIdx(nf, rank);
      if (this.missingSquares.has(next) || this.state.board[next]) break;
      this.state.board[next] = this.state.board[cur];
      this.state.board[cur] = null;
      cur = next;
    }
    if (cur !== sq) {
      this.effects.push({
        type: "move",
        style: "fan",
        id: this.nextEffectId(),
        from: sq,
        to: cur,
        piece: this.state.board[cur] ? serializeBoard([this.state.board[cur]])[0] : null,
      });
      this.effects.push({ type: "log", id: this.nextEffectId(), text: `Fan blew a piece from ${this.squareName(sq)} to ${this.squareName(cur)}.` });
    }
    return cur;
  }

  applyFanRow(fan) {
    if (!fan || typeof fan.rank !== "number" || (fan.dir !== 1 && fan.dir !== -1)) return;
    const files = fan.dir > 0 ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    for (const file of files) {
      const sq = toIdx(file, fan.rank);
      const p = this.state.board[sq];
      if (!p || p.color === "x" || this.isTitan(p)) continue;
      const finalSq = this.applyFansToSquare(sq);
      if (finalSq !== sq) {
        this.applyHazardsAfterMove(finalSq);
        this.applySuicideBomberIfNeeded(finalSq);
      }
    }
  }

  applySuicideBomberIfNeeded(sq) {
    const piece = this.state.board[sq];
    if (!piece?.tags?.includes("suicideBomber")) return false;
    const blast = [sq];
    const f = idxToFile(sq);
    const r = idxToRank(sq);
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (!df && !dr) continue;
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        blast.push(toIdx(nf, nr));
      }
    }
    const destroyed = [];
    for (const target of blast) {
      if (!this.state.board[target]) continue;
      this.state.board[target] = null;
      destroyed.push(target);
    }
    if (destroyed.length) this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: destroyed, reason: "suicideBomber" });
    return true;
  }

  squareName(sq) {
    return String.fromCharCode(97 + idxToFile(sq)) + String(idxToRank(sq) + 1);
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
    this.hazards.asteroid = new Set(snap.hazards.asteroid || []);
    this.missingSquares = new Set(snap.missingSquares);
    this.extraMoves = { ...snap.extraMoves };
    this.shield = { ...snap.shield };
    this.marks = {
      lightning: new Set(snap.marks?.lightning || []),
      blackHole: new Set(snap.marks?.blackHole || []),
      plague: new Set(snap.marks?.plague || []),
      swap: new Set(snap.marks?.swap || []),
    };
    this.fans = (snap.fans || []).map((fan) => ({ ...fan }));
    this.ghostSquares = new Set(snap.ghostSquares || []);
    this.stickySquares = new Set(snap.stickySquares || []);
    this.backupPlanActive = { ...this.backupPlanActive, ...(snap.backupPlanActive || {}) };
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
    if (cur !== to) {
      this.effects.push({
        type: "move",
        style: "ice",
        id: this.nextEffectId(),
        from: to,
        to: cur,
        piece: this.state.board[cur] ? serializeBoard([this.state.board[cur]])[0] : null,
      });
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
    if (piece._stickyLocked) return { ok: false, error: "That piece is stuck this turn" };
    const pawnSoldierWasArmed = piece.tags?.includes("pawnSoldier");

    const mods = this.currentModifiers();
    if (this.isTitan(piece)) {
      const legalTitan = this.getTitanLegalDestinations(from, color);
      if (!legalTitan.includes(to)) return { ok: false, error: "Illegal titan move" };

      this.history.push(deepCloneState(this));
      if (this.history.length > 20) this.history.shift();

      this.applyTitanMove(from, to);
      this.ply += 1;
      let finalTo = to;
      this.lastMoveSquares = [from, to];

      const wouldCheckNext = require("./ChessEngine").isInCheck(this.state, this.state.turn, { ...mods, shield: { w: 0, b: 0 } });
      if (wouldCheckNext && this.shield[this.state.turn] > 0) this.shield[this.state.turn] -= 1;

      finalTo = this.applyFansToSquare(finalTo);
      this.applyHazardsAfterMove(finalTo);
      this.applySuicideBomberIfNeeded(finalTo);

      if (mods.kingOfHill) this.applyKingOfHill();
      if (mods.gravity || this.permanent.gravity) this.applyGravityStep();
      if (mods.randomShift) this.applyRandomShift();
      if (mods.vanishingTiles) this.refreshVanishingTiles();
      this.clearStickyLocks(color);
      this.applyStickyLanding(finalTo);
      if (mods.moveTwice) this.extraMoves[color] += 1;

      if (this.extraMoves[color] > 0) {
        this.extraMoves[color] -= 1;
        this.state.turn = color;
        this.effects.push({ type: "log", id: this.nextEffectId(), text: `${color === "w" ? "White" : "Black"} gets an extra move.` });
      }

      if (this.visualFlipPlies > 0) this.visualFlipPlies -= 1;
      if (this.colourBlindPlies > 0) this.colourBlindPlies -= 1;
      if (this.asteroidPlies > 0) {
        this.asteroidPlies -= 1;
        if (this.asteroidPlies === 0 && this.hazards.asteroid.size > 0) {
          this.hazards.asteroid.clear();
          this.effects.push({ type: "log", id: this.nextEffectId(), text: "Asteroid debris cleared." });
        }
      }
      if (this.requestTimeReverse > 0) {
        this.requestTimeReverse -= 1;
        if (this.requestTimeReverse === 0) this.timeReverseNow(2);
      }

      this.ruleManager.tickAfterPly();
      this.evaluateGameEnd();
      this.maybeStartRuleChoice();
      return { ok: true };
    }

    if (mods.mirroredMoves && this.state.lastMove) mods.requiredMove = { ...this.state.lastMove };
    const legal = generateLegalMoves(this.state, color, mods);
    const isLegal = legal.some((m) => m.from === from && m.to === to);
    if (!isLegal) return { ok: false, error: "Illegal move" };

    this.history.push(deepCloneState(this));
    if (this.history.length > 20) this.history.shift();

    const enPassantCapture = piece.type === "p" && this.state.enPassant != null && to === this.state.enPassant && !this.state.board[to];
    const capture = !!this.state.board[to] || enPassantCapture;
    const captureSquare = enPassantCapture ? toIdx(idxToFile(to), idxToRank(to) + (piece.color === "w" ? -1 : 1)) : capture ? to : null;

    const next = applyMoveNoValidation(this.state, { from, to, promotion }, mods);
    this.state = next;
    this.ply += 1;
    let finalTo = to;
    this.lastMoveSquares = [from, to];
    const baseMovePiece = serializeBoard([this.state.board[to]])[0];
    if (baseMovePiece) {
      this.effects.push({ type: "move", style: "move", id: this.nextEffectId(), from, to, piece: baseMovePiece });
    }

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

    this.demotePieceForGhostPath(this.movePathSquares(from, finalTo), finalTo);

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
      finalTo = this.applyTeleporterCorner(finalTo);
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

    // Fans blow pieces that enter their row.
    finalTo = this.applyFansToSquare(finalTo);

    // Hazards after move (includes asteroid).
    this.applyHazardsAfterMove(finalTo);

    // Suicide bomber detonates after its final landing square is known.
    this.applySuicideBomberIfNeeded(finalTo);

    if (capture) this.noteCaptureSquare(captureSquare);

    // King of the Hill: promote pieces on central squares.
    if (mods.kingOfHill) this.applyKingOfHill();

    // Gravity / shifting / vanishing tiles.
    if (mods.gravity || this.permanent.gravity) this.applyGravityStep();
    if (mods.randomShift) this.applyRandomShift();
    if (mods.vanishingTiles) this.refreshVanishingTiles();

    this.clearStickyLocks(color);
    this.applyStickyLanding(finalTo);

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
    const pawnSoldier = this.state.board[finalTo];
    if (!this.result && pawnSoldierWasArmed && pawnSoldier?.color === color && pawnSoldier.tags?.includes("pawnSoldier")) {
      pawnSoldier.tags = pawnSoldier.tags.filter((tag) => tag !== "pawnSoldier");
      this.pendingPawnSoldierShot = { playerId, color, from: finalTo };
      this.phase = "pawnSoldierShot";
    } else {
      this.maybeStartRuleChoice();
    }
    return { ok: true };
  }

  toClientState(playerId = null) {
    this.enforceRuleChoiceTimeoutIfNeeded();
    this.enforceBonusRuleChoiceTimeoutIfNeeded();
    this.enforceMiniGameTimeoutIfNeeded();
    this.enforceWagerTimeoutIfNeeded();
    this.syncDynamicMarks();
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
      blackHole: [...(this.marks?.blackHole || [])],
      plague: [...(this.marks?.plague || [])],
      swap: [...(this.marks?.swap || [])],
    };
    const pendingTarget = this.currentPendingTarget();
    const requestingColor = this.players.find((p) => p.id === playerId)?.color || null;
    const backupVitalSquare = requestingColor ? this.findBackupVitalSquare(requestingColor) : null;

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
      shield: { ...this.shield },
      marks,
      permanent: { ...this.permanent },
      missingSquares: [...this.missingSquares],
      ghostSquares: [...this.ghostSquares],
      stickySquares: [...this.stickySquares],
      backupVitalSquare,
      visualFlip: this.visualFlipPlies > 0,
      colourBlind: this.colourBlindPlies > 0,
      lastMoveSquares: this.lastMoveSquares,
      invisiblePieces: !!mods.invisiblePieces,
      visibleSquares: visibleSquares ? [...visibleSquares] : null,
      fogOfWar: !!mods.fogOfWar,
      fogOfWarSquares,
      fans: this.fans.map((fan) => ({ rank: fan.rank, side: fan.side, dir: fan.dir })),
      pendingTargetRule: pendingTarget
        ? {
            ruleId: pendingTarget.ruleId,
            playerId: pendingTarget.playerId,
            color: pendingTarget.color,
            prompt: pendingTarget.prompt,
          }
        : null,
      pendingPawnSoldierShot: this.pendingPawnSoldierShot
        ? {
            playerId: this.pendingPawnSoldierShot.playerId,
            color: this.pendingPawnSoldierShot.color,
            from: this.pendingPawnSoldierShot.from,
          }
        : null,
      rps: this.rps
        ? { active: true, round: this.rps.round, pickedByColor: { ...this.rps.pickedByColor }, deadlineMs: this.rps.deadlineMs }
        : null,
      bonusRuleChoice: this.bonusRuleChoice
        ? { active: true, playerId: this.bonusRuleChoice.playerId, remainingPicks: this.bonusRuleChoice.remainingPicks, deadlineMs: this.ruleChoiceDeadlineMs }
        : null,
      wager: this.wager
        ? {
            active: true,
            stage: this.wager.stage,
            selectedByColor: { ...this.wager.selectedByColor },
            confirmedByColor: { ...this.wager.confirmedByColor },
            assignedByColor: this.wager.assignedByColor ? { ...this.wager.assignedByColor } : null,
            outcome: this.wager.outcome,
            winner: this.wager.winner,
            loser: this.wager.loser,
            deadlineMs: this.wager.deadlineMs,
            resolveAtMs: this.wager.resolveAtMs,
            closeAtMs: this.wager.closeAtMs,
          }
        : null,
      lastMove: this.state.lastMove || null,
      resultInfo: this.resultInfo,
    };
  }
}

module.exports = { Game };
