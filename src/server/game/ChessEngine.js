// Minimal, self-contained chess engine with full legality (check, castling, en passant, promotion).
// The server is authoritative: clients only render and request moves.

function idxToFile(i) {
  return i % 8;
}
function idxToRank(i) {
  return Math.floor(i / 8);
}
function onBoard(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}
function toIdx(file, rank) {
  return rank * 8 + file;
}

function cloneBoard(board) {
  return board.map((p) => (p ? { ...p, tags: p.tags ? [...p.tags] : undefined } : null));
}

function other(color) {
  return color === "w" ? "b" : "w";
}

function pieceValue(type) {
  if (type === "q") return 9;
  if (type === "r") return 5;
  if (type === "b") return 3;
  if (type === "n") return 3;
  if (type === "p") return 1;
  if (type === "k") return 100;
  return 0;
}

function normalizeModifiers(mods) {
  return {
    wrapEdges: !!mods.wrapEdges,
    onlyPawnsMove: !!mods.onlyPawnsMove,
    noCapture: !!mods.noCapture,
    friendlyFire: !!mods.friendlyFire,
    diagonalOnly: !!mods.diagonalOnly,
    bumperBoard: !!mods.bumperBoard,
    forcedKingMove: !!mods.forcedKingMove,
    allPiecesKingLike: !!mods.allPiecesKingLike,
    knightsQueenLike: !!mods.knightsQueenLike,
    kingsKnightLike: !!mods.kingsKnightLike,
    bishopsRookLike: !!mods.bishopsRookLike,
    missingSquares: mods.missingSquares || new Set(),
    shield: mods.shield || { w: 0, b: 0 },
    requiredMove: mods.requiredMove || null,
  };
}

function stepWithWrap(file, rank, df, dr, wrapEdges, bumperBoard = false) {
  let nf = file + df;
  let nr = rank + dr;
  if (!wrapEdges) {
    if (onBoard(nf, nr)) return { nf, nr, ok: true };
    if (!bumperBoard) return { nf, nr, ok: false };
    nf = file - df;
    nr = rank - dr;
    return { nf, nr, ok: onBoard(nf, nr) };
  }
  nf = (nf + 8) % 8;
  nr = (nr + 8) % 8;
  return { nf, nr, ok: true };
}

function isMissing(mods, idx) {
  return mods.missingSquares && mods.missingSquares.has(idx);
}

function findKing(board, color) {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.color === color && p.type === "k") return i;
  }
  return null;
}

function isSquareAttacked(state, square, byColor, mods) {
  // Attack detection uses base chess geometry, but respects wrapEdges and missing squares.
  // Some variant rules (like allPiecesKingLike) intentionally affect legality; we keep
  // attack detection mostly "chess-like" to avoid impossible-to-reason check states.
  const board = state.board;
  const wrapEdges = mods.wrapEdges;
  const targetFile = idxToFile(square);
  const targetRank = idxToRank(square);

  function rayAttacked(dfs, drs, attackerTypes) {
    for (const [df, dr] of dfs.map((d, i) => [d, drs[i]])) {
      let file = targetFile;
      let rank = targetRank;
      for (let step = 0; step < 7; step++) {
        const { nf, nr, ok } = stepWithWrap(file, rank, df, dr, wrapEdges);
        if (!ok) break;
        file = nf;
        rank = nr;
        const idx = toIdx(file, rank);
        if (isMissing(mods, idx)) break;
        const p = board[idx];
        if (!p) continue;
        if (p.color !== byColor || p.color === "x") break;
        if (attackerTypes.includes(p.type) || (p.type === "k" && step === 0 && attackerTypes.includes("k"))) return true;
        break;
      }
    }
    return false;
  }

  // Knights
  const knightD = [
    [1, 2],
    [2, 1],
    [2, -1],
    [1, -2],
    [-1, -2],
    [-2, -1],
    [-2, 1],
    [-1, 2],
  ];
  for (const [df, dr] of knightD) {
    const { nf, nr, ok } = stepWithWrap(targetFile, targetRank, df, dr, wrapEdges);
    if (!ok) continue;
    const idx = toIdx(nf, nr);
    if (isMissing(mods, idx)) continue;
    const p = board[idx];
    if (p && p.color === byColor && p.type === "n") return true;
  }

  // Pawns (attack direction depends on attacker).
  const pawnDr = byColor === "w" ? -1 : 1;
  for (const df of [-1, 1]) {
    const { nf, nr, ok } = stepWithWrap(targetFile, targetRank, df, pawnDr, wrapEdges);
    if (!ok) continue;
    const idx = toIdx(nf, nr);
    if (isMissing(mods, idx)) continue;
    const p = board[idx];
    if (p && p.color === byColor && p.type === "p") return true;
  }

  // King adjacent
  for (const dr of [-1, 0, 1]) {
    for (const df of [-1, 0, 1]) {
      if (!df && !dr) continue;
      const { nf, nr, ok } = stepWithWrap(targetFile, targetRank, df, dr, wrapEdges);
      if (!ok) continue;
      const idx = toIdx(nf, nr);
      if (isMissing(mods, idx)) continue;
      const p = board[idx];
      if (p && p.color === byColor && p.type === "k") return true;
    }
  }

  // Sliding pieces.
  const diag = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const orth = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  if (rayAttacked(diag.map((d) => d[0]), diag.map((d) => d[1]), ["b", "q"])) return true;
  if (rayAttacked(orth.map((d) => d[0]), orth.map((d) => d[1]), ["r", "q"])) return true;

  return false;
}

function isInCheck(state, color, mods) {
  const kingSq = findKing(state.board, color);
  if (kingSq == null) return false;
  const attacked = isSquareAttacked(state, kingSq, other(color), mods);
  if (!attacked) return false;
  if ((mods.shield?.[color] || 0) > 0) return false;
  return true;
}

function applyMoveNoValidation(state, move, mods) {
  const next = {
    ...state,
    board: cloneBoard(state.board),
    lastMove: move,
    castling: { w: { ...state.castling.w }, b: { ...state.castling.b } },
  };
  const board = next.board;
  const from = move.from;
  const to = move.to;
  const piece = board[from];
  const target = board[to];

  // Update castling rights on rook capture (before overwriting squares).
  if (target && target.type === "r" && target.color !== "x" && !mods.wrapEdges) {
    const tRank = idxToRank(to);
    const tFile = idxToFile(to);
    if (tRank === 0 && target.color === "w") {
      if (tFile === 0) next.castling.w.q = false;
      if (tFile === 7) next.castling.w.k = false;
    }
    if (tRank === 7 && target.color === "b") {
      if (tFile === 0) next.castling.b.q = false;
      if (tFile === 7) next.castling.b.k = false;
    }
  }

  // En passant capture.
  if (piece && piece.type === "p" && state.enPassant != null && to === state.enPassant && !target) {
    const dir = piece.color === "w" ? -1 : 1;
    const capSq = toIdx(idxToFile(to), idxToRank(to) + dir);
    // En-passant capture can remove a rook in variants; handle castling rights too.
    const capPiece = board[capSq];
    if (capPiece && capPiece.type === "r" && !mods.wrapEdges) {
      const cr = idxToRank(capSq);
      const cf = idxToFile(capSq);
      if (cr === 0 && capPiece.color === "w") {
        if (cf === 0) next.castling.w.q = false;
        if (cf === 7) next.castling.w.k = false;
      }
      if (cr === 7 && capPiece.color === "b") {
        if (cf === 0) next.castling.b.q = false;
        if (cf === 7) next.castling.b.k = false;
      }
    }
    board[capSq] = null;
  }

  // Castling move rook.
  if (piece && piece.type === "k" && Math.abs(idxToFile(to) - idxToFile(from)) === 2) {
    const rank = idxToRank(from);
    if (idxToFile(to) === 6) {
      // king side
      const rookFrom = toIdx(7, rank);
      const rookTo = toIdx(5, rank);
      board[rookTo] = board[rookFrom];
      if (board[rookTo]) board[rookTo].moved = true;
      board[rookFrom] = null;
    } else if (idxToFile(to) === 2) {
      const rookFrom = toIdx(0, rank);
      const rookTo = toIdx(3, rank);
      board[rookTo] = board[rookFrom];
      if (board[rookTo]) board[rookTo].moved = true;
      board[rookFrom] = null;
    }
  }

  // Normal capture.
  board[to] = piece ? { ...piece, moved: true } : null;
  board[from] = null;

  // Update castling rights on king/rook moves (only meaningful when not wrapping).
  if (piece && !mods.wrapEdges) {
    if (piece.type === "k") {
      next.castling[piece.color].k = false;
      next.castling[piece.color].q = false;
    }
    if (piece.type === "r") {
      const f = idxToFile(from);
      const r = idxToRank(from);
      if (piece.color === "w" && r === 0) {
        if (f === 0) next.castling.w.q = false;
        if (f === 7) next.castling.w.k = false;
      }
      if (piece.color === "b" && r === 7) {
        if (f === 0) next.castling.b.q = false;
        if (f === 7) next.castling.b.k = false;
      }
    }
  }

  // Promotion.
  if (piece && piece.type === "p") {
    const endRank = piece.color === "w" ? 7 : 0;
    if (idxToRank(to) === endRank) {
      const promo = move.promotion && ["q", "r", "b", "n"].includes(move.promotion) ? move.promotion : "q";
      board[to].type = promo;
      board[to].tags = board[to].tags || [];
      board[to].tags.push("promoted");
    }
  }

  // Set en passant square.
  next.enPassant = null;
  if (piece && piece.type === "p") {
    const fromRank = idxToRank(from);
    const toRank = idxToRank(to);
    if (Math.abs(toRank - fromRank) === 2) {
      const midRank = (fromRank + toRank) / 2;
      next.enPassant = toIdx(idxToFile(from), midRank);
    }
  }

  next.turn = other(state.turn);
  return next;
}

function generatePseudoMoves(state, color, mods) {
  const board = state.board;
  const wrapEdges = mods.wrapEdges;
  const bumperBoard = mods.bumperBoard && !wrapEdges;
  const moves = [];

  function addMove(from, to, extra = {}) {
    if (isMissing(mods, to)) return;
    moves.push({ from, to, promotion: extra.promotion });
  }

  function canLandOn(toIdx, piece) {
    const t = board[toIdx];
    if (t && t.color === "x") return false;
    if (mods.noCapture && t) return false;
    if (t && t.type === "k" && t.color === piece.color) return false;
    if (isMissing(mods, toIdx)) return false;
    return !t || t.color !== piece.color || mods.friendlyFire;
  }

  for (let from = 0; from < 64; from++) {
    const p = board[from];
    if (!p || p.color !== color || p.color === "x") continue;
    if (p._stickyLocked) continue;
    if (mods.onlyPawnsMove && p.type !== "p") continue;

    const file = idxToFile(from);
    const rank = idxToRank(from);

    const type = p.type;
    const effectiveType = mods.allPiecesKingLike && type !== "k" ? "k" : type;

    // Forced king-move rule is enforced later (during validation) so we can still compute all moves.

    if (effectiveType === "p") {
      const dir = color === "w" ? 1 : -1;
      // Forward (non-capture)
      const { nf, nr, ok } = stepWithWrap(file, rank, 0, dir, wrapEdges, bumperBoard);
      if (ok && !mods.diagonalOnly) {
        const to = toIdx(nf, nr);
        if (!board[to] && !isMissing(mods, to)) addMove(from, to);
      }
      // Double step
      const startRank = color === "w" ? 1 : 6;
      if (rank === startRank && !p.moved && !mods.diagonalOnly) {
        const s1 = stepWithWrap(file, rank, 0, dir, wrapEdges, bumperBoard);
        const s2 = stepWithWrap(file, rank, 0, dir * 2, wrapEdges, bumperBoard);
        if (s1.ok && s2.ok) {
          const mid = toIdx(s1.nf, s1.nr);
          const to = toIdx(s2.nf, s2.nr);
          if (!board[mid] && !board[to] && !isMissing(mods, mid) && !isMissing(mods, to)) addMove(from, to);
        }
      }
      // Captures
      for (const df of [-1, 1]) {
        const s = stepWithWrap(file, rank, df, dir, wrapEdges, bumperBoard);
        if (!s.ok) continue;
        const to = toIdx(s.nf, s.nr);
        const t = board[to];
        if (mods.diagonalOnly && !t && !isMissing(mods, to)) addMove(from, to);
        if (t && t.color !== "x" && !mods.noCapture && (t.color !== color || mods.friendlyFire)) addMove(from, to);
        // En passant
        if (!mods.diagonalOnly && !t && state.enPassant != null && to === state.enPassant && !mods.noCapture) addMove(from, to);
      }
      continue;
    }

    const diagonals = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    const orth = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    if (effectiveType === "n") {
      const d = mods.knightsQueenLike
        ? diagonals.concat(orth)
        : [
            [1, 2],
            [2, 1],
            [2, -1],
            [1, -2],
            [-1, -2],
            [-2, -1],
            [-2, 1],
            [-1, 2],
          ];
      for (const [df, dr] of d) {
        if (mods.knightsQueenLike) {
          // As queen-like, slide.
          let f = file;
          let r = rank;
          let dirF = df;
          let dirR = dr;
          const visited = new Set([from]);
          for (let step = 0; step < 7; step++) {
            let s = stepWithWrap(f, r, dirF, dirR, wrapEdges, bumperBoard);
            if (!s.ok) break;
            if (bumperBoard && !onBoard(f + dirF, r + dirR)) {
              dirF *= -1;
              dirR *= -1;
              s = stepWithWrap(f, r, dirF, dirR, wrapEdges, false);
              if (!s.ok) break;
            }
            f = s.nf;
            r = s.nr;
            const to = toIdx(f, r);
            if (visited.has(to)) break;
            visited.add(to);
            if (isMissing(mods, to)) break;
            if (!canLandOn(to, p)) break;
            addMove(from, to);
            if (board[to]) break;
          }
        } else {
          const s = stepWithWrap(file, rank, df, dr, wrapEdges, bumperBoard);
          if (!s.ok) continue;
          const to = toIdx(s.nf, s.nr);
          if (!canLandOn(to, p)) continue;
          addMove(from, to);
        }
      }
      continue;
    }

    if (effectiveType === "k") {
      const d = [];
      for (const dr of [-1, 0, 1]) for (const df of [-1, 0, 1]) if (df || dr) d.push([df, dr]);
      if (mods.kingsKnightLike) {
        d.push([1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]);
      }
      for (const [df, dr] of d) {
        if (mods.diagonalOnly && Math.abs(df) !== Math.abs(dr)) continue;
        const s = stepWithWrap(file, rank, df, dr, wrapEdges, bumperBoard);
        if (!s.ok) continue;
        const to = toIdx(s.nf, s.nr);
        if (!canLandOn(to, p)) continue;
        addMove(from, to);
      }

      // Castling (only when not wrapping / not missing squares in between).
      if (!p.moved && !wrapEdges && !mods.diagonalOnly) {
        const rights = state.castling?.[color] || { k: true, q: true };
        const rank0 = color === "w" ? 0 : 7;
        if (rank === rank0 && file === 4) {
          if (rights.k) {
            const f1 = toIdx(5, rank0);
            const f2 = toIdx(6, rank0);
            const rookSq = toIdx(7, rank0);
            if (!board[f1] && !board[f2] && board[rookSq]?.type === "r" && board[rookSq]?.color === color && !isMissing(mods, f1) && !isMissing(mods, f2)) {
              addMove(from, f2);
            }
          }
          if (rights.q) {
            const f1 = toIdx(3, rank0);
            const f2 = toIdx(2, rank0);
            const f3 = toIdx(1, rank0);
            const rookSq = toIdx(0, rank0);
            if (!board[f1] && !board[f2] && !board[f3] && board[rookSq]?.type === "r" && board[rookSq]?.color === color && !isMissing(mods, f1) && !isMissing(mods, f2) && !isMissing(mods, f3)) {
              addMove(from, f2);
            }
          }
        }
      }

      continue;
    }

    const isBishop = effectiveType === "b";
    const isRook = effectiveType === "r";
    const isQueen = effectiveType === "q";
    const dirs = [];
    if (isBishop || isQueen) dirs.push(...diagonals);
    if (isRook || isQueen || (isBishop && mods.bishopsRookLike)) dirs.push(...orth);

    for (const [df, dr] of dirs) {
      if (mods.diagonalOnly && Math.abs(df) !== Math.abs(dr)) continue;
      let f = file;
      let r = rank;
      let dirF = df;
      let dirR = dr;
      const visited = new Set([from]);
      for (let step = 0; step < 7; step++) {
        let s = stepWithWrap(f, r, dirF, dirR, wrapEdges, bumperBoard);
        if (!s.ok) break;
        if (bumperBoard && !onBoard(f + dirF, r + dirR)) {
          dirF *= -1;
          dirR *= -1;
          s = stepWithWrap(f, r, dirF, dirR, wrapEdges, false);
          if (!s.ok) break;
        }
        f = s.nf;
        r = s.nr;
        const to = toIdx(f, r);
        if (visited.has(to)) break;
        visited.add(to);
        if (isMissing(mods, to)) break;
        if (!canLandOn(to, p)) break;
        addMove(from, to);
        if (board[to]) break;
      }
    }
  }

  return moves;
}

function generateLegalMoves(state, color, rawMods) {
  const mods = normalizeModifiers(rawMods || {});
  if (mods.requiredMove) {
    // Required move means: if that exact move is legal, only allow it; otherwise normal.
    const forced = { from: mods.requiredMove.from, to: mods.requiredMove.to, promotion: mods.requiredMove.promotion || "q" };
    const asList = generateLegalMoves(state, color, { ...mods, requiredMove: null });
    const found = asList.find((m) => m.from === forced.from && m.to === forced.to);
    return found ? [found] : asList;
  }

  const pseudo = generatePseudoMoves(state, color, mods);
  const legal = [];

  // Forced king move: if king has any legal moves, disallow non-king moves.
  let kingHasMove = false;
  if (mods.forcedKingMove) {
    for (const m of pseudo) {
      const p = state.board[m.from];
      if (p?.type !== "k") continue;
      const next = applyMoveNoValidation(state, m, mods);
      if (!isInCheck(next, color, mods)) {
        kingHasMove = true;
        break;
      }
    }
  }

  for (const m of pseudo) {
    const p = state.board[m.from];
    if (mods.forcedKingMove && kingHasMove && p?.type !== "k") continue;

    // Castling legality: cannot castle out of/through check.
    if (p?.type === "k" && Math.abs(idxToFile(m.to) - idxToFile(m.from)) === 2) {
      if (isInCheck(state, color, mods)) continue;
      const rank = idxToRank(m.from);
      const between = idxToFile(m.to) === 6 ? [toIdx(5, rank), toIdx(6, rank)] : [toIdx(3, rank), toIdx(2, rank)];
      let ok = true;
      for (const sq of between) {
        const temp = applyMoveNoValidation(state, { from: m.from, to: sq, promotion: m.promotion }, mods);
        if (isInCheck(temp, color, mods)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }

    const next = applyMoveNoValidation(state, m, mods);
    if (isInCheck(next, color, mods)) continue;
    legal.push(m);
  }
  return legal;
}

function initialState() {
  const board = Array(64).fill(null);
  // White pieces (rank 0/1)
  const wBack = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let f = 0; f < 8; f++) {
    board[toIdx(f, 0)] = { type: wBack[f], color: "w", moved: false };
    board[toIdx(f, 1)] = { type: "p", color: "w", moved: false };
    board[toIdx(f, 6)] = { type: "p", color: "b", moved: false };
  }
  const bBack = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let f = 0; f < 8; f++) {
    board[toIdx(f, 7)] = { type: bBack[f], color: "b", moved: false };
  }
  return {
    board,
    turn: "w",
    enPassant: null,
    castling: { w: { k: true, q: true }, b: { k: true, q: true } },
  };
}

module.exports = {
  other,
  pieceValue,
  initialState,
  cloneBoard,
  idxToFile,
  idxToRank,
  toIdx,
  onBoard,
  isSquareAttacked,
  isInCheck,
  applyMoveNoValidation,
  generateLegalMoves,
};
