(function () {
  const GAME_SESSION_KEY = "chaosChessSession";
  const ACCOUNT_SESSION_KEY = "chaosChessAccount";

  function loadGameSession() {
    try {
      const raw = localStorage.getItem(GAME_SESSION_KEY);
      if (!raw) return {};
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return {};
      return {
        lobby: typeof saved.lobby === "string" ? saved.lobby : null,
        playerId: typeof saved.playerId === "string" ? saved.playerId : null,
        color: saved.color === "w" || saved.color === "b" ? saved.color : null,
      };
    } catch {
      return {};
    }
  }

  function saveGameSession({ lobby, playerId, color }) {
    try {
      if (!lobby || !playerId || !color) {
        localStorage.removeItem(GAME_SESSION_KEY);
        return;
      }
      localStorage.setItem(GAME_SESSION_KEY, JSON.stringify({ lobby, playerId, color }));
    } catch {
      // ignore storage failures
    }
  }

  function loadAccountSession() {
    try {
      const raw = localStorage.getItem(ACCOUNT_SESSION_KEY);
      if (!raw) return {};
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return {};
      return {
        token: typeof saved.token === "string" ? saved.token : null,
        user: saved.user && typeof saved.user === "object" ? saved.user : null,
      };
    } catch {
      return {};
    }
  }

  function saveAccountSession({ token, user }) {
    try {
      if (!token || !user) {
        localStorage.removeItem(ACCOUNT_SESSION_KEY);
        return;
      }
      localStorage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ token, user }));
    } catch {
      // ignore storage failures
    }
  }

  window.ChaosChessStorage = {
    loadAccountSession,
    loadGameSession,
    saveAccountSession,
    saveGameSession,
  };
})();
