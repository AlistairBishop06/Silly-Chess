const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const { createLobbyCode, createRoom, getRoom, joinRoom, leaveRoom } = require("./src/server/lobby");
const { Game } = require("./src/server/game/Game");
const { allRules } = require("./src/server/game/rules/ruleset");
const {
  applyMoveNoValidation,
  generateLegalMoves,
  idxToFile,
  idxToRank,
  isInCheck,
  other,
  pieceValue,
} = require("./src/server/game/ChessEngine");

// DEBUG MODE: set `true` to enable debug-only UI/behaviour (e.g. player named "DEBUG" sees all rules at rule choice).
const DEBUG_MODE = true;

const app = express();

function ruleTypeLabel(rule) {
  if (rule.kind === "instant") return "Instant";
  if (rule.kind === "delayed") return `In ${rule.delayTurns} Turns`;
  if (rule.kind === "duration") return `For ${rule.durationTurns} Turns`;
  return "Rule";
}

function kindClass(rule) {
  if (rule.kind === "instant") return "instant";
  if (rule.kind === "delayed") return "delayed";
  if (rule.kind === "duration") return "duration";
  return "duration";
}

app.get("/api/rules", (_req, res) => {
  const rules = allRules();
  const cards = rules.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    kind: kindClass(r),
    typeLabel: ruleTypeLabel(r),
    remaining: r.kind === "duration" ? r.durationTurns : r.kind === "delayed" ? r.delayTurns : null,
  }));
  res.json({ ok: true, rules: cards });
});

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  })
);

const server = http.createServer(app);
const io = new Server(server);

/** roomCode -> { room, socketsByPlayerId } */
const rooms = new Map();

function randItem(items) {
  if (!items?.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function shuffled(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

function getPlayerIdFromSocket(room, socketId) {
  const p = room.players.find((pl) => pl.socketId === socketId);
  return p?.id || null;
}

function getOrRebindPlayerId({ code, room, socket, playerId }) {
  const bySocket = getPlayerIdFromSocket(room, socket.id);
  if (bySocket) {
    socket.join(code);
    return bySocket;
  }

  // Self-heal: if the client reconnects and missed `lobby:resume`, allow binding
  // an existing playerId that is currently disconnected (or bound to a dead socket).
  if (playerId) {
    const p = room.players.find((pl) => pl.id === playerId);
    if (p?.bot) return null;
    const boundSocket = p?.socketId ? io.sockets.sockets.get(p.socketId) : null;
    const boundAlive = !!boundSocket && boundSocket.connected && !boundSocket.disconnected;
    if (p && p.socketId && boundAlive && p.socketId !== socket.id) return null;
    if (p && (!p.socketId || !boundAlive)) {
      p.socketId = socket.id;
      p.disconnectedAt = null;
      socket.join(code);
      return p.id;
    }
  }
  return null;
}

function emitToRoomAndPlayers(code, entry, event, payload) {
  io.to(code).emit(event, payload);
  const sent = new Set();
  for (const p of entry.room.players || []) {
    if (!p?.socketId) continue;
    if (sent.has(p.socketId)) continue;
    sent.add(p.socketId);
    io.to(p.socketId).emit(event, payload);
  }
}

function touchPlayerSocket({ code, entry, playerId, socket }) {
  const p = entry.room.players.find((pl) => pl.id === playerId);
  if (!p) return;
  if (p.bot) return;
  p.socketId = socket.id;
  p.disconnectedAt = null;
  socket.join(code);
  entry.socketsByPlayerId.set(p.id, socket.id);
}

function emitRoomState(roomCode) {
  const entry = rooms.get(roomCode);
  if (!entry) return;
  const sent = new Set();
  for (const p of entry.room.players || []) {
    if (!p?.socketId || sent.has(p.socketId)) continue;
    sent.add(p.socketId);
    io.to(p.socketId).emit("game:state", entry.room.game.toClientState(p.id));
  }
}

function pushEffectsAndState(roomCode) {
  const entry = rooms.get(roomCode);
  if (!entry) return;
  const sent = new Set();
  for (const p of entry.room.players || []) {
    if (!p?.socketId || sent.has(p.socketId)) continue;
    sent.add(p.socketId);
    io.to(p.socketId).emit("game:state", entry.room.game.toClientState(p.id));
  }
  entry.room.game.clearTransientEffects();
  scheduleBotTurn(roomCode);
}

function botPlayer(room) {
  return room.players.find((p) => p.bot) || null;
}

function botLegalMoves(game, playerId) {
  const color = game.playerColor(playerId);
  if (color !== "w" && color !== "b") return [];
  const moves = [];
  for (let from = 0; from < 64; from++) {
    const piece = game.state.board[from];
    if (!piece || piece.color !== color) continue;
    const toSquares = game.getLegalDestinations(playerId, from);
    for (const to of toSquares) moves.push({ from, to, promotion: "q" });
  }
  return moves;
}

function cloneBotState(state) {
  return {
    ...state,
    board: state.board.map((p) => (p ? { ...p, tags: p.tags ? [...p.tags] : undefined } : null)),
    castling: { w: { ...state.castling.w }, b: { ...state.castling.b } },
    lastMove: state.lastMove ? { ...state.lastMove } : null,
  };
}

function botMaterialScore(board, color) {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || p.color === "x") continue;
    const sign = p.color === color ? 1 : -1;
    let value = pieceValue(p.type) * 100;
    if (p.tags?.includes("titan")) value += 220;
    if (p.tags?.includes("suicideBomber")) value += p.color === color ? 25 : -25;
    if (p._backupVital === p.color) value += 60;
    score += sign * value;
  }
  return score;
}

function botPositionalScore(board, color) {
  let score = 0;
  const forward = color === "w" ? 1 : -1;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || p.color === "x") continue;
    const sign = p.color === color ? 1 : -1;
    const file = idxToFile(sq);
    const rank = idxToRank(sq);
    const centerDist = Math.abs(file - 3.5) + Math.abs(rank - 3.5);
    score += sign * (18 - centerDist * 4);
    if (p.type === "p") {
      const progress = p.color === "w" ? rank : 7 - rank;
      score += sign * progress * 8;
    }
    if ((p.type === "n" || p.type === "b") && ((p.color === "w" && rank > 0) || (p.color === "b" && rank < 7))) {
      score += sign * 12;
    }
    if (p.type === "k") {
      const homeRank = p.color === "w" ? 0 : 7;
      const earlyShelter = rank === homeRank && (file === 6 || file === 2) ? 18 : 0;
      score += sign * earlyShelter;
    }
    if (p.color === color && p.type === "p") score += (rank - 3.5) * forward;
  }
  return score;
}

function botEvaluateState(state, color, mods) {
  const opponent = other(color);
  let score = botMaterialScore(state.board, color) + botPositionalScore(state.board, color);
  if (isInCheck(state, opponent, mods)) score += 90;
  if (isInCheck(state, color, mods)) score -= 140;

  const mine = generateLegalMoves(state, color, mods).length;
  const theirs = generateLegalMoves(state, opponent, mods).length;
  score += Math.min(mine, 30) * 4 - Math.min(theirs, 30) * 5;

  if (theirs === 0) score += isInCheck(state, opponent, mods) ? 100000 : 1500;
  if (mine === 0) score -= isInCheck(state, color, mods) ? 100000 : 1500;
  return score;
}

function botApplyMoveForSearch(state, move, mods) {
  return applyMoveNoValidation(cloneBotState(state), move, mods);
}

function botMoveScore(game, color, move, legalMoves) {
  const mods = game.currentModifiers();
  const before = game.state;
  const piece = before.board[move.from];
  const target = before.board[move.to];
  const next = botApplyMoveForSearch(before, move, mods);
  const opponent = other(color);

  let score = botEvaluateState(next, color, mods);
  if (target && target.color !== color) score += pieceValue(target.type) * 160 - pieceValue(piece?.type) * 12;
  if (piece?.type === "p" && (idxToRank(move.to) === 0 || idxToRank(move.to) === 7)) score += 750;
  if (isInCheck(next, opponent, mods)) score += 160;

  const replies = generateLegalMoves(next, opponent, mods);
  let bestReply = -Infinity;
  for (const reply of replies.slice(0, 40)) {
    const replyTarget = next.board[reply.to];
    const replyPiece = next.board[reply.from];
    const replyNext = botApplyMoveForSearch(next, reply, mods);
    let replyScore = botEvaluateState(replyNext, opponent, mods);
    if (replyTarget && replyTarget.color === color) replyScore += pieceValue(replyTarget.type) * 180 - pieceValue(replyPiece?.type) * 10;
    if (isInCheck(replyNext, color, mods)) replyScore += 140;
    if (replyScore > bestReply) bestReply = replyScore;
  }
  if (Number.isFinite(bestReply)) score -= bestReply * 0.72;

  const fromFile = idxToFile(move.from);
  const fromRank = idxToRank(move.from);
  const toFile = idxToFile(move.to);
  const toRank = idxToRank(move.to);
  const centerGain = Math.abs(fromFile - 3.5) + Math.abs(fromRank - 3.5) - (Math.abs(toFile - 3.5) + Math.abs(toRank - 3.5));
  score += centerGain * 18;

  // Prefer varied choices among similarly strong moves.
  score += Math.random() * 16;
  if (!legalMoves.length) score = -Infinity;
  return score;
}

function chooseBotMove(game, playerId) {
  const color = game.playerColor(playerId);
  if (color !== "w" && color !== "b") return null;
  const moves = botLegalMoves(game, playerId);
  if (!moves.length) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = botMoveScore(game, color, move, moves);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best || randItem(moves);
}

function botWagerSquares(game, color) {
  const candidates = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = game.state.board[sq];
    if (!p || p.color !== color || p.color === "x" || p.type === "k") continue;
    candidates.push(sq);
  }
  const limit = Math.min(candidates.length, Math.floor(Math.random() * 4));
  return shuffled(candidates).slice(0, limit);
}

function botSupermarketItems(budget = 10) {
  const costs = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const items = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  let remaining = Math.max(0, Number(budget) || 0);
  while (remaining > 0) {
    const affordable = ["q", "r", "b", "n", "p"].filter((type) => costs[type] <= remaining);
    if (!affordable.length || Math.random() < 0.25) break;
    const type = randItem(affordable);
    items[type] += 1;
    remaining -= costs[type];
  }
  return items;
}

function botTargetSquares(game, pending) {
  const color = pending?.color;
  if (pending?.ruleId === "inst_lawnmower") {
    const rows = [];
    for (let rank = 0; rank < 8; rank++) {
      let hasKing = false;
      for (let file = 0; file < 8; file++) {
        const p = game.state.board[rank * 8 + file];
        if (p?.type === "k") hasKing = true;
      }
      if (!hasKing) rows.push(rank * 8);
    }
    return shuffled(rows);
  }

  const squares = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = game.state.board[sq];
    if (!p || p.color !== color || p.color === "x") continue;
    if (pending?.ruleId === "inst_pawn_soldier" && p.type !== "p") continue;
    if (pending?.ruleId === "inst_backup_plan" && p.type === "k") continue;
    squares.push(sq);
  }
  return shuffled(squares);
}

function botPawnSoldierTarget(game, pending) {
  const color = pending?.color;
  const from = pending?.from;
  if (color !== "w" && color !== "b") return Math.floor(Math.random() * 64);

  const enemies = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = game.state.board[sq];
    if (!p || p.color !== other(color) || p.type === "k") continue;
    enemies.push(sq);
  }
  if (!enemies.length) return Math.floor(Math.random() * 64);
  if (from == null) return randItem(enemies);
  enemies.sort((a, b) => {
    const da = Math.abs(idxToFile(a) - idxToFile(from)) + Math.abs(idxToRank(a) - idxToRank(from));
    const db = Math.abs(idxToFile(b) - idxToFile(from)) + Math.abs(idxToRank(b) - idxToRank(from));
    return da - db;
  });
  return enemies[0];
}

function runBotAction(roomCode) {
  const entry = rooms.get(roomCode);
  if (!entry) return;
  entry.botTimer = null;

  const room = entry.room;
  const game = room.game;
  const bot = botPlayer(room);
  if (!game || !bot) return;

  let changed = false;
  const beforePhase = game.phase;
  const beforeEffectSeq = game.effectSeq;
  game.enforceRuleChoiceTimeoutIfNeeded();
  game.enforceBonusRuleChoiceTimeoutIfNeeded();
  game.enforceMiniGameTimeoutIfNeeded();
  game.enforceWagerTimeoutIfNeeded();
  changed = beforePhase !== game.phase || beforeEffectSeq !== game.effectSeq;

  if (game.resultInfo) {
    const humanReady = room.players.some((p) => !p.bot && game.readyByPlayerId?.[p.id]);
    if (humanReady && !game.readyByPlayerId?.[bot.id]) changed = !!game.toggleReady(bot.id)?.ok;
  } else if (game.phase === "ruleChoice") {
    const choices = game.ruleChoicesByPlayerId?.[bot.id] || [];
    if (!game.ruleChosenByPlayerId?.[bot.id] && choices.length) {
      const pick = randItem(choices);
      changed = !!game.chooseRule(bot.id, pick.id)?.ok;
    }
  } else if (game.phase === "bonusRuleChoice") {
    const choices = game.ruleChoicesByPlayerId?.[bot.id] || [];
    if (game.bonusRuleChoice?.playerId === bot.id && choices.length) {
      const pick = randItem(choices);
      changed = !!game.chooseRule(bot.id, pick.id)?.ok;
    }
  } else if (game.phase === "targetRule") {
    const pending = game.currentPendingTarget?.();
    if (pending?.playerId === bot.id) {
      for (const square of botTargetSquares(game, pending)) {
        const res = game.submitRuleTarget(bot.id, square);
        if (res.ok) {
          changed = true;
          break;
        }
      }
    }
  } else if (game.phase === "pawnSoldierShot") {
    const pending = game.pendingPawnSoldierShot;
    if (pending?.playerId === bot.id) {
      changed = !!game.submitPawnSoldierShot(bot.id, botPawnSoldierTarget(game, pending))?.ok;
    }
  } else if (game.phase === "supermarket") {
    if (game.supermarket?.playerId === bot.id) {
      changed = !!game.submitSupermarketPurchase(bot.id, botSupermarketItems(game.supermarket.budget))?.ok;
    }
  } else if (game.phase === "rps" && game.rps) {
    const color = game.playerColor(bot.id);
    if (color && !game.rps.byColor?.[color]) {
      changed = !!game.submitRpsChoice(bot.id, randItem(["rock", "paper", "scissors"]))?.ok;
    }
  } else if (game.phase === "wager" && game.wager?.stage === "select") {
    const color = game.playerColor(bot.id);
    if (color && !game.wager.confirmedByColor?.[color]) {
      const selected = botWagerSquares(game, color);
      const selectedOk = game.setWagerSelection(bot.id, selected);
      const confirmedOk = selectedOk.ok ? game.confirmWager(bot.id) : selectedOk;
      changed = !!confirmedOk.ok;
    }
  } else if (game.phase === "play" && game.state.turn === game.playerColor(bot.id)) {
    const move = chooseBotMove(game, bot.id);
    if (move) changed = !!game.tryMove(bot.id, move)?.ok;
  }

  if (changed) pushEffectsAndState(roomCode);
  else if (["wager", "rps", "ruleChoice", "bonusRuleChoice", "targetRule", "pawnSoldierShot", "supermarket"].includes(game.phase)) scheduleBotTurn(roomCode);
}

function scheduleBotTurn(roomCode) {
  const entry = rooms.get(roomCode);
  if (!entry || entry.botTimer) return;
  if (!botPlayer(entry.room)) return;
  entry.botTimer = setTimeout(() => runBotAction(roomCode), 550);
}

function getOpenPublicServers() {
  return [...rooms.values()]
    .map((entry) => entry.room)
    .filter(
      (room) =>
        room.visibility === "public" &&
        room.players.length < 2 &&
        room.players.some((player) => !!player.socketId) &&
        !room.game?.started
    )
    .map((room) => ({
      code: room.code,
      host: room.players[0]?.name || "Player 1",
      players: room.players.length,
      maxPlayers: 2,
      createdAt: room.createdAt || 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function emitOpenServers() {
  io.emit("lobby:openServers", { servers: getOpenPublicServers() });
}

io.on("connection", (socket) => {
  socket.on("game:sync", ({ code, playerId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    // Emit directly to this socket as a fallback when a room broadcast was missed.
    io.to(socket.id).emit("game:state", entry.room.game.toClientState(pid));
    cb?.({ ok: true });
  });

  socket.on("lobby:resume", ({ code, playerId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const room = entry.room;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return cb?.({ ok: false, error: "Player not found" });
    if (player.bot) return cb?.({ ok: false, error: "Player not found" });

    // Rebind this player to the new socket id.
    touchPlayerSocket({ code, entry, playerId: player.id, socket });

    cb?.({ ok: true, code, playerId: player.id, color: player.color });
    emitToRoomAndPlayers(code, entry, "lobby:message", { text: `${player.name} reconnected.` });
    pushEffectsAndState(code);
  });

  socket.on("lobby:leave", ({ code, playerId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const room = entry.room;
    const pid = getOrRebindPlayerId({ code, room, socket, playerId }) || playerId;
    const player = room.players.find((p) => p.id === pid);
    if (!player) return cb?.({ ok: false, error: "Not in this lobby" });

    emitToRoomAndPlayers(code, entry, "lobby:message", { text: `${player.name} left the lobby.` });
    emitToRoomAndPlayers(code, entry, "lobby:closed", { reason: "A player left the lobby." });

    if (entry.botTimer) clearTimeout(entry.botTimer);
    rooms.delete(code);
    cb?.({ ok: true });
    emitOpenServers();
  });

  socket.on("lobby:listOpen", (_payload, cb) => {
    const payload = { ok: true, servers: getOpenPublicServers() };
    cb?.(payload);
    socket.emit("lobby:openServers", { servers: payload.servers });
  });

  socket.on("lobby:create", ({ name, visibility } = {}, cb) => {
    const code = createLobbyCode((c) => rooms.has(c));
    const room = createRoom(code, { visibility });
    room.game = new Game({ roomCode: code, debugMode: DEBUG_MODE });
    rooms.set(code, { room, socketsByPlayerId: new Map() });

    const player = room.addPlayer(socket.id, name || "Player 1");
    socket.join(code);
    rooms.get(code).socketsByPlayerId.set(player.id, socket.id);

    cb?.({ ok: true, code, playerId: player.id, color: player.color });
    pushEffectsAndState(code);
    emitOpenServers();
  });

  socket.on("lobby:singleplayer", ({ name } = {}, cb) => {
    const code = createLobbyCode((c) => rooms.has(c));
    const room = createRoom(code, { visibility: "private" });
    room.game = new Game({ roomCode: code, debugMode: DEBUG_MODE });
    rooms.set(code, { room, socketsByPlayerId: new Map(), botTimer: null });

    const player = room.addPlayer(socket.id, name || "Player 1");
    const bot = room.addPlayer(null, "Chaos Bot");
    if (bot) bot.bot = true;

    socket.join(code);
    rooms.get(code).socketsByPlayerId.set(player.id, socket.id);

    if (room.players.length === 2 && !room.game.started) {
      room.game.start(room.players);
    }

    cb?.({ ok: true, code, playerId: player.id, color: player.color });
    pushEffectsAndState(code);
    emitOpenServers();
  });

  socket.on("lobby:join", ({ code, name } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const room = entry.room;
    const player = room.addPlayer(socket.id, name || "Player 2");
    if (!player) return cb?.({ ok: false, error: "Lobby full" });

    socket.join(code);
    entry.socketsByPlayerId.set(player.id, socket.id);
    cb?.({ ok: true, code, playerId: player.id, color: player.color });

    // Start once both players are in.
    if (room.players.length === 2 && !room.game.started) {
      room.game.start(room.players);
    }
    pushEffectsAndState(code);
    emitOpenServers();
  });

  socket.on("game:requestMoves", ({ code, playerId, from } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const moves = game.getLegalDestinations(pid, from);
    cb?.({ ok: true, from, to: moves });
  });

  socket.on("game:move", ({ code, playerId, from, to, promotion } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.tryMove(pid, { from, to, promotion });
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:chooseRule", ({ code, playerId, ruleId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.chooseRule(pid, ruleId);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:ruleTarget", ({ code, playerId, square } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.submitRuleTarget(pid, square);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:pawnSoldierShot", ({ code, playerId, target } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.submitPawnSoldierShot(pid, target);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:supermarketPurchase", ({ code, playerId, items } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.submitSupermarketPurchase(pid, items);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:rpsChoice", ({ code, playerId, choice } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.submitRpsChoice(pid, choice);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:wagerSelection", ({ code, playerId, squares } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.setWagerSelection(pid, squares);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:wagerConfirm", ({ code, playerId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.confirmWager(pid);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:ready", ({ code, playerId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.toggleReady(pid);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true, allReady: res.allReady });
    pushEffectsAndState(code);
  });

  socket.on("disconnect", () => {
    for (const [code, entry] of rooms.entries()) {
      const room = entry.room;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) continue;

      // Don't immediately remove the player; allow reconnects.
      player.socketId = null;
      player.disconnectedAt = Date.now();
      entry.socketsByPlayerId.delete(player.id);
      emitToRoomAndPlayers(code, entry, "lobby:message", { text: `${player.name} disconnected.` });
      pushEffectsAndState(code);

      // If everyone is gone for a while, remove the room.
      const allGone = room.players.length > 0 && room.players.every((p) => !p.socketId);
      const oldestGoneAt = Math.min(...room.players.map((p) => p.disconnectedAt || Date.now()));
      if (allGone && Date.now() - oldestGoneAt > 2 * 60_000) {
        if (entry.botTimer) clearTimeout(entry.botTimer);
        rooms.delete(code);
        emitOpenServers();
      } else {
        emitOpenServers();
      }
    }
  });
});

// Tick rule-choice timeouts even if nobody clicks.
setInterval(() => {
  for (const [code, entry] of rooms.entries()) {
    const g = entry.room.game;
    if (!g) continue;
    const beforePhase = g.phase;
    const beforeEffectSeq = g.effectSeq;
    g.enforceRuleChoiceTimeoutIfNeeded();
    g.enforceBonusRuleChoiceTimeoutIfNeeded();
    g.enforceMiniGameTimeoutIfNeeded();
    g.enforceWagerTimeoutIfNeeded();
    const changed = beforePhase !== g.phase || beforeEffectSeq !== g.effectSeq;
    if (changed) pushEffectsAndState(code);
  }
}, 500);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Chess Variant server running on http://localhost:${PORT}`);
});
