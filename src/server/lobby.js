function randomChar() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return chars[Math.floor(Math.random() * chars.length)];
}

function createLobbyCode(isTaken) {
  let code = "";
  for (let tries = 0; tries < 200; tries++) {
    code = "";
    for (let i = 0; i < 6; i++) code += randomChar();
    if (!isTaken(code)) return code;
  }
  // Fallback: extremely unlikely in practice.
  return `${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function createRoom(code, { visibility = "private" } = {}) {
  return {
    code,
    visibility: visibility === "public" ? "public" : "private",
    createdAt: Date.now(),
    players: [],
    game: null,
    addPlayer(socketId, name) {
      if (this.players.length >= 2) return null;
      const color = this.players.length === 0 ? "w" : "b";
      const player = { id: `${code}-${color}`, socketId, name, color };
      this.players.push(player);
      return player;
    },
  };
}

function getRoom(rooms, code) {
  return rooms.get(code);
}

function joinRoom(room, playerId) {
  return room.players.find((p) => p.id === playerId);
}

function leaveRoom(room, playerId) {
  room.players = room.players.filter((p) => p.id !== playerId);
}

module.exports = {
  createLobbyCode,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
};
