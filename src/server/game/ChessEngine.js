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

function boardSizeOf(stateOrMods) {
  const n = Number(stateOrMods?.boardSize || stateOrMods?.size || 8);
  return Number.isInteger(n) && n >= 8 ? n : 8;
}

function idxToFileSize(i, size) {
  return i % size;
}

function idxToRankSize(i, size) {
  return Math.floor(i / size);
}

function onBoardSize(file, rank, size) {
  return file >= 0 && file < size && rank >= 0 && rank < size;
}

function toIdxSize(file, rank, size) {
  return rank * size + file;
}

function cloneBoard(board) {
  return board.map((p) => (p ? { ...p, tags: p.tags ? [...p.tags] : undefined, movesAs: p.movesAs ? [...p.movesAs] : undefined } : null));
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

function pieceCanMoveAs(piece, type) {
  if (!piece) return false;
  if (piece.type === type) return true;
  return Array.isArray(piece.movesAs) && piece.movesAs.includes(type);
}

function normalizeModifiers(mods) {
  return {
    boardSize: boardSizeOf(mods),
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

function stepWithWrap(file, rank, df, dr, wrapEdges, bumperBoard = false, size = 8) {
  let nf = file + df;
  let nr = rank + dr;
  if (!wrapEdges) {
    if (onBoardSize(nf, nr, size)) return { nf, nr, ok: true };
    if (!bumperBoard) return { nf, nr, ok: false };
    if (nf < 0 || nf >= size) df *= -1;
    if (nr < 0 || nr >= size) dr *= -1;
    nf = file + df;
    nr = rank + dr;
    return { nf, nr, ok: onBoardSize(nf, nr, size) };
  }
  nf = (nf + size) % size;
  nr = (nr + size) % size;
  return { nf, nr, ok: true };
}

function stepWithDirection(file, rank, df, dr, wrapEdges, bumperBoard = false, size = 8) {
  let nf = file + df;
  let nr = rank + dr;
  if (!wrapEdges) {
    if (onBoardSize(nf, nr, size)) return { nf, nr, df, dr, ok: true };
    if (!bumperBoard) return { nf, nr, df, dr, ok: false };
    if (nf < 0 || nf >= size) df *= -1;
    if (nr < 0 || nr >= size) dr *= -1;
    nf = file + df;
    nr = rank + dr;
    return { nf, nr, df, dr, ok: onBoardSize(nf, nr, size) };
  }
  nf = (nf + size) % size;
  nr = (nr + size) % size;
  return { nf, nr, df, dr, ok: true };
}

function isMissing(mods, idx) {
  return mods.missingSquares && mods.missingSquares.has(idx);
}

function findKing(board, color) {
  for (let i = 0; i < board.length; i++) {
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
  const size = boardSizeOf(state);
  const wrapEdges = mods.wrapEdges;
  const bumperBoard = mods.bumperBoard && !wrapEdges;
  const maxRaySteps = wrapEdges || bumperBoard ? size * size - 1 : size - 1;
  const targetFile = idxToFileSize(square, size);
  const targetRank = idxToRankSize(square, size);

  function rayAttacked(dfs, drs, attackerTypes) {
    for (const [df, dr] of dfs.map((d, i) => [d, drs[i]])) {
      let file = targetFile;
      let rank = targetRank;
      let dirF = df;
      let dirR = dr;
      const visited = new Set([square]);
      for (let step = 0; step < maxRaySteps; step++) {
        const s = stepWithDirection(file, rank, dirF, dirR, wrapEdges, bumperBoard, size);
        const { nf, nr, ok } = s;
        if (!ok) break;
        dirF = s.df;
        dirR = s.dr;
        file = nf;
        rank = nr;
        const idx = toIdxSize(file, rank, size);
        if (visited.has(idx)) break;
        visited.add(idx);
        if (isMissing(mods, idx)) break;
        const p = board[idx];
        if (!p) continue;
        if (p.color !== byColor || p.color === "x") break;
        if (attackerTypes.some((type) => pieceCanMoveAs(p, type)) || (pieceCanMoveAs(p, "k") && step === 0 && attackerTypes.includes("k"))) return true;
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
    const { nf, nr, ok } = stepWithWrap(targetFile, targetRank, df, dr, wrapEdges, bumperBoard, size);
    if (!ok) continue;
    const idx = toIdxSize(nf, nr, size);
    if (isMissing(mods, idx)) continue;
    const p = board[idx];
    if (p && p.color === byColor && pieceCanMoveAs(p, "n")) return true;
  }

  // Pawns (attack direction depends on attacker).
  const pawnDr = byColor === "w" ? -1 : 1;
  for (const df of [-1, 1]) {
    const { nf, nr, ok } = stepWithWrap(targetFile, targetRank, df, pawnDr, wrapEdges, bumperBoard, size);
    if (!ok) continue;
    const idx = toIdxSize(nf, nr, size);
    if (isMissing(mods, idx)) continue;
    const p = board[idx];
    if (p && p.color === byColor && pieceCanMoveAs(p, "p")) return true;
  }

  // King adjacent
  for (const dr of [-1, 0, 1]) {
    for (const df of [-1, 0, 1]) {
      if (!df && !dr) continue;
      const { nf, nr, ok } = stepWithWrap(targetFile, targetRank, df, dr, wrapEdges, bumperBoard, size);
      if (!ok) continue;
      const idx = toIdxSize(nf, nr, size);
      if (isMissing(mods, idx)) continue;
      const p = board[idx];
      if (p && p.color === byColor && pieceCanMoveAs(p, "k")) return true;
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
  const size = boardSizeOf(state);
  const next = {
    ...state,
    board: cloneBoard(state.board),
    boardSize: size,
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
    const tRank = idxToRankSize(to, size);
    const tFile = idxToFileSize(to, size);
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
    const capSq = toIdxSize(idxToFileSize(to, size), idxToRankSize(to, size) + dir, size);
    // En-passant capture can remove a rook in variants; handle castling rights too.
    const capPiece = board[capSq];
    if (capPiece && capPiece.type === "r" && !mods.wrapEdges) {
      const cr = idxToRankSize(capSq, size);
      const cf = idxToFileSize(capSq, size);
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
  if (piece && piece.type === "k" && !piece.tags?.includes("mutant") && Math.abs(idxToFileSize(to, size) - idxToFileSize(from, size)) === 2) {
    const rank = idxToRankSize(from, size);
    if (idxToFileSize(to, size) === 6) {
      // king side
      const rookFrom = toIdxSize(7, rank, size);
      const rookTo = toIdxSize(5, rank, size);
      board[rookTo] = board[rookFrom];
      if (board[rookTo]) board[rookTo].moved = true;
      board[rookFrom] = null;
    } else if (idxToFileSize(to, size) === 2) {
      const rookFrom = toIdxSize(0, rank, size);
      const rookTo = toIdxSize(3, rank, size);
      board[rookTo] = board[rookFrom];
      if (board[rookTo]) board[rookTo].moved = true;
      board[rookFrom] = null;
    }
  }

  // Normal capture.
  board[to] = piece ? { ...piece, moved: true, tags: piece.tags ? [...piece.tags] : undefined, movesAs: piece.movesAs ? [...piece.movesAs] : undefined } : null;
  board[from] = null;

  // Update castling rights on king/rook moves (only meaningful when not wrapping).
  if (piece && !mods.wrapEdges) {
    if (piece.type === "k") {
      next.castling[piece.color].k = false;
      next.castling[piece.color].q = false;
    }
    if (piece.type === "r") {
      const f = idxToFileSize(from, size);
      const r = idxToRankSize(from, size);
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
    const endRank = piece.color === "w" ? size - 1 : 0;
    if (idxToRankSize(to, size) === endRank) {
      const promo = move.promotion && ["q", "r", "b", "n"].includes(move.promotion) ? move.promotion : "q";
      board[to].type = promo;
      board[to].tags = board[to].tags || [];
      board[to].tags.push("promoted");
    }
  }

  // Set en passant square.
  next.enPassant = null;
  if (piece && piece.type === "p") {
    const fromRank = idxToRankSize(from, size);
    const toRank = idxToRankSize(to, size);
    if (Math.abs(toRank - fromRank) === 2) {
      const midRank = (fromRank + toRank) / 2;
      next.enPassant = toIdxSize(idxToFileSize(from, size), midRank, size);
    }
  }

  next.turn = other(state.turn);
  return next;
}

function generatePseudoMoves(state, color, mods) {
  const board = state.board;
  const size = boardSizeOf(state);
  const wrapEdges = mods.wrapEdges;
  const bumperBoard = mods.bumperBoard && !wrapEdges;
  const maxRaySteps = wrapEdges || bumperBoard ? size * size - 1 : size - 1;
  const moves = [];
  const moveKeys = new Set();

  function addMove(from, to, extra = {}) {
    if (isMissing(mods, to)) return;
    const promotion = extra.promotion || "";
    const key = `${from}:${to}:${promotion}`;
    if (moveKeys.has(key)) return;
    moveKeys.add(key);
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

  for (let from = 0; from < board.length; from++) {
    const p = board[from];
    if (!p || p.color !== color || p.color === "x") continue;
    if (p._stickyLocked) continue;
    if (mods.onlyPawnsMove && p.type !== "p") continue;

    const file = idxToFileSize(from, size);
    const rank = idxToRankSize(from, size);

    const type = p.type;
    const effectiveType = mods.allPiecesKingLike && type !== "k" ? "k" : type;

    // Forced king-move rule is enforced later (during validation) so we can still compute all moves.

    if (effectiveType === "p") {
      const dir = color === "w" ? 1 : -1;
      // Forward (non-capture)
      const { nf, nr, ok } = stepWithWrap(file, rank, 0, dir, wrapEdges, bumperBoard, size);
      if (ok && !mods.diagonalOnly) {
        const to = toIdxSize(nf, nr, size);
        if (!board[to] && !isMissing(mods, to)) addMove(from, to);
      }
      // Double step
      const homeOffset = Math.max(0, Math.floor((size - 8) / 2));
      const startRank = color === "w" ? homeOffset + 1 : homeOffset + 6;
      if (rank === startRank && !p.moved && !mods.diagonalOnly) {
        const s1 = stepWithWrap(file, rank, 0, dir, wrapEdges, bumperBoard, size);
        const s2 = stepWithWrap(file, rank, 0, dir * 2, wrapEdges, bumperBoard, size);
        if (s1.ok && s2.ok) {
          const mid = toIdxSize(s1.nf, s1.nr, size);
          const to = toIdxSize(s2.nf, s2.nr, size);
          if (!board[mid] && !board[to] && !isMissing(mods, mid) && !isMissing(mods, to)) addMove(from, to);
        }
      }
      // Captures
      for (const df of [-1, 1]) {
        const s = stepWithWrap(file, rank, df, dir, wrapEdges, bumperBoard, size);
        if (!s.ok) continue;
        const to = toIdxSize(s.nf, s.nr, size);
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
          for (let step = 0; step < maxRaySteps; step++) {
            const s = stepWithDirection(f, r, dirF, dirR, wrapEdges, bumperBoard, size);
            if (!s.ok) break;
            dirF = s.df;
            dirR = s.dr;
            f = s.nf;
            r = s.nr;
            const to = toIdxSize(f, r, size);
            if (visited.has(to)) break;
            visited.add(to);
            if (isMissing(mods, to)) break;
            if (!canLandOn(to, p)) break;
            addMove(from, to);
            if (board[to]) break;
          }
        } else {
          const s = stepWithWrap(file, rank, df, dr, wrapEdges, bumperBoard, size);
          if (!s.ok) continue;
          const to = toIdxSize(s.nf, s.nr, size);
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
        const s = stepWithWrap(file, rank, df, dr, wrapEdges, bumperBoard, size);
        if (!s.ok) continue;
        const to = toIdxSize(s.nf, s.nr, size);
        if (!canLandOn(to, p)) continue;
        addMove(from, to);
      }

      // Castling (only when not wrapping / not missing squares in between).
      if (!p.moved && !wrapEdges && !mods.diagonalOnly) {
        const rights = state.castling?.[color] || { k: true, q: true };
        const homeOffset = Math.max(0, Math.floor((size - 8) / 2));
        const rank0 = color === "w" ? homeOffset : homeOffset + 7;
        if (rank === rank0 && file === homeOffset + 4) {
          if (rights.k) {
            const f1 = toIdxSize(homeOffset + 5, rank0, size);
            const f2 = toIdxSize(homeOffset + 6, rank0, size);
            const rookSq = toIdxSize(homeOffset + 7, rank0, size);
            if (!board[f1] && !board[f2] && board[rookSq]?.type === "r" && board[rookSq]?.color === color && !isMissing(mods, f1) && !isMissing(mods, f2)) {
              addMove(from, f2);
            }
          }
          if (rights.q) {
            const f1 = toIdxSize(homeOffset + 3, rank0, size);
            const f2 = toIdxSize(homeOffset + 2, rank0, size);
            const f3 = toIdxSize(homeOffset + 1, rank0, size);
            const rookSq = toIdxSize(homeOffset, rank0, size);
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
      for (let step = 0; step < maxRaySteps; step++) {
        const s = stepWithDirection(f, r, dirF, dirR, wrapEdges, bumperBoard, size);
        if (!s.ok) break;
        dirF = s.df;
        dirR = s.dr;
        f = s.nf;
        r = s.nr;
        const to = toIdxSize(f, r, size);
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
    const size = boardSizeOf(state);
    if (p?.type === "k" && Math.abs(idxToFileSize(m.to, size) - idxToFileSize(m.from, size)) === 2) {
      if (isInCheck(state, color, mods)) continue;
      const rank = idxToRankSize(m.from, size);
      const homeOffset = Math.max(0, Math.floor((size - 8) / 2));
      const between = idxToFileSize(m.to, size) === homeOffset + 6
        ? [toIdxSize(homeOffset + 5, rank, size), toIdxSize(homeOffset + 6, rank, size)]
        : [toIdxSize(homeOffset + 3, rank, size), toIdxSize(homeOffset + 2, rank, size)];
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
    boardSize: 8,
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
  boardSizeOf,
  isSquareAttacked,
  isInCheck,
  applyMoveNoValidation,
  generateLegalMoves,
};
