const {
  FRUIT_MACHINE_SPINS,
  FRUIT_MACHINE_TYPES,
  SUPERMARKET_BUDGET,
  SUPERMARKET_COSTS,
} = require("./stateUtils");

const miniGameMethods = {
  addSupermarket({ square, instanceId }) {
    if (square == null || square < 0 || square > 63) return;
    this.supermarkets.push({ square, instanceId: instanceId || null, ruleId: "dur_supermarket_10" });
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Supermarket opened at ${this.squareName(square)}.` });
  },

  addFruitMachine({ square, instanceId }) {
    if (square == null || square < 0 || square >= this.state.board.length) return;
    this.fruitMachines.push({ square, instanceId: instanceId || null, ruleId: "del_fruit_machine_5" });
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Fruit Machine opened at ${this.squareName(square)}.` });
  },

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
  },

  maybeStartFruitMachineVisit(playerId, square) {
    if (this.result || this.phase !== "play") return false;
    if (square == null || !this.state.board[square] || this.state.board[square]?.color === "x") return false;
    const index = this.fruitMachines.findIndex((machine) => machine.square === square);
    if (index < 0) return false;
    const color = this.playerColor(playerId);
    if (!color || this.state.board[square].color !== color) return false;
    const [machine] = this.fruitMachines.splice(index, 1);
    this.fruitMachine = {
      active: true,
      playerId,
      color,
      square,
      instanceId: machine.instanceId || null,
      spinsRemaining: FRUIT_MACHINE_SPINS,
      spinsUsed: 0,
      results: [],
      prizes: {},
    };
    this.phase = "fruitMachine";
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `${this.playerName(playerId)} found the fruit machine at ${this.squareName(square)}.` });
    return true;
  },

  randomEmptyBoardSquare() {
    const empty = [];
    const blocked = new Set([
      ...(this.supermarkets || []).map((market) => market.square),
      ...(this.fruitMachines || []).map((machine) => machine.square),
    ]);
    for (let i = 0; i < this.state.board.length; i++) {
      if (!this.state.board[i] && !blocked.has(i) && !this.missingSquares.has(i) && !this.hazards.deadly.has(i) && !this.hazards.lava.has(i) && !this.hazards.asteroid.has(i)) {
        empty.push(i);
      }
    }
    return empty.length ? empty[Math.floor(Math.random() * empty.length)] : null;
  },

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
  },

  submitFruitMachineSpin(playerId) {
    if (this.phase !== "fruitMachine" || !this.fruitMachine) return { ok: false, error: "No fruit machine is open" };
    if (this.fruitMachine.playerId !== playerId) return { ok: false, error: "Waiting for the other player to spin" };
    if (this.fruitMachine.complete) return { ok: false, error: "Fruit machine is ready to pay out" };
    if (this.fruitMachine.spinsRemaining <= 0) return { ok: false, error: "No spins left" };

    const wheels = [0, 1, 2].map(() => FRUIT_MACHINE_TYPES[Math.floor(Math.random() * FRUIT_MACHINE_TYPES.length)]);
    const counts = wheels.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    let winType = null;
    let prizeCount = 0;
    for (const [type, count] of Object.entries(counts)) {
      if (count === 3) {
        winType = type;
        prizeCount = 2;
        break;
      }
      if (count === 2) {
        winType = type;
        prizeCount = 1;
      }
    }

    if (winType && prizeCount > 0) {
      this.fruitMachine.prizes[winType] = (this.fruitMachine.prizes[winType] || 0) + prizeCount;
    }
    this.fruitMachine.spinsRemaining -= 1;
    this.fruitMachine.spinsUsed += 1;
    this.fruitMachine.results.push({ wheels, winType, prizeCount });

    if (this.fruitMachine.spinsRemaining <= 0) this.fruitMachine.complete = true;
    return { ok: true };
  },

  collectFruitMachinePrizes(playerId) {
    if (this.phase !== "fruitMachine" || !this.fruitMachine) return { ok: false, error: "No fruit machine is open" };
    if (this.fruitMachine.playerId !== playerId) return { ok: false, error: "Waiting for the other player to collect" };
    if (!this.fruitMachine.complete) return { ok: false, error: "The fruit machine still has spins left" };
    const prizes = { ...this.fruitMachine.prizes };
    const color = this.fruitMachine.color;
    const dropped = [];
    for (const type of ["q", "r", "b", "n", "p", "k"]) {
      const maxCount = type === "k" ? Math.min(1, prizes[type] || 0) : prizes[type] || 0;
      for (let i = 0; i < maxCount; i++) {
        const sq = this.randomEmptyBoardSquare();
        if (sq == null) break;
        this.state.board[sq] = { type, color, moved: true, tags: ["supplyCrate"] };
        dropped.push({ sq, type, color });
        this.applyHazardsAfterMove(sq);
      }
    }

    if (dropped.length) {
      this.effects.push({ type: "supplyDrop", id: this.nextEffectId(), drops: dropped });
      this.effects.push({ type: "log", id: this.nextEffectId(), text: `Fruit Machine paid out ${dropped.length} piece(s).` });
    } else {
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Fruit Machine finished with no pieces to deliver." });
    }

    this.fruitMachine = null;
    this.phase = "play";
    this.evaluateGameEnd();
    if (this.phase === "play") this.maybeStartRuleChoice();
    return { ok: true };
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  confirmWager(playerId) {
    if (this.phase !== "wager" || !this.wager) return { ok: false, error: "No wager active" };
    if (this.wager.stage !== "select") return { ok: false, error: "Wager already locked in" };

    const color = this.playerColor(playerId);
    if (color !== "w" && color !== "b") return { ok: false, error: "Not a player" };

    this.wager.confirmedByColor[color] = true;
    this.beginWagerFlipIfReady();
    return { ok: true };
  },

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
  },

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
};

module.exports = { miniGameMethods };
