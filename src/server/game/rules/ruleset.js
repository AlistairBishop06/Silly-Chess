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

const RULES = [
  // 🔴 Instant (15)
  {
    id: "inst_rps_duel",
    kind: "instant",
    name: "RPS Duel",
    description: "Rock-paper-scissors duel. Loser loses a random non-king piece.",
    apply(game) {
      const winner = randInt(2) === 0 ? "w" : "b";
      const loser = winner === "w" ? "b" : "w";
      const sq = randomPieceSquare(game, loser, (p) => p.type !== "k");
      if (sq != null) destroySquares(game, [sq], "rps");
      game.effects.push({ type: "rule", id: game.nextEffectId(), text: `RPS duel winner: ${winner === "w" ? "White" : "Black"}` });
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
      // Apply in rank order to avoid chain collisions.
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

  // 🟡 In X Turns (15) — executed once when countdown hits 0.
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
    id: "del_spawn_rocks_3",
    kind: "delayed",
    delayTurns: 3,
    name: "Rock Garden",
    description: "In 3 turns, all empty squares spawn blocking rocks.",
    apply(game) {
      for (let i = 0; i < 64; i++) {
        if (game.missingSquares.has(i) || game.hazards.deadly.has(i)) continue;
        if (!game.state.board[i]) game.state.board[i] = { type: "x", color: "x", moved: true };
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
    apply(game) {
      const squares = pickN([...Array(64).keys()].filter((i) => !game.missingSquares.has(i)), 10);
      for (const sq of squares) game.hazards.lava.add(sq);
    },
  },
  {
    id: "del_chain_explosions_3",
    kind: "delayed",
    delayTurns: 3,
    name: "Chain Explosions",
    description: "In 3 turns, all captures trigger chain explosions.",
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
    apply(game) {
      game.permanent.allPiecesKingLike = true;
    },
  },

  // 🟢 For X Turns (15)
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
