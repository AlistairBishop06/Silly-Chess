(function () {
  function createBoardGeometry({ els, state }) {
    function boardSize() {
      const size = Number(state.serverState?.boardSize || 8);
      return Number.isInteger(size) && size >= 8 ? size : 8;
    }

    function toIdxSafe(file, rank) {
      return rank * boardSize() + file;
    }

    function squareName(sq) {
      const size = boardSize();
      const file = sq % size;
      const rank = Math.floor(sq / size);
      return String.fromCharCode(97 + file) + String(rank + 1);
    }

    function canvasPoint(px, py) {
      const rect = els.canvas.getBoundingClientRect();
      return {
        x: ((px - rect.left) / rect.width) * els.canvas.width,
        y: ((py - rect.top) / rect.height) * els.canvas.height,
      };
    }

    function canvasToSquare(px, py) {
      const boardN = boardSize();
      const { x, y } = canvasPoint(px, py);
      const tileSize = els.canvas.width / boardN;
      let file = Math.floor(x / tileSize);
      let rank = boardN - 1 - Math.floor(y / tileSize);
      if (file < 0 || file >= boardN || rank < 0 || rank >= boardN) return -1;

      if (state.flipVisual) {
        file = boardN - 1 - file;
        rank = boardN - 1 - rank;
      }
      return rank * boardN + file;
    }

    function squareToCanvasCenter(sq) {
      const boardN = boardSize();
      const tileSize = els.canvas.width / boardN;
      let file = sq % boardN;
      let rank = Math.floor(sq / boardN);
      if (state.flipVisual) {
        file = boardN - 1 - file;
        rank = boardN - 1 - rank;
      }
      const x = (file + 0.5) * tileSize;
      const y = (boardN - 1 - rank + 0.5) * tileSize;
      return { x, y };
    }

    function titanFootprint(anchor) {
      const size = boardSize();
      const file = anchor % size;
      const rank = Math.floor(anchor / size);
      if (file < 0 || file > size - 2 || rank < 0 || rank > size - 2) return [];
      return [anchor, anchor + 1, anchor + size, anchor + size + 1];
    }

    function titanAnchorAtSquare(board, square) {
      const piece = board?.[square];
      if (piece?.tags?.includes("titan")) return square;
      if (!piece?.tags?.includes("titanBody")) return null;
      const size = boardSize();
      const candidates = [square, square - 1, square - size, square - size - 1].filter((sq) => sq >= 0 && sq < (board || []).length);
      for (const candidate of candidates) {
        const titan = board?.[candidate];
        if (!titan?.tags?.includes("titan")) continue;
        if (titanFootprint(candidate).includes(square)) return candidate;
      }
      return null;
    }

    function titanBounds(anchor) {
      const footprint = titanFootprint(anchor).map((sq) => squareToCanvasCenter(sq));
      const xs = footprint.map((p) => p.x);
      const ys = footprint.map((p) => p.y);
      return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      };
    }

    function titanAnchorFromCanvasPoint(anchors, px, py) {
      const point = canvasPoint(px, py);
      const tileSize = els.canvas.width / boardSize();
      for (const anchor of anchors || []) {
        const box = titanBounds(anchor);
        const left = box.left - tileSize / 2;
        const right = box.right + tileSize / 2;
        const top = box.top - tileSize / 2;
        const bottom = box.bottom + tileSize / 2;
        if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return anchor;
      }
      return null;
    }

    return {
      algebraic: squareName,
      boardSize,
      canvasPoint,
      canvasToSquare,
      sqToAlg: squareName,
      squareToCanvasCenter,
      titanAnchorAtSquare,
      titanAnchorFromCanvasPoint,
      titanBounds,
      titanFootprint,
      toIdxSafe,
    };
  }

  window.ChaosChessBoardGeometry = { create: createBoardGeometry };
})();
