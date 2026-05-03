const {
  initialState,
  generateLegalMoves,
  applyMoveNoValidation,
  other,
  idxToFile,
  idxToRank,
  toIdx,
  boardSizeOf,
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
          movesAs: p.movesAs ? [...p.movesAs] : null,
          hp: typeof p._hp === "number" ? p._hp : null,
          maxHp: typeof p._maxHp === "number" ? p._maxHp : null,
        }
      : null
  );
}

function remapSet(set, mapSquare) {
  return new Set([...set].map(mapSquare).filter((sq) => typeof sq === "number" && sq >= 0));
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
      board: game.state.board.map((p) => (p ? { ...p, tags: p.tags ? [...p.tags] : undefined, movesAs: p.movesAs ? [...p.movesAs] : undefined } : null)),
      castling: { w: { ...game.state.castling.w }, b: { ...game.state.castling.b } },
    },
    ply: game.ply,
    permanent: { ...game.permanent },
    hazards: { deadly: [...game.hazards.deadly], lava: [...game.hazards.lava], asteroid: [...game.hazards.asteroid] },
    missingSquares: [...game.missingSquares],
    landExpansionCount: game.landExpansionCount || 0,
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
const SUPERMARKET_COSTS = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const SUPERMARKET_BUDGET = 10;

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
    this.phase = "lobby"; // "lobby" | "play" | "ruleChoice" | "bonusRuleChoice" | "targetRule" | "mutantFusion" | "pawnSoldierShot" | "supermarket" | "rps" | "wager"

    this.result = null;
    this.resultInfo = null;

    this.readyByPlayerId = {};
    this.rematchId = (this.rematchId || 0) + 1;

    this.ruleManager = new RuleManager(this);
    this.ruleChoicesByPlayerId = {};
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = null;
    this.bonusRuleChoice = null; // active { playerId, remainingPicks }
    this.bonusRuleChoices = []; // queued bonus choices

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
    this.landExpansionCount = 0;
    this.marks = { lightning: new Set(), blackHole: new Set(), plague: new Set(), swap: new Set() };
    this.fans = [];
    this.ghostSquares = new Set();
    this.stickySquares = new Set();
    this.supermarkets = [];
    this.supermarket = null;

    this.lastMoveSquares = [];
    this.moveList = [];

    this.trailBlocks = [];
    this.requestTimeReverse = 0;
    this.history = [];
    this.pendingTargetRules = [];
    this.pendingPawnSoldierShot = null;
    this.mutantFusion = null;
    this.backupPlanActive = { w: false, b: false };
    this.matchStats = {
      captures: { w: 0, b: 0 },
      extraMoves: { w: 0, b: 0 },
      promotions: { w: 0, b: 0 },
      queensSacrificed: { w: 0, b: 0 },
      kingsExploded: { w: 0, b: 0 },
      lavaDeaths: { w: 0, b: 0 },
      ruleUses: { w: {}, b: {} },
    };

    // Mini-games.
    this.rps = null; // { round, byColor:{w,b}, pickedByColor:{w,b}, deadlineMs }

    this.onRuleEnded = (ruleId, inst = null) => {
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
      if (ruleId === "dur_supermarket_10") {
        const instanceId = inst?.instanceId || null;
        this.supermarkets = instanceId
          ? this.supermarkets.filter((market) => market.instanceId !== instanceId)
          : this.supermarkets.filter((market) => market.ruleId !== ruleId);
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
    const persistentLandExpansions = keepRules
      ? this.ruleManager.active.filter((inst) => inst.ruleId === "del_land_expansion_10" && inst.kind === "permanent").length
      : 0;
    this.state = initialState();
    this.ply = 0;
    this.result = null;
    this.resultInfo = null;
    this.readyByPlayerId = {};
    this.lastMoveSquares = [];
    this.history = [];
    this.rps = null;
    this.wager = null;
    this.supermarket = null;
    this.bonusRuleChoice = null;
    this.bonusRuleChoices = [];
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
    this.mutantFusion = null;
    this.backupPlanActive = { w: false, b: false };
    this.ghostSquares = new Set();
    this.stickySquares = new Set();
    this.supermarkets = [];
    this.missingSquares = new Set();
    this.landExpansionCount = 0;

    if (!keepRules) {
      this.ruleManager = new RuleManager(this);
      this.permanent = defaultPermanentFlags();
      this.hazards = { deadly: new Set(), lava: new Set(), asteroid: new Set() };
      this.missingSquares = new Set();
      this.landExpansionCount = 0;
      this.marks = { lightning: new Set(), blackHole: new Set(), plague: new Set(), swap: new Set() };
      this.fans = [];
      this.ghostSquares = new Set();
      this.stickySquares = new Set();
      this.supermarkets = [];
    } else {
      for (let i = 0; i < persistentLandExpansions; i++) this.expandBoard(4, { silent: true });
    }
  }

  enqueueTargetRule(targetRule) {
    if (!targetRule?.playerId || !targetRule?.color) return;
    this.pendingTargetRules.push(targetRule);
  }

  resumePendingRuleWorkOrPlay() {
    if (this.result) return false;
    if (this.pendingTargetRules.length > 0) {
      this.phase = "targetRule";
      return true;
    }
    if (this.resumeBonusRuleChoiceIfNeeded()) return true;
    this.phase = "play";
    return false;
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
      this.evaluateGameEnd();
      this.resumePendingRuleWorkOrPlay();
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
    this.evaluateGameEnd();
    this.resumePendingRuleWorkOrPlay();
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

  titanAnchorAtSquare(square) {
    if (square == null || square < 0 || square > 63) return null;
    const piece = this.state.board[square];
    if (this.isTitan(piece)) return square;
    if (!this.isTitanBody(piece)) return null;

    const candidates = [square, square - 1, square - 8, square - 9]
      .filter((sq) => sq >= 0 && sq < 64);
    for (const candidate of candidates) {
      const titan = this.state.board[candidate];
      if (!this.isTitan(titan)) continue;
      if (this.titanFootprint(candidate).includes(square)) return candidate;
    }
    return null;
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
    if (this.phase === "play" && !this.maybeStartSupermarketVisit(playerId, pending.from)) this.maybeStartRuleChoice();
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

  startMutantFusion(playerId, color) {
    if (!this.started || this.result) return { ok: false, error: "Game not active" };
    const candidates = [];
    for (let sq = 0; sq < 64; sq++) {
      const piece = this.state.board[sq];
      if (piece && piece.color === color && piece.color !== "x" && !this.isTitanBody(piece)) candidates.push(sq);
    }
    if (!candidates.length) {
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Mutant fizzled: no pieces were available." });
      return { ok: true };
    }
    this.mutantFusion = { playerId, color, selected: [] };
    this.phase = "mutantFusion";
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `${color === "w" ? "White" : "Black"} is choosing pieces to fuse.` });
    return { ok: true };
  }

  setMutantSelection(playerId, squares) {
    if (this.phase !== "mutantFusion" || !this.mutantFusion) return { ok: false, error: "No mutant fusion active" };
    if (this.mutantFusion.playerId !== playerId) return { ok: false, error: "Waiting for the other player to choose" };
    const color = this.playerColor(playerId);
    if (color !== this.mutantFusion.color) return { ok: false, error: "Bad player" };

    const uniq = [...new Set((Array.isArray(squares) ? squares : []).map((sq) => Math.floor(Number(sq))))].filter((sq) => sq >= 0 && sq < 64);
    for (const sq of uniq) {
      const piece = this.state.board[sq];
      if (!piece || piece.color !== color || piece.color === "x" || this.isTitanBody(piece)) return { ok: false, error: "Select only your own pieces" };
    }
    this.mutantFusion.selected = uniq;
    return { ok: true };
  }

  confirmMutantFusion(playerId) {
    if (this.phase !== "mutantFusion" || !this.mutantFusion) return { ok: false, error: "No mutant fusion active" };
    if (this.mutantFusion.playerId !== playerId) return { ok: false, error: "Waiting for the other player to choose" };
    const color = this.mutantFusion.color;
    const selected = (this.mutantFusion.selected || []).filter((sq) => {
      const piece = this.state.board[sq];
      return piece && piece.color === color && piece.color !== "x" && !this.isTitanBody(piece);
    });
    if (!selected.length) return { ok: false, error: "Select at least one piece" };

    const anchor = selected[0];
    const pieces = selected.map((sq) => this.state.board[sq]).filter(Boolean);
    const movesAs = [...new Set(pieces.flatMap((p) => (Array.isArray(p.movesAs) && p.movesAs.length ? p.movesAs : [p.type])).filter((type) => ["p", "n", "b", "r", "q", "k"].includes(type)))];
    const includesKing = movesAs.includes("k");
    const strongest = [...movesAs].sort((a, b) => {
      const av = a === "k" ? -1 : require("./ChessEngine").pieceValue(a);
      const bv = b === "k" ? -1 : require("./ChessEngine").pieceValue(b);
      return bv - av;
    })[0] || pieces[0].type;
    const tags = [...new Set(pieces.flatMap((p) => p.tags || []).filter((tag) => tag !== "titanBody").concat("mutant"))];
    const sourceBackup = pieces.find((p) => p._backupVital);

    const mutant = {
      ...pieces[0],
      type: includesKing ? "k" : strongest,
      color,
      moved: true,
      tags,
      movesAs,
    };
    if (sourceBackup?._backupVital) mutant._backupVital = sourceBackup._backupVital;

    for (const sq of selected) this.state.board[sq] = null;
    this.state.board[anchor] = mutant;

    this.mutantFusion = null;
    this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: selected.slice(1), reason: "mutant" });
    this.effects.push({ type: "rule", id: this.nextEffectId(), ruleId: "inst_mutant", text: `${color === "w" ? "White" : "Black"} fused ${selected.length} piece(s) into a mutant.` });
    this.evaluateGameEnd();
    this.resumePendingRuleWorkOrPlay();
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
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color, profile: p.profile || null }));
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

  playerName(playerId) {
    const p = this.players.find((pl) => pl.id === playerId);
    return p?.name || (p?.color === "w" ? "White" : p?.color === "b" ? "Black" : "Player");
  }

  noteRuleUse(color, ruleId) {
    if ((color !== "w" && color !== "b") || !ruleId) return;
    const bucket = this.matchStats?.ruleUses?.[color];
    if (!bucket) return;
    bucket[ruleId] = (bucket[ruleId] || 0) + 1;
  }

  noteCapturedPiece(attackerColor, capturedPiece) {
    if ((attackerColor !== "w" && attackerColor !== "b") || !capturedPiece || capturedPiece.color === "x") return;
    this.matchStats.captures[attackerColor] += 1;
    if (capturedPiece.type === "q" && (capturedPiece.color === "w" || capturedPiece.color === "b")) {
      this.matchStats.queensSacrificed[capturedPiece.color] += 1;
    }
  }

  addSupermarket({ square, instanceId }) {
    if (square == null || square < 0 || square > 63) return;
    this.supermarkets.push({ square, instanceId: instanceId || null, ruleId: "dur_supermarket_10" });
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Supermarket opened at ${this.squareName(square)}.` });
  }

  maybeStartSupermarketVisit(playerId, square) {
    if (this.result || this.phase !== "play") return false;
    if (square == null || !this.state.board[square] || this.state.board[square]?.color === "x") return false;
    const market = this.supermarkets.find((m) => m.square === square);
    if (!market) return false;
    const color = this.playerColor(playerId);
    if (!color || this.state.board[square].color !== color) return false;
    this.supermarket = {
      playerId,
      color,
      square,
      budget: SUPERMARKET_BUDGET,
      costs: { ...SUPERMARKET_COSTS },
    };
    this.phase = "supermarket";
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `${this.playerName(playerId)} entered the supermarket at ${this.squareName(square)}.` });
    return true;
  }

  randomEmptyBoardSquare() {
    const empty = [];
    for (let i = 0; i < 64; i++) {
      if (!this.state.board[i] && !this.missingSquares.has(i) && !this.hazards.deadly.has(i) && !this.hazards.lava.has(i) && !this.hazards.asteroid.has(i)) {
        empty.push(i);
      }
    }
    return empty.length ? empty[Math.floor(Math.random() * empty.length)] : null;
  }

  submitSupermarketPurchase(playerId, items) {
    if (this.phase !== "supermarket" || !this.supermarket) return { ok: false, error: "No supermarket is open" };
    if (this.supermarket.playerId !== playerId) return { ok: false, error: "Waiting for the other player to shop" };

    const raw = items && typeof items === "object" ? items : {};
    const counts = {};
    let total = 0;
    for (const type of Object.keys(SUPERMARKET_COSTS)) {
      const count = Math.max(0, Math.min(10, Math.floor(Number(raw[type]) || 0)));
      counts[type] = count;
      total += count * SUPERMARKET_COSTS[type];
    }
    if (total > SUPERMARKET_BUDGET) return { ok: false, error: "That costs too many coins" };

    const dropped = [];
    for (const type of ["q", "r", "b", "n", "p"]) {
      for (let i = 0; i < counts[type]; i++) {
        const sq = this.randomEmptyBoardSquare();
        if (sq == null) break;
        this.state.board[sq] = { type, color: this.supermarket.color, moved: true, tags: ["supplyCrate"] };
        dropped.push({ sq, type, color: this.supermarket.color });
        this.applyHazardsAfterMove(sq);
      }
    }

    if (dropped.length) {
      this.effects.push({ type: "supplyDrop", id: this.nextEffectId(), drops: dropped });
      this.effects.push({ type: "log", id: this.nextEffectId(), text: `Supply crate delivered ${dropped.length} piece(s).` });
    } else {
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Supermarket checkout complete, but no empty delivery square was available." });
    }

    this.supermarket = null;
    this.phase = "play";
    this.evaluateGameEnd();
    if (this.phase === "play") this.maybeStartRuleChoice();
    return { ok: true };
  }

  currentModifiers() {
    const mods = this.ruleManager.computeModifiers();
    if (this.colourBlindPlies > 0) mods.friendlyFire = true;
    mods.missingSquares = this.missingSquares;
    mods.shield = this.shield;
    mods.stickySquares = this.stickySquares;
    return mods;
  }

  legalMovesForState(state, color, mods) {
    const base = generateLegalMoves(state, color, mods);
    const seen = new Set(base.map((m) => `${m.from}:${m.to}:${m.promotion || ""}`));
    const out = [...base];

    for (let from = 0; from < state.board.length; from++) {
      const piece = state.board[from];
      if (!piece || piece.color !== color || !Array.isArray(piece.movesAs) || piece.movesAs.length <= 1) continue;
      for (const type of piece.movesAs) {
        if (!["p", "n", "b", "r", "q", "k"].includes(type) || type === piece.type) continue;
        const originalType = piece.type;
        piece.type = type;
        const legalAsType = generateLegalMoves(state, color, mods).filter((m) => m.from === from);
        piece.type = originalType;
        for (const move of legalAsType) {
          const key = `${move.from}:${move.to}:${move.promotion || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(move);
        }
      }
    }

    return out;
  }

  legalMovesForColor(color, mods) {
    return this.legalMovesForState(this.state, color, mods);
  }

  getLegalDestinations(playerId, from) {
    if (this.phase !== "play" || this.result) return [];
    const color = this.playerColor(playerId);
    if (!color) return [];
    if (color !== this.state.turn) return [];
    if (from == null || from < 0 || from >= this.state.board.length) return [];
    const titanAnchor = this.titanAnchorAtSquare(from);
    if (titanAnchor != null) from = titanAnchor;
    const p = this.state.board[from];
    if (!p || p.color !== color) return [];
    if (this.isTitan(p)) return this.getTitanLegalDestinations(from, color);

    const mods = this.currentModifiers();
    const legal = this.legalMovesForColor(color, mods);
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
      this.noteRuleUse(color, ruleId);
      this.ruleManager.addRule(ruleId, { playerId, color });

      this.bonusRuleChoice.remainingPicks -= 1;
      if (this.bonusRuleChoice.remainingPicks > 0) {
        if (this.phase !== "bonusRuleChoice" || this.pendingTargetRules.length > 0) {
          // A mini-game / interrupting phase took over; resume bonus picks once we're back to play.
          this.ruleChoicesByPlayerId = {};
          this.ruleChosenByPlayerId = {};
          this.ruleChoiceDeadlineMs = null;
          if (this.phase === "bonusRuleChoice") this.resumePendingRuleWorkOrPlay();
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
        this.resumePendingRuleWorkOrPlay();
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
      if (pick.ruleId) {
        this.noteRuleUse(pick.player.color, pick.ruleId);
        this.ruleManager.addRule(pick.ruleId, { playerId: pick.player.id, color: pick.player.color });
      }
    }

    if (this.phase === beforePhase || this.phase === "bonusRuleChoice") this.resumePendingRuleWorkOrPlay();
    this.evaluateGameEnd();
  }

  resumeBonusRuleChoiceIfNeeded() {
    while ((!this.bonusRuleChoice || this.bonusRuleChoice.remainingPicks <= 0) && this.bonusRuleChoices.length > 0) {
      this.bonusRuleChoice = this.bonusRuleChoices.shift();
    }
    if (!this.bonusRuleChoice || this.bonusRuleChoice.remainingPicks <= 0) {
      this.bonusRuleChoice = null;
      return false;
    }
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

    const picks = Math.max(1, Number(extraPicks) || 0);
    let target = null;
    if (this.bonusRuleChoice?.playerId === playerId) {
      target = this.bonusRuleChoice;
    } else {
      target = this.bonusRuleChoices.find((choice) => choice.playerId === playerId) || null;
    }
    if (!target) {
      target = { playerId, remainingPicks: 0 };
      this.bonusRuleChoices.push(target);
    }
    target.remainingPicks += picks;

    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Pot of Greed! ${this.playerName(playerId)} will pick ${target.remainingPicks} extra rule(s).` });
    if (this.phase === "play") this.resumeBonusRuleChoiceIfNeeded();
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
        this.ruleChoicesByPlayerId[p.id] = this.debugMode ? this.ruleManager.allChoices() : this.ruleManager.randomChoices(3);
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
      this.bonusRuleChoice = null;
      this.resumePendingRuleWorkOrPlay();
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
    this.bonusRuleChoice = null;
    this.ruleChoicesByPlayerId = {};
    this.ruleChosenByPlayerId = {};
    this.ruleChoiceDeadlineMs = null;
    this.resumePendingRuleWorkOrPlay();
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
    this.evaluateGameEnd();
    this.resumePendingRuleWorkOrPlay();
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
        this.evaluateGameEnd();
        this.resumePendingRuleWorkOrPlay();
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
    for (let i = 0; i < this.state.board.length; i++) {
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
    const legal = this.legalMovesForColor(color, mods);
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
    if (toSquare == null || toSquare < 0 || toSquare > 63) return false;
    let changed = false;
    if (this.hazards.deadly.has(toSquare) || this.hazards.lava.has(toSquare)) {
      const p = this.state.board[toSquare];
      if (p && p.color !== "x") {
        if (this.hazards.lava.has(toSquare) && (p.color === "w" || p.color === "b")) this.matchStats.lavaDeaths[p.color] += 1;
        if (p.type === "k" && (p.color === "w" || p.color === "b")) this.matchStats.kingsExploded[p.color] += 1;
        this.state.board[toSquare] = null;
        this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [toSquare], reason: "hazard" });
        changed = true;
      }
    }
    // Asteroid debris: destroy piece that lands on it, then remove the debris.
    if (this.hazards.asteroid.has(toSquare)) {
      const p = this.state.board[toSquare];
      if (p && p.color !== "x") {
        if (p.type === "k" && (p.color === "w" || p.color === "b")) this.matchStats.kingsExploded[p.color] += 1;
        this.state.board[toSquare] = null;
        this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [toSquare], reason: "asteroid" });
        changed = true;
      }
      this.hazards.asteroid.delete(toSquare);
    }
    return changed;
  }

  applyHazardsToAllPieces() {
    let changed = false;
    for (let sq = 0; sq < 64; sq++) {
      if (!this.state.board[sq] || this.state.board[sq]?.color === "x") continue;
      if (this.applyHazardsAfterMove(sq)) changed = true;
    }
    return changed;
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
    this.applyHazardsToAllPieces();
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
    const size = boardSizeOf(this.state);
    const fromFile = from % size;
    const fromRank = Math.floor(from / size);
    const toFile = to % size;
    const toRank = Math.floor(to / size);
    const mirrorFrom = fromRank * size + (size - 1 - fromFile);
    const mirrorTo = toRank * size + (size - 1 - toFile);

    if (this.missingSquares.has(mirrorFrom) || this.missingSquares.has(mirrorTo)) return;

    const piece = this.state.board[mirrorFrom];
    if (!piece || piece.color === "x" || piece.type === "k") return;

    // Destroy whatever is on the mirror destination (if enemy or neutral).
    const target = this.state.board[mirrorTo];
    if (target && target.type === "k") return; // never destroy a king via echo
    if (target) {
      this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: [mirrorTo], reason: "echoChamber" });
    }

    this.state.board[mirrorTo] = {
      ...piece,
      moved: true,
      tags: piece.tags ? [...piece.tags] : undefined,
      movesAs: piece.movesAs ? [...piece.movesAs] : undefined,
    };
    this.state.board[mirrorFrom] = null;
    this.effects.push({
      type: "move",
      style: "move",
      id: this.nextEffectId(),
      from: mirrorFrom,
      to: mirrorTo,
      piece: serializeBoard([this.state.board[mirrorTo]])[0],
    });
    this.applyHazardsAfterMove(mirrorTo);
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
    this.applyHazardsAfterMove(dest);
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
      if (occupant.type === "k") return false;
      if (this.isTitan(occupant) || this.isTitanBody(occupant)) return false;
    }
    return true;
  }

  titanMovementState(from) {
    const board = this.state.board.map((p) => (p ? { ...p, tags: p.tags ? [...p.tags] : undefined, movesAs: p.movesAs ? [...p.movesAs] : undefined } : null));
    const piece = board[from];
    const currentFootprint = new Set(this.titanFootprint(from));
    for (const sq of currentFootprint) {
      if (sq !== from) board[sq] = null;
    }
    if (piece) {
      piece.tags = (piece.tags || []).filter((tag) => tag !== "titan" && tag !== "titanBody");
    }
    return { ...this.state, board };
  }

  normalizeTitanMoveTarget(from, clickedSquare, color) {
    if (clickedSquare == null || clickedSquare < 0 || clickedSquare > 63) return null;
    const legalAnchors = this.getTitanLegalDestinations(from, color);
    if (!legalAnchors.length) return null;

    if (legalAnchors.includes(clickedSquare)) return clickedSquare;

    const matches = legalAnchors.filter((anchor) => this.titanFootprint(anchor).includes(clickedSquare));
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];

    const clickedFile = idxToFile(clickedSquare);
    const clickedRank = idxToRank(clickedSquare);
    matches.sort((a, b) => {
      const af = idxToFile(a) + 0.5;
      const ar = idxToRank(a) + 0.5;
      const bf = idxToFile(b) + 0.5;
      const br = idxToRank(b) + 0.5;
      const da = Math.abs(af - clickedFile) + Math.abs(ar - clickedRank);
      const db = Math.abs(bf - clickedFile) + Math.abs(br - clickedRank);
      return da - db;
    });
    return matches[0];
  }

  titanMoveLeavesKingSafe(from, to, color) {
    const nextState = this.titanMovementState(from);
    const board = nextState.board;
    const piece = board[from];
    for (const sq of this.titanFootprint(to)) board[sq] = null;
    board[from] = null;
    board[to] = piece ? { ...piece, moved: true, tags: piece.tags ? [...piece.tags] : undefined, movesAs: piece.movesAs ? [...piece.movesAs] : undefined } : null;
    for (const sq of this.titanFootprint(to).slice(1)) board[sq] = { type: "x", color: "x", moved: true, tags: ["titanBody"] };
    return !require("./ChessEngine").isInCheck(nextState, color, this.currentModifiers());
  }

  getTitanLegalDestinations(from, color) {
    const piece = this.state.board[from];
    if (!this.isTitan(piece)) return [];
    const currentFootprint = new Set(this.titanFootprint(from));
    const candidates = new Set();
    const movementState = this.titanMovementState(from);
    const legal = this.legalMovesForState(movementState, color, this.currentModifiers())
      .filter((move) => move.from === from)
      .map((move) => move.to);

    for (const to of legal) {
      if (!this.titanCanOccupy(this.state.board, to, color, currentFootprint)) continue;
      if (!this.titanMoveLeavesKingSafe(from, to, color)) continue;
      candidates.add(to);
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
      if (occupant && occupant.type !== "k") destroyed.push(sq);
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

    this.applyFanRow(fan);
    for (let i = 0; i < 64; i++) {
      if (this.state.board[i] === piece) return i;
    }
    return sq;
  }

  applyFanRow(fan) {
    if (!fan || typeof fan.rank !== "number" || (fan.dir !== 1 && fan.dir !== -1)) return;
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 8) {
      changed = false;
      const segments = [];
      let cur = [];
      for (let file = 0; file < 8; file++) {
        const sq = toIdx(file, fan.rank);
        const occupant = this.state.board[sq];
        const blocksFan = this.missingSquares.has(sq) || occupant?.color === "x" || this.isTitan(occupant);
        if (blocksFan) {
          if (cur.length) segments.push(cur);
          cur = [];
        } else {
          cur.push(sq);
        }
      }
      if (cur.length) segments.push(cur);

      const movedTo = [];
      for (const segment of segments) {
        const pieces = segment
          .map((sq) => ({ sq, p: this.state.board[sq] }))
          .filter(({ p }) => p && p.color !== "x" && !this.isTitan(p));
        if (!pieces.length) continue;

        const targets = fan.dir > 0 ? segment.slice(-pieces.length) : segment.slice(0, pieces.length);
        if (fan.dir > 0) pieces.sort((a, b) => idxToFile(a.sq) - idxToFile(b.sq));
        else pieces.sort((a, b) => idxToFile(a.sq) - idxToFile(b.sq));

        for (const sq of segment) {
          const p = this.state.board[sq];
          if (p && p.color !== "x" && !this.isTitan(p)) this.state.board[sq] = null;
        }

        for (let i = 0; i < pieces.length; i++) {
          const from = pieces[i].sq;
          const to = targets[i];
          this.state.board[to] = pieces[i].p;
          if (from !== to) {
            changed = true;
            movedTo.push(to);
            this.effects.push({
              type: "move",
              style: "fan",
              id: this.nextEffectId(),
              from,
              to,
              piece: serializeBoard([pieces[i].p])[0],
            });
            this.effects.push({ type: "log", id: this.nextEffectId(), text: `Fan blew a piece from ${this.squareName(from)} to ${this.squareName(to)}.` });
          }
        }
      }

      for (const sq of movedTo) {
        const hazardChanged = this.applyHazardsAfterMove(sq);
        const bombChanged = this.applySuicideBomberIfNeeded(sq);
        if (hazardChanged || bombChanged) changed = true;
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
    const size = boardSizeOf(this.state);
    return String.fromCharCode(97 + (sq % size)) + String(Math.floor(sq / size) + 1);
  }

  expandBoard(extra = 4, options = {}) {
    const oldSize = boardSizeOf(this.state);
    const growBy = Math.max(2, Number(extra) || 4);
    const blockSize = growBy;
    let ringSide = 2;
    let offset = this.landExpansionCount || 0;
    while (offset >= ringSide * 2 + 1) {
      offset -= ringSide * 2 + 1;
      ringSide += 1;
    }
    const targetBlock =
      offset <= ringSide
        ? { x: ringSide, y: offset }
        : { x: ringSide - 1 - (offset - ringSide - 1), y: ringSide };
    const newSize = Math.max(oldSize, (Math.max(targetBlock.x, targetBlock.y) + 1) * blockSize);
    const mapSquare = (sq) => {
      if (typeof sq !== "number" || sq < 0) return sq;
      const file = sq % oldSize;
      const rank = Math.floor(sq / oldSize);
      return rank * newSize + file;
    };
    const nextBoard = Array(newSize * newSize).fill(null);
    for (let sq = 0; sq < this.state.board.length; sq++) {
      nextBoard[mapSquare(sq)] = this.state.board[sq];
    }

    const playableSquares = new Set();
    for (let sq = 0; sq < this.state.board.length; sq++) {
      if (!this.missingSquares.has(sq)) playableSquares.add(mapSquare(sq));
    }
    const patchSquares = new Set();
    const patchStartFile = targetBlock.x * blockSize;
    const patchStartRank = targetBlock.y * blockSize;
    for (let rank = patchStartRank; rank < patchStartRank + blockSize; rank++) {
      for (let file = patchStartFile; file < patchStartFile + blockSize; file++) {
        const sq = rank * newSize + file;
        patchSquares.add(sq);
        playableSquares.add(sq);
      }
    }
    const nextMissingSquares = new Set();
    for (let sq = 0; sq < newSize * newSize; sq++) {
      if (!playableSquares.has(sq)) nextMissingSquares.add(sq);
    }

    this.state = {
      ...this.state,
      boardSize: newSize,
      board: nextBoard,
      enPassant: this.state.enPassant == null ? null : mapSquare(this.state.enPassant),
      lastMove: this.state.lastMove
        ? { ...this.state.lastMove, from: mapSquare(this.state.lastMove.from), to: mapSquare(this.state.lastMove.to) }
        : this.state.lastMove,
    };

    this.lastMoveSquares = (this.lastMoveSquares || []).map(mapSquare);
    this.missingSquares = nextMissingSquares;
    this.hazards.deadly = remapSet(this.hazards.deadly, mapSquare);
    this.hazards.lava = remapSet(this.hazards.lava, mapSquare);
    this.hazards.asteroid = remapSet(this.hazards.asteroid, mapSquare);
    this.ghostSquares = remapSet(this.ghostSquares, mapSquare);
    this.stickySquares = remapSet(this.stickySquares, mapSquare);
    this.trailBlocks = (this.trailBlocks || []).map(mapSquare);
    for (const key of Object.keys(this.marks || {})) this.marks[key] = remapSet(this.marks[key], mapSquare);
    this.supermarkets = this.supermarkets.map((market) => ({ ...market, square: mapSquare(market.square) }));
    if (this.supermarket) this.supermarket = { ...this.supermarket, square: mapSquare(this.supermarket.square) };
    this.landExpansionCount = (this.landExpansionCount || 0) + 1;
    if (!options.silent) this.effects.push({ type: "rule", id: this.nextEffectId(), text: `Land Expansion added a 4x4 territory to the board edge.` });
    return newSize;
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
    this.landExpansionCount = snap.landExpansionCount || 0;
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
      movesAs: p.movesAs ? [...p.movesAs] : undefined,
    });

    for (const sq of pathSquares) {
      if (this.missingSquares.has(sq)) continue;
      if (this.state.board[sq]?.type === "k") continue;
      this.state.board[sq] = clonePiece(movedPiece);
      this.applyHazardsAfterMove(sq);
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
    if (from < 0 || from >= this.state.board.length || to < 0 || to >= this.state.board.length) return { ok: false, error: "Bad move" };

    const titanAnchor = this.titanAnchorAtSquare(from);
    if (titanAnchor != null) from = titanAnchor;
    const piece = this.state.board[from];
    if (!piece || piece.color !== color) return { ok: false, error: "No piece" };
    if (piece._stickyLocked) return { ok: false, error: "That piece is stuck this turn" };
    const pawnSoldierWasArmed = piece.tags?.includes("pawnSoldier");

    const mods = this.currentModifiers();
    if (this.isTitan(piece)) {
      const titanTarget = this.normalizeTitanMoveTarget(from, to, color);
      if (titanTarget == null) return { ok: false, error: "Illegal titan move" };
      to = titanTarget;
      const legalTitan = this.getTitanLegalDestinations(from, color);
      if (!legalTitan.includes(to)) return { ok: false, error: "Illegal titan move" };

      this.history.push(deepCloneState(this));
      if (this.history.length > 20) this.history.shift();

      this.applyTitanMove(from, to);
      this.ply += 1;
      this.moveList.push(`${this.squareName(from)}-${this.squareName(to)}`);
      let finalTo = to;
      this.lastMoveSquares = [from, to];

      const wouldCheckNext = require("./ChessEngine").isInCheck(this.state, this.state.turn, { ...mods, shield: { w: 0, b: 0 } });
      if (wouldCheckNext && this.shield[this.state.turn] > 0) this.shield[this.state.turn] -= 1;

      finalTo = this.applyFansToSquare(finalTo);
      this.applyHazardsAfterMove(finalTo);
      this.applySuicideBomberIfNeeded(finalTo);

      const sourceFan = this.fans.find((f) => f.rank === idxToRank(from));
      if (sourceFan && idxToRank(finalTo) !== idxToRank(from)) this.applyFanRow(sourceFan);

      if (mods.kingOfHill) this.applyKingOfHill();
      if (mods.gravity || this.permanent.gravity) this.applyGravityStep();
      if (mods.randomShift) this.applyRandomShift();
      if (mods.vanishingTiles) this.refreshVanishingTiles();
      this.applyHazardsToAllPieces();
      this.clearStickyLocks(color);
      this.applyStickyLanding(finalTo);
      if (mods.moveTwice) {
        this.extraMoves[color] += 1;
        this.matchStats.extraMoves[color] += 1;
      }

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
      if (this.phase === "play" && !this.maybeStartSupermarketVisit(playerId, finalTo)) this.maybeStartRuleChoice();
      return { ok: true };
    }

    const legal = this.legalMovesForColor(color, mods);
    const isLegal = legal.some((m) => m.from === from && m.to === to);
    if (!isLegal) return { ok: false, error: "Illegal move" };

    this.history.push(deepCloneState(this));
    if (this.history.length > 20) this.history.shift();

    const enPassantCapture = piece.type === "p" && this.state.enPassant != null && to === this.state.enPassant && !this.state.board[to];
    const capture = !!this.state.board[to] || enPassantCapture;
    const captureSquare = enPassantCapture ? toIdx(idxToFile(to), idxToRank(to) + (piece.color === "w" ? -1 : 1)) : capture ? to : null;
    const capturedPiece = captureSquare != null && this.state.board[captureSquare] ? { ...this.state.board[captureSquare] } : null;

    const next = applyMoveNoValidation(this.state, { from, to, promotion }, mods);
    this.state = next;
    this.ply += 1;
    this.moveList.push(`${this.squareName(from)}-${this.squareName(to)}`);
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
        if (!this.state.board[sq] && !this.missingSquares.has(sq) && !this.hazards.deadly.has(sq) && !this.hazards.lava.has(sq) && !this.hazards.asteroid.has(sq)) {
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

    const sourceFan = this.fans.find((f) => f.rank === idxToRank(from));
    if (sourceFan && idxToRank(finalTo) !== idxToRank(from)) this.applyFanRow(sourceFan);

    if (capture) {
      this.noteCaptureSquare(captureSquare);
      this.noteCapturedPiece(color, capturedPiece);
    }

    // King of the Hill: promote pieces on central squares.
    if (mods.kingOfHill) this.applyKingOfHill();

    // Gravity / shifting / vanishing tiles.
    if (mods.gravity || this.permanent.gravity) this.applyGravityStep();
    if (mods.randomShift) this.applyRandomShift();
    if (mods.vanishingTiles) this.refreshVanishingTiles();
    this.applyHazardsToAllPieces();

    this.clearStickyLocks(color);
    this.applyStickyLanding(finalTo);

    // Move-twice.
    if (piece.type === "p") {
      const promotionRank = color === "w" ? 7 : 0;
      const promoted = idxToRank(to) === promotionRank && this.state.board[to]?.type !== "p";
      if (promoted) this.matchStats.promotions[color] += 1;
    }

    if (mods.moveTwice) {
      this.extraMoves[color] += 1;
      this.matchStats.extraMoves[color] += 1;
    }

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
      if (this.phase === "play" && !this.maybeStartSupermarketVisit(playerId, finalTo)) this.maybeStartRuleChoice();
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
      for (let i = 0; i < this.state.board.length; i++) if (this.state.board[i]?.type === "k") visibleSquares.add(i);
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
    const adAttack =
      !!requestingColor &&
      this.ruleManager.active.some(
        (inst) => inst.ruleId === "dur_ads_7" && inst.kind === "duration" && inst.data?.targetColor === requestingColor
      );

    return {
      roomCode: this.roomCode,
      started: this.started,
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color, profile: p.profile || null })),
      board: serializeBoard(board),
      boardSize: boardSizeOf(this.state),
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
      adAttack,
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
      mutantFusion: this.mutantFusion
        ? {
            active: true,
            playerId: this.mutantFusion.playerId,
            color: this.mutantFusion.color,
            selected: [...(this.mutantFusion.selected || [])],
          }
        : null,
      supermarkets: this.supermarkets.map((market) => ({ square: market.square, instanceId: market.instanceId })),
      supermarket: this.supermarket
        ? {
            active: true,
            playerId: this.supermarket.playerId,
            color: this.supermarket.color,
            square: this.supermarket.square,
            budget: this.supermarket.budget,
            costs: { ...this.supermarket.costs },
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
