const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const { createLobbyCode, createRoom, getRoom, joinRoom, leaveRoom } = require("./src/server/lobby");
const { Game } = require("./src/server/game/Game");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server);

/** roomCode -> { room, socketsByPlayerId } */
const rooms = new Map();

function getPlayerIdFromSocket(room, socketId) {
  const p = room.players.find((pl) => pl.socketId === socketId);
  return p?.id || null;
}

function emitRoomState(roomCode) {
  const entry = rooms.get(roomCode);
  if (!entry) return;
  io.to(roomCode).emit("game:state", entry.room.game.toClientState());
}

function pushEffectsAndState(roomCode) {
  const entry = rooms.get(roomCode);
  if (!entry) return;
  const state = entry.room.game.toClientState();
  io.to(roomCode).emit("game:state", state);
  entry.room.game.clearTransientEffects();
}

io.on("connection", (socket) => {
  socket.on("lobby:create", ({ name } = {}, cb) => {
    const code = createLobbyCode((c) => rooms.has(c));
    const room = createRoom(code);
    room.game = new Game({ roomCode: code });
    rooms.set(code, { room, socketsByPlayerId: new Map() });

    const player = room.addPlayer(socket.id, name || "Player 1");
    socket.join(code);
    rooms.get(code).socketsByPlayerId.set(player.id, socket.id);

    cb?.({ ok: true, code, playerId: player.id, color: player.color });
    pushEffectsAndState(code);
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
  });

  socket.on("game:requestMoves", ({ code, playerId, from } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getPlayerIdFromSocket(entry.room, socket.id);
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    const moves = game.getLegalDestinations(pid, from);
    cb?.({ ok: true, from, to: moves });
  });

  socket.on("game:move", ({ code, playerId, from, to, promotion } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getPlayerIdFromSocket(entry.room, socket.id);
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    const res = game.tryMove(pid, { from, to, promotion });
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:chooseRule", ({ code, playerId, ruleId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getPlayerIdFromSocket(entry.room, socket.id);
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    const res = game.chooseRule(pid, ruleId);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("disconnect", () => {
    for (const [code, entry] of rooms.entries()) {
      const room = entry.room;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) continue;

      leaveRoom(room, player.id);
      entry.socketsByPlayerId.delete(player.id);
      io.to(code).emit("lobby:message", { text: `${player.name} disconnected.` });
      pushEffectsAndState(code);

      // If empty, remove the room.
      if (room.players.length === 0) rooms.delete(code);
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
    const changed = beforePhase !== g.phase || beforeEffectSeq !== g.effectSeq;
    if (changed) pushEffectsAndState(code);
  }
}, 500);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Chess Variant server running on http://localhost:${PORT}`);
});
