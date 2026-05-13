const {
  FRUIT_MACHINE_SPINS,
  FRUIT_MACHINE_TYPES,
  SUPERMARKET_BUDGET,
  SUPERMARKET_COSTS,
} = require("./stateUtils");
const { idxToFile, idxToRank, toIdx } = require("./ChessEngine");

const BOARD_OBJECT_CONFIG = {
  parkingMeters: { ruleId: "dur_parking_meter_8", label: "Parking Meter" },
  vendingMachines: { ruleId: "del_vending_machine_4", label: "Vending Machine" },
  portaloos: { ruleId: "dur_portaloo_6", label: "Portaloo" },
  lostPropertyOffices: { ruleId: "del_lost_property_5", label: "Lost Property Office" },
  roadworksCones: { ruleId: "dur_roadworks_7", label: "Roadworks" },
  fountains: { ruleId: "dur_fountain_6", label: "The Fountain" },
  complaintDepartments: { ruleId: "dur_complaint_department_8", label: "Complaint Department" },
};

const PIECE_TYPES = ["q", "r", "b", "n", "p"];

function adjacentSquares(sq) {
  const out = [];
  const f = idxToFile(sq);
  const r = idxToRank(sq);
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      out.push(toIdx(nf, nr));
    }
  }
  return out;
}

function pieceTier(type, dir) {
  const up = { p: "n", n: "b", b: "r", r: "q", q: "q" };
  const down = { q: "r", r: "b", b: "n", n: "p", p: "p" };
  return (dir > 0 ? up : down)[type] || type;
}

const miniGameMethods = {
  boardObjectBlockedSquares() {
    return [
      ...(this.supermarkets || []).map((market) => market.square),
      ...(this.fruitMachines || []).map((machine) => machine.square),
      ...Object.values(this.boardObjects || {}).flatMap((items) => (items || []).map((item) => item.square)),
    ];
  },

  addBoardObject(kind, { square, instanceId, ruleId } = {}) {
    if (!BOARD_OBJECT_CONFIG[kind]) return false;
    if (square == null || square < 0 || square >= this.state.board.length) return false;
    if (!this.boardObjects) this.boardObjects = {};
    if (!Array.isArray(this.boardObjects[kind])) this.boardObjects[kind] = [];
    this.boardObjects[kind].push({
      square,
      instanceId: instanceId || null,
      ruleId: ruleId || BOARD_OBJECT_CONFIG[kind].ruleId,
    });
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `${BOARD_OBJECT_CONFIG[kind].label} opened at ${this.squareName(square)}.` });
    return true;
  },

  addRoadworks({ squares, instanceId } = {}) {
    for (const square of squares || []) this.addBoardObject("roadworksCones", { square, instanceId, ruleId: "dur_roadworks_7" });
  },

  removeBoardObjectsForRule(ruleId, instanceId = null) {
    if (!this.boardObjects) return;
    for (const [kind, items] of Object.entries(this.boardObjects)) {
      const removed = [];
      this.boardObjects[kind] = (items || []).filter((item) => {
        const match = instanceId ? item.instanceId === instanceId : item.ruleId === ruleId;
        if (match) removed.push(item);
        return !match;
      });
      if (kind === "roadworksCones") {
        for (const item of removed) {
          if (this.state.board[item.square]?.tags?.includes("roadCone")) this.state.board[item.square] = null;
        }
      }
    }
  },

  closeBoardPopup() {
    this.boardPopup = null;
    this.evaluateGameEnd();
    this.resumePendingRuleWorkOrPlay();
  },

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
    const blocked = new Set(this.boardObjectBlockedSquares());
    for (let i = 0; i < this.state.board.length; i++) {
      if (!this.state.board[i] && !blocked.has(i) && !this.missingSquares.has(i) && !this.hazards.deadly.has(i) && !this.hazards.lava.has(i) && !this.hazards.asteroid.has(i)) {
        empty.push(i);
      }
    }
    return empty.length ? empty[Math.floor(Math.random() * empty.length)] : null;
  },

  startBoardPopup({ kind, playerId, color, square, title, status, options, pieces, data, stage }) {
    this.boardPopup = { kind, playerId, color, square, title, status, options, pieces, data, stage };
    this.phase = "boardPopup";
    return true;
  },

  maybeStartBoardObjectVisit(playerId, square) {
    if (this.result || this.phase !== "play") return false;
    if (square == null || !this.state.board[square] || this.state.board[square]?.color === "x") return false;
    const color = this.playerColor(playerId);
    if (!color || this.state.board[square].color !== color) return false;

    const find = (kind) => (this.boardObjects?.[kind] || []).findIndex((item) => item.square === square);
    if (find("parkingMeters") >= 0) {
      return this.startBoardPopup({
        kind: "parkingMeter",
        playerId,
        color,
        square,
        title: "Parking Meter",
        status: "This piece has parked in a controlled zone.",
        options: [
          { id: "pay", label: "Pay pawn", detail: "Sacrifice one pawn for an extra move." },
          { id: "ignore", label: "Ignore it", detail: "This piece is clamped next turn." },
          { id: "kick", label: "Kick meter", detail: "50% chance to explode nearby pieces." },
        ],
      });
    }

    const vendingIndex = find("vendingMachines");
    if (vendingIndex >= 0) {
      const snacks = [
        { id: "shield", label: "Blue Rookade", detail: "Gain one king shield." },
        { id: "promote", label: "Promotion Crisps", detail: "This piece promotes one tier." },
        { id: "duplicate", label: "Copy Cola", detail: "A pawn copy drops nearby if possible." },
      ].sort(() => Math.random() - 0.5);
      return this.startBoardPopup({
        kind: "vendingMachine",
        playerId,
        color,
        square,
        title: "Vending Machine",
        status: "Pick a snack. The machine keeps the wrapper.",
        options: snacks,
      });
    }

    if (find("portaloos") >= 0) {
      return this.startBoardPopup({
        kind: "portaloo",
        playerId,
        color,
        square,
        title: "Portaloo",
        status: "The door rattles. Terrible blue light leaks out.",
        options: [
          { id: "enter", label: "Enter", detail: "Teleport somewhere random, with consequences." },
          { id: "leave", label: "Back away", detail: "Nothing happens." },
        ],
      });
    }

    const lostIndex = find("lostPropertyOffices");
    if (lostIndex >= 0) {
      const pieces = (this.capturedPieces || [])
        .slice(-12)
        .filter((p) => p.type !== "k")
        .map((p, i) => ({ id: `${i}`, type: p.type, color: p.color, originalIndex: (this.capturedPieces || []).lastIndexOf(p) }))
        .slice(-3);
      return this.startBoardPopup({
        kind: "lostProperty",
        playerId,
        color,
        square,
        title: "Lost Property",
        status: pieces.length ? "Claim one suspiciously labelled captured piece." : "The box is empty except for old receipts.",
        pieces,
        options: pieces.length ? [] : [{ id: "close", label: "Leave", detail: "No lost pieces to claim." }],
      });
    }

    if (find("fountains") >= 0) {
      return this.startBoardPopup({
        kind: "fountain",
        playerId,
        color,
        square,
        title: "The Fountain",
        status: "Make a wish, then everyone nearby gets splashed.",
        options: [
          { id: "power", label: "Wish for power", detail: "Promote this piece one tier." },
          { id: "peace", label: "Wish for peace", detail: "Add a temporary shield." },
          { id: "splash", label: "Just splash", detail: "Push adjacent pieces away." },
        ],
      });
    }

    if (find("complaintDepartments") >= 0) {
      return this.startBoardPopup({
        kind: "complaint",
        playerId,
        color,
        square,
        title: "Complaint Department",
        status: "File one complaint about the current state of the board.",
        options: [
          { id: "hazard", label: "Remove hazard", detail: "Clears one lava/deadly/asteroid square." },
          { id: "ads", label: "Close ads", detail: "Ends active Ads rules targeting you." },
          { id: "unstick", label: "Unstick board", detail: "Clears sticky squares and sticky locks." },
          { id: "restore", label: "Restore pawn", detail: "Returns one captured pawn if available." },
        ],
      });
    }

    return false;
  },

  submitBoardPopupChoice(playerId, choiceId) {
    if (this.phase !== "boardPopup" || !this.boardPopup) return { ok: false, error: "No popup is open" };
    if (this.boardPopup.playerId !== playerId) return { ok: false, error: "Waiting for the other player" };
    const popup = this.boardPopup;
    const piece = this.state.board[popup.square];
    if (!piece && !["terms", "prizeWheel", "auction", "survey"].includes(popup.kind)) return { ok: false, error: "The piece left the popup behind" };

    if (popup.kind === "parkingMeter") return this.resolveParkingMeter(choiceId);
    if (popup.kind === "vendingMachine") return this.resolveVendingMachine(choiceId);
    if (popup.kind === "portaloo") return this.resolvePortaloo(choiceId);
    if (popup.kind === "fountain") return this.resolveFountain(choiceId);
    if (popup.kind === "complaint") return this.resolveComplaint(choiceId);
    if (popup.kind === "lostProperty") return this.resolveLostProperty(choiceId);
    if (popup.kind === "terms") return this.resolveTerms(choiceId);
    if (popup.kind === "survey") return this.resolveSurvey(choiceId);
    if (popup.kind === "prizeWheel") return this.resolvePrizeWheel(choiceId);
    if (popup.kind === "auction") return this.resolveAuction(choiceId);
    this.closeBoardPopup();
    return { ok: true };
  },

  startTermsConditions(playerId, color) {
    const targetColor = color === "w" ? "b" : "w";
    const target = this.players.find((p) => p.color === targetColor);
    if (!target) return { ok: false, error: "Need opponent" };
    this.startBoardPopup({
      kind: "terms",
      playerId: target.id,
      color: targetColor,
      square: null,
      title: "Terms and Conditions",
      status: "Please review the updated board agreement before continuing.",
      options: [
        { id: "agree", label: "I agree", detail: "Continue the game." },
        { id: "decline", label: "Decline", detail: "Hidden loophole: gain a shield, but lose one pawn." },
      ],
    });
    return { ok: true };
  },

  startCustomerSurvey(playerId, color) {
    const targetColor = color === "w" ? "b" : "w";
    const target = this.players.find((p) => p.color === targetColor);
    if (!target) return { ok: false, error: "Need opponent" };
    this.startBoardPopup({
      kind: "survey",
      playerId: target.id,
      color: targetColor,
      square: null,
      title: "Customer Survey",
      status: "How would you rate your most recent board experience?",
      options: [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: `${n} star${n === 1 ? "" : "s"}`, detail: n === 5 ? "Excellent service." : n === 1 ? "Request a refund." : "Thank you." })),
    });
    return { ok: true };
  },

  startPrizeWheel(playerId, color) {
    this.startBoardPopup({
      kind: "prizeWheel",
      playerId,
      color,
      square: null,
      title: "Prize Wheel",
      status: "Spin once. The wheel does not accept responsibility.",
      options: [{ id: "spin", label: "Spin", detail: "Random board nonsense." }],
      data: { spun: false, result: null },
    });
    return { ok: true };
  },

  startAuctionHouse() {
    if (this.players.length !== 2) return { ok: false, error: "Need two players" };
    const lots = [
      { id: "shield", label: "King Shield", detail: "Winner gains one shield." },
      { id: "queen", label: "Suspicious Queen", detail: "A queen drops onto a random empty square." },
      { id: "clearHazard", label: "Cleanup Voucher", detail: "Remove one hazard." },
    ];
    const lot = lots[Math.floor(Math.random() * lots.length)];
    this.startBoardPopup({
      kind: "auction",
      playerId: this.players[0].id,
      color: this.players[0].color,
      square: null,
      title: "Auction House",
      status: `${lot.label}: ${lot.detail}`,
      options: [
        { id: "0", label: "Bid 0", detail: "Keep your pieces." },
        { id: "1", label: "Bid pawn", detail: "Sacrifice a pawn if you win." },
        { id: "3", label: "Bid minor", detail: "Sacrifice a knight or bishop if you win." },
      ],
      data: { lot, bids: {}, turnIndex: 0 },
    });
    return { ok: true };
  },

  resolveTerms(choiceId) {
    const { color } = this.boardPopup;
    if (choiceId === "decline") {
      const pawnSq = this.randomPieceSquare(color, (p) => p.type === "p");
      if (pawnSq != null) this.state.board[pawnSq] = null;
      this.shield[color] = (this.shield[color] || 0) + 1;
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Terms declined through a loophole. Shield granted, pawn invoiced." });
    }
    this.closeBoardPopup();
    return { ok: true };
  },

  resolveSurvey(choiceId) {
    const rating = Math.max(1, Math.min(5, Number(choiceId) || 3));
    const color = this.boardPopup.color;
    if (rating === 5) this.shield[color] = (this.shield[color] || 0) + 1;
    if (rating === 1 && this.lastMoveSquares?.length >= 2) {
      const [from, to] = this.lastMoveSquares;
      if (!this.state.board[from] && this.state.board[to]?.color === color) {
        this.state.board[from] = this.state.board[to];
        this.state.board[to] = null;
        this.effects.push({ type: "move", style: "teleport", id: this.nextEffectId(), from: to, to: from, piece: this.state.board[from] });
      }
    }
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Survey submitted: ${rating} star${rating === 1 ? "" : "s"}.` });
    this.closeBoardPopup();
    return { ok: true };
  },

  resolvePrizeWheel(choiceId) {
    const popup = this.boardPopup;
    const outcomes = ["pawn", "block", "hazard", "shield", "swap", "deletePawn"];
    if (choiceId === "spin") {
      if (popup.data?.spun) return { ok: false, error: "Wheel already spun" };
      const result = outcomes[Math.floor(Math.random() * outcomes.length)];
      popup.data = { ...(popup.data || {}), spun: true, result, outcomes };
      popup.status = "The wheel is slowing down...";
      popup.options = [{ id: "collect", label: "Collect prize", detail: "Apply the result after the wheel lands." }];
      return { ok: true };
    }
    if (choiceId !== "collect" || !popup.data?.spun || !outcomes.includes(popup.data.result)) return { ok: false, error: "Spin required" };
    const color = this.boardPopup.color;
    const result = popup.data.result;
    if (result === "pawn") {
      const sq = this.randomEmptyBoardSquare();
      if (sq != null) this.state.board[sq] = { type: "p", color, moved: true, tags: ["wheelPrize"] };
    } else if (result === "block") {
      const sq = this.randomEmptyBoardSquare();
      if (sq != null) this.state.board[sq] = { type: "x", color: "x", moved: true };
    } else if (result === "hazard") {
      const sq = this.randomEmptyBoardSquare();
      if (sq != null) this.hazards.lava.add(sq);
    } else if (result === "shield") {
      this.shield[color] = (this.shield[color] || 0) + 1;
    } else if (result === "swap") {
      const a = this.randomPieceSquare("w", (p) => p.type !== "k");
      const b = this.randomPieceSquare("b", (p) => p.type !== "k");
      if (a != null && b != null) {
        const t = this.state.board[a];
        this.state.board[a] = this.state.board[b];
        this.state.board[b] = t;
      }
    } else if (result === "deletePawn") {
      const sq = this.randomPieceSquare(color === "w" ? "b" : "w", (p) => p.type === "p");
      if (sq != null) this.state.board[sq] = null;
    }
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Prize Wheel landed on ${result}.` });
    this.closeBoardPopup();
    return { ok: true };
  },

  resolveAuction(choiceId) {
    const popup = this.boardPopup;
    const bidder = this.players[popup.data.turnIndex];
    const bid = Number(choiceId) || 0;
    popup.data.bids[bidder.color] = bid;
    if (popup.data.turnIndex === 0) {
      const next = this.players[1];
      popup.playerId = next.id;
      popup.color = next.color;
      popup.data.turnIndex = 1;
      popup.status = `${popup.data.lot.label}: ${popup.data.lot.detail}`;
      return { ok: true };
    }
    const bids = popup.data.bids;
    const winnerColor = (bids.w || 0) === (bids.b || 0) ? (Math.random() < 0.5 ? "w" : "b") : (bids.w || 0) > (bids.b || 0) ? "w" : "b";
    const bidCost = bids[winnerColor] || 0;
    const sacrificeType = bidCost >= 3 ? ["n", "b"] : bidCost >= 1 ? ["p"] : [];
    const sacSq = sacrificeType.length ? this.randomPieceSquare(winnerColor, (p) => sacrificeType.includes(p.type)) : null;
    if (sacSq != null) this.state.board[sacSq] = null;
    const lot = popup.data.lot.id;
    if (lot === "shield") this.shield[winnerColor] = (this.shield[winnerColor] || 0) + 1;
    if (lot === "queen") {
      const sq = this.randomEmptyBoardSquare();
      if (sq != null) this.state.board[sq] = { type: "q", color: winnerColor, moved: true, tags: ["auctionLot"] };
    }
    if (lot === "clearHazard") {
      for (const bucket of [this.hazards.lava, this.hazards.deadly, this.hazards.asteroid]) {
        const first = [...bucket][0];
        if (first != null) {
          bucket.delete(first);
          break;
        }
      }
    }
    this.effects.push({ type: "log", id: this.nextEffectId(), text: `Auction House sold ${popup.data.lot.label} to ${winnerColor === "w" ? "White" : "Black"}.` });
    this.closeBoardPopup();
    return { ok: true };
  },

  resolveParkingMeter(choiceId) {
    const { color, square } = this.boardPopup;
    if (choiceId === "pay") {
      const pawnSq = this.randomPieceSquare(color, (p) => p.type === "p");
      if (pawnSq != null && pawnSq !== square) {
        this.state.board[pawnSq] = null;
        this.extraMoves[color] = (this.extraMoves[color] || 0) + 1;
        this.effects.push({ type: "log", id: this.nextEffectId(), text: "Parking paid. One extra move added." });
      } else {
        const p = this.state.board[square];
        if (p) p._stickyLocked = true;
        this.effects.push({ type: "log", id: this.nextEffectId(), text: "No pawn coins available. The piece was clamped." });
      }
    } else if (choiceId === "kick") {
      if (Math.random() < 0.5) {
        const blast = [square, ...adjacentSquares(square)];
        for (const sq of blast) if (this.state.board[sq]?.type !== "k") this.state.board[sq] = null;
        this.effects.push({ type: "explosion", id: this.nextEffectId(), squares: blast, reason: "parkingMeter" });
      } else {
        this.effects.push({ type: "log", id: this.nextEffectId(), text: "The meter took the kick personally, but did nothing." });
      }
    } else {
      const p = this.state.board[square];
      if (p) {
        p._stickyLocked = true;
        p.tags = [...new Set([...(p.tags || []), "stickyStuck"])];
      }
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Parking ignored. The piece is clamped." });
    }
    this.closeBoardPopup();
    return { ok: true };
  },

  resolveVendingMachine(choiceId) {
    const { color, square } = this.boardPopup;
    this.boardObjects.vendingMachines = (this.boardObjects.vendingMachines || []).filter((item) => item.square !== square);
    const p = this.state.board[square];
    if (choiceId === "shield") {
      this.shield[color] = (this.shield[color] || 0) + 1;
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Blue Rookade dispensed: king shield added." });
    } else if (choiceId === "promote" && p && p.type !== "k") {
      p.type = pieceTier(p.type, 1);
      this.effects.push({ type: "log", id: this.nextEffectId(), text: "Promotion Crisps crunched. Piece promoted." });
    } else if (choiceId === "duplicate") {
      const sq = this.randomEmptyBoardSquare();
      if (sq != null) this.state.board[sq] = { type: "p", color, moved: true, tags: ["vendingCopy"] };
      this.effects.push({ type: "supplyDrop", id: this.nextEffectId(), drops: sq == null ? [] : [{ sq, type: "p", color }] });
    }
    this.closeBoardPopup();
    return { ok: true };
  },

  resolvePortaloo(choiceId) {
    const { square } = this.boardPopup;
    if (choiceId === "enter") {
      const p = this.state.board[square];
      const to = this.randomEmptyBoardSquare();
      if (p && to != null) {
        this.state.board[square] = null;
        this.state.board[to] = p;
        if (p.type !== "k") p.type = pieceTier(p.type, Math.random() < 0.55 ? 1 : -1);
        p.tags = [...new Set([...(p.tags || []), "flushed"])];
        this.effects.push({ type: "move", style: "teleport", id: this.nextEffectId(), from: square, to, piece: p });
      }
    }
    this.closeBoardPopup();
    return { ok: true };
  },

  resolveFountain(choiceId) {
    const { color, square } = this.boardPopup;
    const p = this.state.board[square];
    if (choiceId === "power" && p && p.type !== "k") p.type = pieceTier(p.type, 1);
    if (choiceId === "peace") this.shield[color] = (this.shield[color] || 0) + 1;
    for (const sq of adjacentSquares(square)) {
      const splash = this.state.board[sq];
      if (!splash) continue;
      const df = Math.sign(idxToFile(sq) - idxToFile(square));
      const dr = Math.sign(idxToRank(sq) - idxToRank(square));
      const nf = idxToFile(sq) + df;
      const nr = idxToRank(sq) + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      const to = toIdx(nf, nr);
      if (!this.state.board[to] && !this.missingSquares.has(to)) {
        this.state.board[to] = splash;
        this.state.board[sq] = null;
      }
    }
    this.effects.push({ type: "log", id: this.nextEffectId(), text: "The Fountain splashed nearby pieces." });
    this.closeBoardPopup();
    return { ok: true };
  },

  resolveComplaint(choiceId) {
    const { color } = this.boardPopup;
    if (choiceId === "hazard") {
      for (const bucket of [this.hazards.lava, this.hazards.deadly, this.hazards.asteroid]) {
        const first = [...bucket][0];
        if (first != null) {
          bucket.delete(first);
          break;
        }
      }
    } else if (choiceId === "ads") {
      this.ruleManager.active = this.ruleManager.active.filter((inst) => !(inst.ruleId === "dur_ads_7" && inst.data?.targetColor === color));
    } else if (choiceId === "unstick") {
      this.stickySquares.clear();
      for (const piece of this.state.board) {
        if (!piece) continue;
        delete piece._stickyLocked;
        piece.tags = (piece.tags || []).filter((tag) => tag !== "stickyStuck");
      }
    } else if (choiceId === "restore") {
      const idx = (this.capturedPieces || []).findLastIndex?.((p) => p.type === "p") ?? -1;
      if (idx >= 0) {
        const sq = this.randomEmptyBoardSquare();
        if (sq != null) {
          this.capturedPieces.splice(idx, 1);
          this.state.board[sq] = { type: "p", color, moved: true, tags: ["complainedBack"] };
        }
      }
    }
    this.effects.push({ type: "log", id: this.nextEffectId(), text: "Complaint filed. The department considers the matter closed." });
    this.closeBoardPopup();
    return { ok: true };
  },

  resolveLostProperty(choiceId) {
    if (choiceId === "close") {
      this.closeBoardPopup();
      return { ok: true };
    }
    const item = (this.boardPopup.pieces || []).find((p) => p.id === choiceId);
    const sq = this.randomEmptyBoardSquare();
    if (item && sq != null) {
      this.state.board[sq] = { type: item.type, color: this.boardPopup.color, moved: true, tags: ["lostProperty"] };
      this.effects.push({ type: "supplyDrop", id: this.nextEffectId(), drops: [{ sq, type: item.type, color: this.boardPopup.color }] });
    }
    this.closeBoardPopup();
    return { ok: true };
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
