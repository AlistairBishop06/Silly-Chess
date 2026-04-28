// Full ruleset list. Each rule defines:
// - kind: "instant" | "delayed" | "duration"
// - delayTurns (for delayed, in ply turns)
// - durationTurns (for duration, in ply turns)
// - apply(game, ctx): performs immediate board/state changes
// - modifiers(game): returns modifiers applied while active (duration or permanent flags)

const { pieceValue, idxToFile, idxToRank, toIdx } = require("../ChessEngine");

function randInt(n) {
  return Math.floor(Math.random() * n);
}

function pickN(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(randInt(copy.length), 1)[0]);
  }
  return out;
}

function squaresAdjacent(sq) {
  const f = idxToFile(sq);
  const r = idxToRank(sq);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let df = -1; df <= 1; df++) {
      if (!df && !dr) continue;
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      out.push(toIdx(nf, nr));
    }
  }
  return out;
}

function squaresWithinRadius(sq, radius) {
  const f = idxToFile(sq);
  const r = idxToRank(sq);
  const out = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let df = -radius; df <= radius; df++) {
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      out.push(toIdx(nf, nr));
    }
  }
  return out;
}

function perimeterSquares() {
  const out = [];
  for (let f = 0; f < 8; f++) out.push(toIdx(f, 0));
  for (let r = 1; r < 8; r++) out.push(toIdx(7, r));
  for (let f = 6; f >= 0; f--) out.push(toIdx(f, 7));
  for (let r = 6; r >= 1; r--) out.push(toIdx(0, r));
  return out;
}

function randomEmptySquare(game) {
  const empties = [];
  for (let i = 0; i < 64; i++) if (!game.state.board[i] && !game.missingSquares.has(i)) empties.push(i);
  if (!empties.length) return null;
  return empties[randInt(empties.length)];
}

function randomPieceSquare(game, color, filterFn) {
  const squares = [];
  for (let i = 0; i < 64; i++) {
    const p = game.state.board[i];
    if (!p || p.color !== color) continue;
    if (filterFn && !filterFn(p)) continue;
    squares.push(i);
  }
  if (!squares.length) return null;
  return squares[randInt(squares.length)];
}

function destroySquares(game, squares, reason) {
  const destroyed = [];
  for (const sq of squares) {
    const p = game.state.board[sq];
    if (!p) continue;
    game.state.board[sq] = null;
    destroyed.push(sq);
  }
  if (destroyed.length) game.effects.push({ type: "explosion", squares: destroyed, id: game.nextEffectId(), reason: reason || "destroy" });
}

function swapPieces(game, a, b) {
  const t = game.state.board[a];
  game.state.board[a] = game.state.board[b];
  game.state.board[b] = t;
}

function idxToAlg(idx) {
  return String.fromCharCode(97 + idxToFile(idx)) + String(idxToRank(idx) + 1);
}

const RULES = [
  // 🔴 Instant (original 17 + 5 new)
  {
    id: "inst_pot_of_greed",
    kind: "instant",
    name: "Pot of Greed",
    description: "Pick 2 extra rules immediately.",
    apply(game, ctx) {
      game.startBonusRuleChoice?.(ctx?.playerId, 2);
    },
  },
  {
    id: "inst_coinflip_wager",
    kind: "instant",
    name: "Coinflip Wager",
    description: "Both players wager pieces on a coin flip. Loser's wagered pieces switch sides.",
    apply(game) {
      game.startCoinflipWager?.();
    },
  },
  {
    id: "inst_oops_explosion",
    kind: "instant",
    name: "Oops Explosion",
    description: "Random non-king piece detonates, removing itself and all adjacent pieces.",
    apply(game) {
      const nonKing = (p) => p.type !== "k" && p.color !== "x";
      const target =
        randomPieceSquare(game, randInt(2) === 0 ? "w" : "b", nonKing) ??
        randomPieceSquare(game, "w", nonKing) ??
        randomPieceSquare(game, "b", nonKing);
      if (target == null) return;
      destroySquares(game, [target, ...squaresAdjacent(target)], "oops");
    },
  },
  {
    id: "inst_pawn_herding",
    kind: "instant",
    name: "Pawn Herding",
    description: "All pawns move toward the centre regardless of legality (server corrects illegal ones).",
    apply(game) {
      const pawns = [];
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (p && p.type === "p" && p.color !== "x") pawns.push(i);
      }

      for (let i = pawns.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        const t = pawns[i];
        pawns[i] = pawns[j];
        pawns[j] = t;
      }

      const centerF = 3.5;
      const centerR = 3.5;

      for (const from of pawns) {
        const p = game.state.board[from];
        if (!p || p.type !== "p") continue;
        const f = idxToFile(from);
        const r = idxToRank(from);
        const df = f < centerF ? 1 : f > centerF ? -1 : 0;
        const dr = r < centerR ? 1 : r > centerR ? -1 : 0;

        const candidates = [
          { nf: f + df, nr: r + dr },
          { nf: f + df, nr: r },
          { nf: f, nr: r + dr },
        ];

        for (const c of candidates) {
          if (c.nf < 0 || c.nf > 7 || c.nr < 0 || c.nr > 7) continue;
          const to = toIdx(c.nf, c.nr);
          if (game.missingSquares.has(to)) continue;
          if (game.state.board[to]) continue;
          game.state.board[to] = game.state.board[from];
          game.state.board[from] = null;
          game.state.board[to].moved = true;
          break;
        }
      }
    },
  },
  {
    id: "inst_rps_duel",
    kind: "instant",
    name: "RPS Duel",
    description: "Rock-paper-scissors duel. Loser loses a random non-king piece.",
    apply(game) {
      // Starts an interactive mini-game (server blocks play until both players pick).
      game.startRpsDuel?.();
    },
  },
  {
    id: "inst_swap_queens",
    kind: "instant",
    name: "Queen Swap",
    description: "Swap positions of both queens.",
    apply(game) {
      const wq = randomPieceSquare(game, "w", (p) => p.type === "q");
      const bq = randomPieceSquare(game, "b", (p) => p.type === "q");
      if (wq != null && bq != null) swapPieces(game, wq, bq);
    },
  },
  {
    id: "inst_knight_teleport",
    kind: "instant",
    name: "Knight Teleport",
    description: "All knights teleport to random empty squares.",
    apply(game) {
      const knights = [];
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (p && p.type === "n") knights.push({ sq: i, p });
      }
      for (const k of knights) game.state.board[k.sq] = null;
      for (const k of knights) {
        const to = randomEmptySquare(game);
        if (to == null) continue;
        game.state.board[to] = k.p;
      }
    },
  },
  {
    id: "inst_flip_visual_1",
    kind: "instant",
    name: "Visual Flip",
    description: "Flip the board orientation for both players for 1 turn.",
    apply(game) {
      game.visualFlipPlies = Math.max(game.visualFlipPlies, 1);
    },
  },
  {
    id: "inst_temp_queen",
    kind: "instant",
    name: "One-Move Queen",
    description: "Random piece on each side becomes a queen for 1 move only.",
    apply(game) {
      for (const c of ["w", "b"]) {
        const sq = randomPieceSquare(game, c, (p) => p.type !== "k");
        if (sq == null) continue;
        const p = game.state.board[sq];
        p.tags = p.tags || [];
        if (!p.tags.includes("tempQueen")) p.tags.push("tempQueen");
        p._tempOriginalType = p.type;
        p.type = "q";
      }
    },
  },
  {
    id: "inst_pawns_advance",
    kind: "instant",
    name: "Pawn Surge",
    description: "All pawns advance forward 1 square if possible.",
    apply(game) {
      const moves = [];
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (!p || p.type !== "p") continue;
        const dir = p.color === "w" ? 1 : -1;
        const f = idxToFile(i);
        const r = idxToRank(i);
        const nr = r + dir;
        if (nr < 0 || nr > 7) continue;
        const to = toIdx(f, nr);
        if (!game.state.board[to] && !game.missingSquares.has(to) && !game.hazards.deadly.has(to)) moves.push({ from: i, to });
      }
      moves.sort((a, b) => (idxToRank(a.from) - idxToRank(b.from)) * -1);
      for (const m of moves) {
        if (!game.state.board[m.from] || game.state.board[m.to]) continue;
        game.state.board[m.to] = game.state.board[m.from];
        game.state.board[m.from] = null;
        game.state.board[m.to].moved = true;
      }
    },
  },
  {
    id: "inst_remove_center",
    kind: "instant",
    name: "Center Purge",
    description: "Remove all pieces on the central 4 squares.",
    apply(game) {
      destroySquares(game, [toIdx(3, 3), toIdx(4, 3), toIdx(3, 4), toIdx(4, 4)], "center");
    },
  },
  {
    id: "inst_sacrifice_highest",
    kind: "instant",
    name: "Highest Sacrifice",
    description: "Each player sacrifices their highest-value piece (excluding king).",
    apply(game) {
      for (const c of ["w", "b"]) {
        let best = null;
        let bestV = -1;
        for (let i = 0; i < 64; i++) {
          const p = game.state.board[i];
          if (!p || p.color !== c || p.type === "k") continue;
          const v = pieceValue(p.type);
          if (v > bestV) {
            bestV = v;
            best = i;
          }
        }
        if (best != null) destroySquares(game, [best], "sacrifice");
      }
    },
  },
  {
    id: "inst_spawn_block",
    kind: "instant",
    name: "Neutral Block",
    description: "Spawn a neutral block piece in a random square (impassable).",
    apply(game) {
      const sq = randomEmptySquare(game);
      if (sq == null) return;
      game.state.board[sq] = { type: "x", color: "x", moved: true };
    },
  },
  {
    id: "inst_shuffle_bishops",
    kind: "instant",
    name: "Bishop Shuffle",
    description: "Shuffle all bishops randomly across valid squares (same-color squares).",
    apply(game) {
      const bishops = [];
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (p && p.type === "b") bishops.push({ sq: i, p });
      }
      const targets = bishops.map((b) => b.sq);
      const shuffled = pickN(targets, targets.length);
      for (const b of bishops) game.state.board[b.sq] = null;
      bishops.forEach((b, i) => {
        const to = shuffled[i];
        if (to == null) return;
        game.state.board[to] = b.p;
      });
    },
  },
  {
    id: "inst_rooks_mirror",
    kind: "instant",
    name: "Rook Mirror",
    description: "All rooks switch sides (mirror horizontally).",
    apply(game) {
      const rooks = [];
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (p && p.type === "r") rooks.push(i);
      }
      for (const sq of rooks) {
        const f = idxToFile(sq);
        const r = idxToRank(sq);
        const to = toIdx(7 - f, r);
        if (to === sq) continue;
        if (game.missingSquares.has(to)) continue;
        swapPieces(game, sq, to);
      }
    },
  },
  {
    id: "inst_kings_shield",
    kind: "instant",
    name: "King Shield",
    description: "Both kings gain a temporary shield (ignore the next check).",
    apply(game) {
      game.shield.w += 1;
      game.shield.b += 1;
    },
  },
  {
    id: "inst_delete_column",
    kind: "instant",
    name: "Deleted Column",
    description: "Random column is deleted (pieces removed).",
    apply(game) {
      const file = randInt(8);
      const squares = [];
      for (let r = 0; r < 8; r++) squares.push(toIdx(file, r));
      destroySquares(game, squares, "column");
    },
  },
  {
    id: "inst_rotate_edges",
    kind: "instant",
    name: "Edge Rotation",
    description: "All pieces rotate positions clockwise around board edges.",
    apply(game) {
      const per = perimeterSquares();
      const last = game.state.board[per[per.length - 1]];
      for (let i = per.length - 1; i > 0; i--) game.state.board[per[i]] = game.state.board[per[i - 1]];
      game.state.board[per[0]] = last;
    },
  },
  {
    id: "inst_extra_move",
    kind: "instant",
    name: "Extra Move",
    description: "Each player gains an extra move immediately (one-time).",
    apply(game) {
      game.extraMoves.w += 1;
      game.extraMoves.b += 1;
    },
  },

  // ── NEW INSTANT RULES ──────────────────────────────────────────────────────

  {
    id: "inst_titan",
    kind: "instant",
    name: "Titan",
    description: "Choose one of your pieces. It becomes a 2x2 titan, deleting anything in its way and gaining extended movement.",
    apply(game, ctx) {
      game.enqueueTargetRule?.({
        ruleId: "inst_titan",
        playerId: ctx?.playerId,
        color: ctx?.color,
        prompt: "Choose one of your pieces to become a titan.",
      });
    },
  },
  {
    id: "inst_hard_reset",
    kind: "instant",
    name: "Hard Reset",
    description: "Reset the game to the starting position and remove every active, delayed, duration, and permanent rule.",
    apply(game) {
      game.resetBoardState?.({ keepRules: false });
      game.effects.push({ type: "rule", id: game.nextEffectId(), text: "Hard Reset! The match returned to the start and every rule was cleared." });
    },
  },
  {
    id: "inst_soft_reset",
    kind: "instant",
    name: "Soft Reset",
    description: "Reset all pieces to the starting position, but keep current and permanent rules in play.",
    apply(game) {
      game.resetBoardState?.({ keepRules: true });
      game.effects.push({ type: "rule", id: game.nextEffectId(), text: "Soft Reset! Pieces returned to start while active rules stayed in play." });
    },
  },
  {
    id: "inst_suicide_bomber",
    kind: "instant",
    name: "Suicide Bomber",
    description: "Choose one of your pieces. The next time it moves, it destroys itself and every adjacent piece where it lands.",
    apply(game, ctx) {
      game.enqueueTargetRule?.({
        ruleId: "inst_suicide_bomber",
        playerId: ctx?.playerId,
        color: ctx?.color,
        prompt: "Choose one of your pieces to arm as a suicide bomber.",
      });
    },
  },
  {
    id: "inst_peasant_revolt",
    kind: "instant",
    name: "Peasant Revolt",
    description: "Every pawn captures the nearest enemy non-king piece within 2 squares, destroying both. Pawns with no target survive.",
    apply(game) {
      const toDestroy = new Set();
      for (let sq = 0; sq < 64; sq++) {
        const p = game.state.board[sq];
        if (!p || p.type !== "p" || p.color === "x") continue;
        const enemy = p.color === "w" ? "b" : "w";
        // Find nearest enemy non-king within radius 2.
        let bestSq = null;
        let bestDist = Infinity;
        for (let target = 0; target < 64; target++) {
          const t = game.state.board[target];
          if (!t || t.color !== enemy || t.type === "k") continue;
          const df = Math.abs(idxToFile(sq) - idxToFile(target));
          const dr = Math.abs(idxToRank(sq) - idxToRank(target));
          const dist = df + dr;
          if (dist <= 2 && dist < bestDist) {
            bestDist = dist;
            bestSq = target;
          }
        }
        if (bestSq != null) {
          toDestroy.add(sq);
          toDestroy.add(bestSq);
        }
      }
      destroySquares(game, [...toDestroy], "revolt");
    },
  },
  {
    id: "inst_identity_crisis",
    kind: "instant",
    name: "Identity Crisis",
    description: "Each king's movement is swapped with a random friendly non-pawn piece for 3 turns. The pieces swap types; kings remain kings for check purposes.",
    apply(game) {
      for (const c of ["w", "b"]) {
        const kSq = randomPieceSquare(game, c, (p) => p.type === "k");
        const otherSq = randomPieceSquare(game, c, (p) => p.type !== "k" && p.type !== "p");
        if (kSq == null || otherSq == null) continue;
        const other = game.state.board[otherSq];
        // Tag the king to move like the swapped piece type.
        const king = game.state.board[kSq];
        king.tags = king.tags || [];
        king._identityType = other.type;
        king._identityPliesLeft = 6; // 6 plies ≈ 3 full turns
        king.tags.push("identityCrisis");
        // The other piece takes on "k" movement style visually (cosmetic tag only).
        other.tags = other.tags || [];
        other.tags.push("identityCrisis");
        other._identityPliesLeft = 6;
      }
      game.effects.push({ type: "rule", id: game.nextEffectId(), text: "Identity Crisis! Kings and pieces have swapped movement styles." });
    },
  },
  {
    id: "inst_sniper",
    kind: "instant",
    name: "Sniper",
    description: "A random non-king piece on each side is silently eliminated. No explosion — it just vanishes.",
    apply(game) {
      for (const c of ["w", "b"]) {
        const sq = randomPieceSquare(game, c, (p) => p.type !== "k");
        if (sq == null) continue;
        game.state.board[sq] = null;
        // No explosion effect — silent removal is the flavour.
        game.effects.push({ type: "log", id: game.nextEffectId(), text: `Sniper eliminated a ${c === "w" ? "White" : "Black"} piece at ${idxToAlg(sq)}.` });
      }
    },
  },
  {
    id: "inst_asteroid_belt",
    kind: "instant",
    name: "Asteroid Belt",
    description: "Three random squares gain asteroid debris. Any piece landing on one in the next 5 turns is destroyed on impact.",
    apply(game) {
      const candidates = [...Array(64).keys()].filter((i) => !game.missingSquares.has(i) && !game.state.board[i]);
      const chosen = pickN(candidates.length ? candidates : [...Array(64).keys()].filter((i) => !game.missingSquares.has(i)), 3);
      for (const sq of chosen) game.hazards.asteroid.add(sq);
      game.asteroidPlies = 5;
      game.effects.push({ type: "log", id: game.nextEffectId(), text: `Asteroid debris landed on: ${chosen.map(idxToAlg).join(", ")}.` });
    },
  },
  {
    id: "inst_colour_blind",
    kind: "instant",
    name: "Colour Blind",
    description: "For 4 turns, pieces lose their colour markings — neither player can tell friend from foe visually. Captures still work normally.",
    apply(game) {
      game.colourBlindPlies = Math.max(game.colourBlindPlies || 0, 4);
      game.effects.push({ type: "rule", id: game.nextEffectId(), text: "Colour Blind! You can't tell friend from foe for 4 turns." });
    },
  },

  // 🟡 In X Turns (original 16 + 5 new)
  {
    id: "del_mutation_event_5",
    kind: "delayed",
    delayTurns: 5,
    name: "Mutation Event",
    description: "In 5 turns, every piece randomly changes type once (except kings).",
    apply(game) {
      const types = ["p", "n", "b", "r", "q"];
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (!p || p.color === "x") continue;
        if (p.type === "k") continue;
        p.type = types[randInt(types.length)];
      }
      game.effects.push({ type: "rule", id: game.nextEffectId(), text: "Mutation complete." });
    },
  },
  {
    id: "del_black_hole_6",
    kind: "delayed",
    delayTurns: 6,
    name: "Black Hole",
    description: "In 6 turns, a random square becomes deadly (deletes anything that enters it).",
    becomesPermanent: true,
    onSchedule(game, inst) {
      const candidates = [...Array(64).keys()].filter((i) => !game.missingSquares.has(i));
      inst.data.targetSq = candidates[randInt(candidates.length)];
      if (game.marks?.blackHole) game.marks.blackHole.add(inst.data.targetSq);
      game.effects.push({ type: "log", id: game.nextEffectId(), text: `Black hole forming at ${idxToAlg(inst.data.targetSq)}.` });
    },
    apply(game, ctx) {
      const sq = ctx?.inst?.data?.targetSq;
      if (typeof sq !== "number") return;
      game.hazards.deadly.add(sq);
      destroySquares(game, [sq], "blackHole");
    },
  },
  {
    id: "del_lightning_strike_10",
    kind: "delayed",
    delayTurns: 10,
    name: "Lightning Strike",
    description: "In 10 turns, the marked square is struck with lightning and kills whatever piece is on it.",
    onSchedule(game, inst) {
      const candidates = [...Array(64).keys()].filter((i) => !game.missingSquares.has(i));
      inst.data.targetSq = candidates[randInt(candidates.length)];
      if (game.marks?.lightning) game.marks.lightning.add(inst.data.targetSq);
      game.effects.push({ type: "log", id: game.nextEffectId(), text: `Lightning marked ${idxToAlg(inst.data.targetSq)}.` });
    },
    apply(game, ctx) {
      const sq = ctx?.inst?.data?.targetSq;
      if (typeof sq !== "number") return;
      if (game.marks?.lightning) game.marks.lightning.delete(sq);
      const p = game.state.board[sq];
      if (p && p.type !== "k" && p.color !== "x") {
        game.state.board[sq] = null;
        game.effects.push({ type: "explosion", squares: [sq], id: game.nextEffectId(), reason: "lightning" });
      } else {
        game.effects.push({ type: "log", id: game.nextEffectId(), text: `Lightning struck ${idxToAlg(sq)}.` });
      }
    },
  },
  {
    id: "del_adjacent_king_destroy_3",
    kind: "delayed",
    delayTurns: 3,
    name: "Royal Shrapnel",
    description: "In 3 turns, all pieces adjacent to a king are destroyed.",
    apply(game) {
      for (const c of ["w", "b"]) {
        const kSq = randomPieceSquare(game, c, (p) => p.type === "k");
        if (kSq == null) continue;
        const adj = squaresAdjacent(kSq);
        destroySquares(game, adj, "adjKing");
      }
    },
  },
  {
    id: "del_shrink_deadly_5",
    kind: "delayed",
    delayTurns: 5,
    name: "Board Shrink",
    description: "In 5 turns, the outer ring becomes deadly.",
    becomesPermanent: true,
    apply(game) {
      for (let f = 0; f < 8; f++) {
        game.hazards.deadly.add(toIdx(f, 0));
        game.hazards.deadly.add(toIdx(f, 7));
      }
      for (let r = 1; r < 7; r++) {
        game.hazards.deadly.add(toIdx(0, r));
        game.hazards.deadly.add(toIdx(7, r));
      }
      destroySquares(game, [...game.hazards.deadly], "shrink");
    },
  },
  {
    id: "wall_5",
    kind: "delayed",
    delayTurns: 5,
    name: "Build a Wall",
    description: "In 5 turns, a diagonal death wall will be built in either direction.",
    becomesPermanent: true,
    apply(game) {
      if (Math.random() < 0.5) {
        for (let i = 0; i < 8; i++) {
          game.hazards.deadly.add(toIdx(i, i));
        }
        game.effects.push({ type: "log", id: game.nextEffectId(), text: "Build a Wall: death wall formed from a1 to h8." });
      } else {
        for (let i = 0; i < 8; i++) {
          game.hazards.deadly.add(toIdx(i, 7-i));
        }
        game.effects.push({ type: "log", id: game.nextEffectId(), text: "Build a Wall: death wall formed from a8 to h1." });
      }
      destroySquares(game, [...game.hazards.deadly], "shrink");
    },
  },
  {
    id: "del_fan_5",
    kind: "delayed",
    delayTurns: 5,
    name: "Fan",
    description: "In 5 turns, a fan appears on a random row from the left or right. Pieces entering that row are blown until blocked.",
    becomesPermanent: true,
    onSchedule(game, inst) {
      inst.data.rank = randInt(8);
      inst.data.side = Math.random() < 0.5 ? "left" : "right";
      game.effects.push({
        type: "log",
        id: game.nextEffectId(),
        text: `Fan incoming on row ${inst.data.rank + 1} from the ${inst.data.side}.`,
      });
    },
    apply(game, ctx) {
      const rank = ctx?.inst?.data?.rank;
      const side = ctx?.inst?.data?.side;
      if (typeof rank !== "number" || (side !== "left" && side !== "right")) return;
      const fan = { rank, side, dir: side === "left" ? 1 : -1 };
      game.fans.push(fan);
      game.applyFanRow?.(fan);
      game.effects.push({ type: "rule", id: game.nextEffectId(), text: `Fan active on row ${rank + 1}, blowing ${side === "left" ? "right" : "left"}.` });
    },
  },
  {
    id: "del_auto_promote_pawns_4",
    kind: "delayed",
    delayTurns: 4,
    name: "Auto Promotion",
    description: "In 4 turns, all pawns promote automatically.",
    apply(game) {
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (!p || p.type !== "p") continue;
        p.type = "q";
        p.tags = p.tags || [];
        p.tags.push("promoted");
      }
    },
  },
  {
    id: "del_swap_sides_6",
    kind: "delayed",
    delayTurns: 6,
    name: "Side Swap",
    description: "In 6 turns, all pieces swap sides (ownership flips except kings).",
    apply(game) {
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (!p || p.color === "x" || p.type === "k") continue;
        p.color = p.color === "w" ? "b" : "w";
      }
    },
  },
  {
    id: "del_queens_explode_5",
    kind: "delayed",
    delayTurns: 5,
    name: "Queen Explosion",
    description: "In 5 turns, queens explode (remove adjacent pieces).",
    apply(game) {
      const explode = [];
      for (let i = 0; i < 64; i++) if (game.state.board[i]?.type === "q") explode.push(i);
      for (const sq of explode) destroySquares(game, [sq, ...squaresAdjacent(sq)], "queenExplode");
    },
  },
  {
    id: "del_gravity_on_4",
    kind: "delayed",
    delayTurns: 4,
    name: "Gravity On",
    description: "In 4 turns, gravity activates (pieces fall downward each turn).",
    becomesPermanent: true,
    apply(game) {
      game.permanent.gravity = true;
    },
  },
  {
    id: "del_wrap_edges_6",
    kind: "delayed",
    delayTurns: 6,
    name: "Wrap Edges",
    description: "In 6 turns, edges wrap permanently.",
    becomesPermanent: true,
    apply(game) {
      game.permanent.wrapEdges = true;
    },
  },
  {
    id: "del_knight_duplicate_3",
    kind: "delayed",
    delayTurns: 3,
    name: "Knight Duplication",
    description: "In 3 turns, knights duplicate themselves once.",
    apply(game) {
      const knights = [];
      for (let i = 0; i < 64; i++) if (game.state.board[i]?.type === "n") knights.push(i);
      for (const sq of knights) {
        const empty = randomEmptySquare(game);
        if (empty != null) game.state.board[empty] = { ...game.state.board[sq], moved: true };
      }
    },
  },
  {
    id: "del_bishops_rook_perm_5",
    kind: "delayed",
    delayTurns: 5,
    name: "Bishop Upgrade",
    description: "In 5 turns, bishops gain rook movement permanently.",
    becomesPermanent: true,
    apply(game) {
      game.permanent.bishopsRookLike = true;
    },
  },
  {
    id: "del_kings_forced_4",
    kind: "delayed",
    delayTurns: 4,
    name: "March of Kings",
    description: "In 4 turns, kings are forced to move every turn.",
    becomesPermanent: true,
    apply(game) {
      game.permanent.forcedKingMove = true;
    },
  },
  {
    id: "del_lava_random_6",
    kind: "delayed",
    delayTurns: 6,
    name: "Lava Fields",
    description: "In 6 turns, random squares become lava.",
    becomesPermanent: true,
    apply(game) {
      const empty = [...Array(64).keys()].filter((i) => !game.missingSquares.has(i) && !game.state.board[i]);
      const squares = pickN(empty, Math.min(10, empty.length));
      for (const sq of squares) game.hazards.lava.add(sq);
    },
  },
  {
    id: "del_chain_explosions_3",
    kind: "delayed",
    delayTurns: 3,
    name: "Chain Explosions",
    description: "In 3 turns, all captures trigger chain explosions.",
    becomesPermanent: true,
    apply(game) {
      game.permanent.chainExplosions = true;
    },
  },
  {
    id: "del_time_reverse_5",
    kind: "delayed",
    delayTurns: 5,
    name: "Time Reversal",
    description: "In 5 turns, time reverses 2 turns.",
    apply(game) {
      game.timeReverseNow(2);
    },
  },
  {
    id: "del_all_king_move_4",
    kind: "delayed",
    delayTurns: 4,
    name: "Tiny Steps",
    description: "In 4 turns, all pieces move like kings (permanent).",
    becomesPermanent: true,
    apply(game) {
      game.permanent.allPiecesKingLike = true;
    },
  },

  // ── NEW DELAYED RULES ──────────────────────────────────────────────────────

  {
    id: "del_orbital_strike_10",
    kind: "delayed",
    delayTurns: 10,
    name: "Orbital Strike",
    description: "In 10 turns, a marked square is obliterated — the piece on it and all adjacent pieces are destroyed.",
    onSchedule(game, inst) {
      const candidates = [...Array(64).keys()].filter((i) => !game.missingSquares.has(i));
      inst.data.targetSq = candidates[randInt(candidates.length)];
      // Reuse the lightning mark set for the visual indicator.
      if (game.marks?.lightning) game.marks.lightning.add(inst.data.targetSq);
      game.effects.push({ type: "log", id: game.nextEffectId(), text: `Orbital strike locked onto ${idxToAlg(inst.data.targetSq)}. Brace for impact.` });
    },
    apply(game, ctx) {
      const sq = ctx?.inst?.data?.targetSq;
      if (typeof sq !== "number") return;
      if (game.marks?.lightning) game.marks.lightning.delete(sq);
      const blast = [sq, ...squaresAdjacent(sq)];
      destroySquares(game, blast, "orbital");
      game.effects.push({ type: "log", id: game.nextEffectId(), text: `Orbital strike hit ${idxToAlg(sq)}!` });
    },
  },
  {
    id: "del_tax_collection_6",
    kind: "delayed",
    delayTurns: 6,
    name: "Tax Collection",
    description: "In 6 turns, the player with more material loses their second-most-valuable piece to taxation.",
    apply(game) {
      // Score each side.
      const score = { w: 0, b: 0 };
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (!p || p.color === "x" || p.type === "k") continue;
        score[p.color] += pieceValue(p.type);
      }
      const richer = score.w > score.b ? "w" : score.b > score.w ? "b" : null;
      if (richer == null) {
        game.effects.push({ type: "log", id: game.nextEffectId(), text: "Tax Collection: material equal, nobody taxed." });
        return;
      }
      // Find second-most-valuable piece.
      const pieces = [];
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (!p || p.color !== richer || p.type === "k") continue;
        pieces.push({ sq: i, v: pieceValue(p.type) });
      }
      pieces.sort((a, b) => b.v - a.v);
      const target = pieces[1] ?? pieces[0];
      if (!target) return;
      destroySquares(game, [target.sq], "tax");
      game.effects.push({ type: "log", id: game.nextEffectId(), text: `Tax Collection: ${richer === "w" ? "White" : "Black"} paid the taxman.` });
    },
  },
  {
    id: "del_pawn_conscription_4",
    kind: "delayed",
    delayTurns: 4,
    name: "Pawn Conscription",
    description: "In 4 turns, one random non-pawn piece on each side is demoted to a pawn.",
    apply(game) {
      for (const c of ["w", "b"]) {
        const sq = randomPieceSquare(game, c, (p) => p.type !== "k" && p.type !== "p");
        if (sq == null) continue;
        game.state.board[sq].type = "p";
        game.state.board[sq].tags = game.state.board[sq].tags || [];
        game.state.board[sq].tags.push("conscripted");
        game.effects.push({ type: "log", id: game.nextEffectId(), text: `Conscription: ${c === "w" ? "White" : "Black"} piece at ${idxToAlg(sq)} demoted to pawn.` });
      }
    },
  },
  {
    id: "del_betrayal_3",
    kind: "delayed",
    delayTurns: 3,
    name: "Betrayal",
    description: "In 3 turns, a random non-king piece on each side defects to the opponent.",
    apply(game) {
      for (const c of ["w", "b"]) {
        const sq = randomPieceSquare(game, c, (p) => p.type !== "k");
        if (sq == null) continue;
        game.state.board[sq].color = c === "w" ? "b" : "w";
        game.effects.push({ type: "log", id: game.nextEffectId(), text: `Betrayal! A ${c === "w" ? "White" : "Black"} piece at ${idxToAlg(sq)} switched sides.` });
      }
    },
  },
  {
    id: "del_copycat_positions_6",
    kind: "delayed",
    delayTurns: 6,
    name: "Copycat Delayed",
    description: "In 6 turns, piece positions revert to how they were right now — but captured pieces stay captured.",
    onSchedule(game, inst) {
      // Snapshot current piece positions only (not counts — pieces that die stay dead).
      inst.data.snapshot = game.state.board.map((p) =>
        p ? { type: p.type, color: p.color, moved: p.moved, tags: p.tags ? [...p.tags] : undefined } : null
      );
      game.effects.push({ type: "log", id: game.nextEffectId(), text: "Copycat Delayed: position snapshot taken." });
    },
    apply(game, ctx) {
      const snap = ctx?.inst?.data?.snapshot;
      if (!snap) return;
      // Build a set of piece identities still alive on the board now (by color+type count).
      const liveCounts = { wp: 0, wn: 0, wb: 0, wr: 0, wq: 0, wk: 0, bp: 0, bn: 0, bb: 0, br: 0, bq: 0, bk: 0 };
      for (let i = 0; i < 64; i++) {
        const p = game.state.board[i];
        if (p && p.color !== "x") liveCounts[`${p.color}${p.type}`] = (liveCounts[`${p.color}${p.type}`] || 0) + 1;
      }
      // Restore snapshot positions, but only place a piece if we still have live budget for it.
      const placedCounts = { ...liveCounts };
      Object.keys(placedCounts).forEach((k) => (placedCounts[k] = 0));
      const next = Array(64).fill(null);
      for (let i = 0; i < 64; i++) {
        const p = snap[i];
        if (!p || p.color === "x") continue;
        const key = `${p.color}${p.type}`;
        if ((placedCounts[key] || 0) < (liveCounts[key] || 0)) {
          next[i] = { ...p, tags: p.tags ? [...p.tags] : undefined };
          placedCounts[key] = (placedCounts[key] || 0) + 1;
        }
      }
      game.state.board = next;
      game.effects.push({ type: "rule", id: game.nextEffectId(), text: "Copycat Delayed: positions rewound!" });
    },
  },

  // 🟢 For X Turns (original 18 + 4 new)
  {
    id: "dur_ice_board_5",
    kind: "duration",
    durationTurns: 5,
    name: "Ice Board",
    description: "For 5 turns, pieces slide until they hit another piece or edge.",
    modifiers() {
      return { iceBoard: true };
    },
  },
  {
    id: "dur_overcharge_2",
    kind: "duration",
    durationTurns: 2,
    name: "Overcharge",
    description: "For 2 turns, every piece can move twice but must end on a legal square.",
    modifiers() {
      return { moveTwice: true };
    },
  },
  {
    id: "dur_echo_trail_1",
    kind: "duration",
    durationTurns: 1,
    name: "Echo Trail",
    description: "For 1 turn, whenever a piece moves, every square it passes through becomes filled with copies of that piece.",
    modifiers() {
      return { echoTrail: true };
    },
  },
  {
    id: "dur_only_pawns_5",
    kind: "duration",
    durationTurns: 5,
    name: "Pawn Monopoly",
    description: "For 5 turns, only pawns can move.",
    modifiers() {
      return { onlyPawnsMove: true };
    },
  },
  {
    id: "dur_wrap_8",
    kind: "duration",
    durationTurns: 8,
    name: "Pac-Man Board",
    description: "For 8 turns, board wraps around edges.",
    modifiers() {
      return { wrapEdges: true };
    },
  },
  {
    id: "dur_move_twice_4",
    kind: "duration",
    durationTurns: 4,
    name: "Double Tempo",
    description: "For 4 turns, all pieces move twice per turn.",
    modifiers() {
      return { moveTwice: true };
    },
  },
  {
    id: "dur_knights_queen_6",
    kind: "duration",
    durationTurns: 6,
    name: "Knight Ascension",
    description: "For 6 turns, knights can move like queens.",
    modifiers() {
      return { knightsQueenLike: true };
    },
  },
  {
    id: "dur_no_capture_5",
    kind: "duration",
    durationTurns: 5,
    name: "No Captures",
    description: "For 5 turns, pieces cannot capture.",
    modifiers() {
      return { noCapture: true };
    },
  },
  {
    id: "dur_random_shift_7",
    kind: "duration",
    durationTurns: 7,
    name: "Shifting Ranks",
    description: "For 7 turns, each rank shifts randomly each turn.",
    apply(game, ctx) {
      ctx.flags.randomShift = true;
    },
    modifiers() {
      return { randomShift: true };
    },
  },
  {
    id: "dur_invisible_3",
    kind: "duration",
    durationTurns: 3,
    name: "Invisibility",
    description: "For 3 turns, pieces are invisible (only last move shown).",
    modifiers() {
      return { invisiblePieces: true };
    },
  },
  {
    id: "dur_trails_6",
    kind: "duration",
    durationTurns: 6,
    name: "Blocking Trails",
    description: "For 6 turns, pieces leave trails that block movement.",
    modifiers() {
      return { trails: true };
    },
  },
  {
    id: "dur_diagonal_only_5",
    kind: "duration",
    durationTurns: 5,
    name: "Diagonal Only",
    description: "For 5 turns, diagonal movement only.",
    modifiers() {
      return { diagonalOnly: true };
    },
  },
  {
    id: "dur_random_type_4",
    kind: "duration",
    durationTurns: 4,
    name: "Shapeshifters",
    description: "For 4 turns, pieces randomly change type after moving.",
    modifiers() {
      return { randomTypeAfterMove: true };
    },
  },
  {
    id: "dur_gravity_6",
    kind: "duration",
    durationTurns: 6,
    name: "Gravity",
    description: "For 6 turns, gravity pulls pieces downward each turn.",
    modifiers() {
      return { gravity: true };
    },
  },
  {
    id: "dur_respawn_pawns_5",
    kind: "duration",
    durationTurns: 5,
    name: "Pawn Respawn",
    description: "For 5 turns, captured pieces respawn as pawns.",
    modifiers() {
      return { respawnAsPawn: true };
    },
  },
  {
    id: "dur_mirrored_moves_8",
    kind: "duration",
    durationTurns: 8,
    name: "Mirrored Moves",
    description: "For 8 turns, opponent copies your last move if possible.",
    modifiers() {
      return { mirroredMoves: true };
    },
  },
  {
    id: "dur_king_knight_4",
    kind: "duration",
    durationTurns: 4,
    name: "Knight King",
    description: "For 4 turns, kings can move like knights.",
    modifiers() {
      return { kingsKnightLike: true };
    },
  },
  {
    id: "dur_tiles_disappear_6",
    kind: "duration",
    durationTurns: 6,
    name: "Vanishing Tiles",
    description: "For 6 turns, board tiles randomly disappear and reappear.",
    modifiers() {
      return { vanishingTiles: true };
    },
  },

  // ── NEW DURATION RULES ─────────────────────────────────────────────────────

  {
    id: "dur_king_of_hill_6",
    kind: "duration",
    durationTurns: 6,
    name: "King of the Hill",
    description: "For 6 turns, any piece standing on the central 4 squares at end of each turn is promoted one tier (pawn→knight→bishop→rook→queen). Queens stay queens.",
    modifiers() {
      return { kingOfHill: true };
    },
  },
  {
    id: "dur_fog_of_war_5",
    kind: "duration",
    durationTurns: 5,
    name: "Fog of War",
    description: "For 5 turns, you can only see squares within 1 of your own pieces. Enemy positions outside that range are hidden.",
    modifiers() {
      return { fogOfWar: true };
    },
  },
  {
    id: "dur_teleporter_corners_8",
    kind: "duration",
    durationTurns: 8,
    name: "Teleporter Tiles",
    description: "For 8 turns, landing on a corner square teleports the piece to a random empty square.",
    modifiers() {
      return { teleporterCorners: true };
    },
  },
  {
    id: "dur_echo_chamber_4",
    kind: "duration",
    durationTurns: 4,
    name: "Echo Chamber",
    description: "For 4 turns, every move is also mirrored along the vertical axis. If the mirror square is occupied, that piece is destroyed.",
    modifiers() {
      return { echoChamber: true };
    },
  },
];

function getRuleById(id) {
  return RULES.find((r) => r.id === id) || null;
}

function allRules() {
  return RULES;
}

module.exports = {
  allRules,
  getRuleById,
};
