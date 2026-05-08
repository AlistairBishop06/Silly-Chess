const { toIdx } = require("./ChessEngine");

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
const FRUIT_MACHINE_TYPES = ["p", "n", "b", "r", "q", "k"];
const FRUIT_MACHINE_SPINS = 5;

module.exports = {
  serializeBoard,
  remapSet,
  DEMOTE_TYPE,
  PAWN_SOLDIER_HP,
  defaultPermanentFlags,
  deepCloneState,
  CORNER_SQUARES,
  HILL_SQUARES,
  HILL_PROMOTION,
  SUPERMARKET_COSTS,
  SUPERMARKET_BUDGET,
  FRUIT_MACHINE_TYPES,
  FRUIT_MACHINE_SPINS,
};
