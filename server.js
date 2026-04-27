const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const { createLobbyCode, createRoom, getRoom, joinRoom, leaveRoom } = require("./src/server/lobby");
const { Game } = require("./src/server/game/Game");
const { allRules } = require("./src/server/game/rules/ruleset");

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
  p.socketId = socket.id;
  p.disconnectedAt = null;
  socket.join(code);
  entry.socketsByPlayerId.set(p.id, socket.id);
}

function emitRoomState(roomCode) {
  const entry = rooms.get(roomCode);
  if (!entry) return;
  const state = entry.room.game.toClientState();
  emitToRoomAndPlayers(roomCode, entry, "game:state", state);
}

function pushEffectsAndState(roomCode) {
  const entry = rooms.get(roomCode);
  if (!entry) return;
  const state = entry.room.game.toClientState();
  emitToRoomAndPlayers(roomCode, entry, "game:state", state);
  entry.room.game.clearTransientEffects();
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
    io.to(socket.id).emit("game:state", entry.room.game.toClientState());
    cb?.({ ok: true });
  });

  socket.on("lobby:resume", ({ code, playerId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const room = entry.room;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return cb?.({ ok: false, error: "Player not found" });

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
