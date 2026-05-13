const { createLobbyCode, createRoom } = require("./lobby");
const { createBotController } = require("./botController");
const { Game } = require("./game/Game");
const { allRules } = require("./game/rules/ruleset");

function createRealtimeController({ io, runtimeFlags, accountService, recordMatchIfNeeded }) {
  const {
    accountFromPayload,
    addNotification,
    areFriends,
    applyAccountToPlayer,
    ensureCampaignProgress,
    flushUserStoreWrites,
    hydrateUser,
    recordGameStarted,
    saveUsers,
    shareClub,
    uniqueStrings,
    userById,
  } = accountService;

  /** roomCode -> { room, socketsByPlayerId } */
  const rooms = new Map();
  const onlineUsers = new Map(); // userId -> { socketId, username }
  const challengeInvites = new Map(); // inviteId -> { fromUserId, toUserId, createdAt }
  const botController = createBotController({ rooms, pushEffectsAndState });
  const { scheduleBotTurn } = botController;
  
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
      io.to(p.socketId).emit("game:state", stateForPlayer(entry.room.game, p.id));
    }
  }
  
  function campaignProgressForGamePlayer(game, playerId) {
    if (game?.mode !== "singleplayer" || !playerId) return null;
    const player = (game.players || []).find((p) => p.id === playerId);
    if (!player?.userId) return null;
    const user = hydrateUser(userById(player.userId));
    return user ? ensureCampaignProgress(user) : null;
  }
  
  function stateForPlayer(game, playerId) {
    const payload = game.toClientState(playerId);
    const campaign = campaignProgressForGamePlayer(game, playerId);
    if (campaign) payload.campaign = campaign;
    return payload;
  }
  
  function pushEffectsAndState(roomCode) {
    const entry = rooms.get(roomCode);
    if (!entry) return;
    const game = entry.room.game;
    if (game?.started && entry.seenRematchId !== game.rematchId && !game.resultInfo) {
      entry.seenRematchId = game.rematchId;
      entry.matchStartedAt = Date.now();
      entry.recordedResultKey = null;
    }
    recordMatchIfNeeded(roomCode, entry);
    const sent = new Set();
    for (const p of entry.room.players || []) {
      if (!p?.socketId || sent.has(p.socketId)) continue;
      sent.add(p.socketId);
      io.to(p.socketId).emit("game:state", stateForPlayer(entry.room.game, p.id));
    }
    entry.room.game.clearTransientEffects();
    scheduleBotTurn(roomCode);
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

  function activeRoomForUser(userId) {
    if (!userId) return null;
    for (const entry of rooms.values()) {
      const player = (entry.room.players || []).find((p) => p.userId === userId && !!p.socketId);
      if (player) return entry.room;
    }
    return null;
  }

  function userAvailableForChallenge(userId) {
    const online = onlineUsers.get(userId);
    if (!online?.socketId || !io.sockets.sockets.get(online.socketId)) return false;
    return !activeRoomForUser(userId);
  }

  function sendSocialState(user) {
    if (!user?.id) return;
    const online = onlineUsers.get(user.id);
    if (!online?.socketId) return;
    io.to(online.socketId).emit("social:state", {
      notifications: accountService.publicUser(user).social?.notifications || [],
    });
  }
  
  
  function removeRoom(code, entry) {
    if (entry?.botTimer) clearTimeout(entry.botTimer);
    rooms.delete(code);
  }
  
  function cleanupAbandonedRooms() {
    const now = Date.now();
    for (const [code, entry] of rooms.entries()) {
      const room = entry.room;
      const humanPlayers = (room.players || []).filter((p) => !p.bot);
      if (!humanPlayers.length) {
        removeRoom(code, entry);
        continue;
      }
      const allHumansGone = humanPlayers.every((p) => !p.socketId);
      if (!allHumansGone) continue;
      const oldestGoneAt = Math.min(...humanPlayers.map((p) => p.disconnectedAt || now));
      if (now - oldestGoneAt > 2 * 60_000) removeRoom(code, entry);
    }
  }
  
  io.on("connection", (socket) => {
    socket.on("social:identify", ({ authToken } = {}, cb) => {
      const account = accountFromPayload({ authToken });
      if (!account) return cb?.({ ok: false, error: "Sign in first." });
      socket.data.userId = account.id;
      onlineUsers.set(account.id, { socketId: socket.id, username: account.username });
      cb?.({ ok: true });
      sendSocialState(account);
    });

    socket.on("game:sync", ({ code, playerId } = {}, cb) => {
      const entry = rooms.get(code);
      if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
      const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
      if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
      touchPlayerSocket({ code, entry, playerId: pid, socket });
      // Emit directly to this socket as a fallback when a room broadcast was missed.
      io.to(socket.id).emit("game:state", stateForPlayer(entry.room.game, pid));
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
  
      removeRoom(code, entry);
      cb?.({ ok: true });
      emitOpenServers();
    });
  
    socket.on("lobby:listOpen", (_payload, cb) => {
      const payload = { ok: true, servers: getOpenPublicServers() };
      cb?.(payload);
      socket.emit("lobby:openServers", { servers: payload.servers });
    });
  
    socket.on("lobby:create", ({ authToken, visibility } = {}, cb) => {
      const account = accountFromPayload({ authToken });
      if (!account) return cb?.({ ok: false, error: "Sign in before creating a server." });
      onlineUsers.set(account.id, { socketId: socket.id, username: account.username });
      const code = createLobbyCode((c) => rooms.has(c));
      const room = createRoom(code, { visibility });
      room.game = new Game({ roomCode: code, debugMode: runtimeFlags.debugMode });
      rooms.set(code, { room, socketsByPlayerId: new Map() });
  
      const player = room.addPlayer(socket.id, account.username);
      applyAccountToPlayer(player, account);
      socket.join(code);
      rooms.get(code).socketsByPlayerId.set(player.id, socket.id);
      recordGameStarted(account, "multiplayer");
  
      cb?.({ ok: true, code, playerId: player.id, color: player.color });
      pushEffectsAndState(code);
      emitOpenServers();
    });
  
    socket.on("lobby:singleplayer", ({ authToken, rulePoolIds, campaignLevel } = {}, cb) => {
      const account = accountFromPayload({ authToken });
      if (!account) return cb?.({ ok: false, error: "Sign in before starting singleplayer." });
      onlineUsers.set(account.id, { socketId: socket.id, username: account.username });
      const code = createLobbyCode((c) => rooms.has(c));
      const room = createRoom(code, { visibility: "private" });
      const knownRuleIds = new Set(allRules().map((rule) => rule.id));
      const requestedPool = Array.isArray(rulePoolIds)
        ? [...new Set(rulePoolIds.filter((id) => typeof id === "string" && knownRuleIds.has(id)))]
        : null;
      const normalizedCampaignLevel =
        Number.isFinite(Number(campaignLevel)) && Number(campaignLevel) > 0 ? Math.floor(Number(campaignLevel)) : null;
      let filteredPool = requestedPool;
      if (normalizedCampaignLevel) {
        const campaign = ensureCampaignProgress(account);
        if (normalizedCampaignLevel > (campaign.highestUnlockedLevel || 1)) {
          return cb?.({ ok: false, error: "That campaign level is locked." });
        }
        const singleplayerPool = uniqueStrings(campaign.unlockedRuleIds || []).filter((id) => knownRuleIds.has(id));
        filteredPool = requestedPool && requestedPool.length ? requestedPool : singleplayerPool;
      }
      room.game = new Game({
        roomCode: code,
        debugMode: runtimeFlags.debugMode,
        mode: "singleplayer",
        campaignLevel: normalizedCampaignLevel,
        rulePoolIds: filteredPool && filteredPool.length ? filteredPool : null,
      });
      rooms.set(code, { room, socketsByPlayerId: new Map(), botTimer: null });
  
      const player = room.addPlayer(socket.id, account.username);
      applyAccountToPlayer(player, account);
      const bot = room.addPlayer(null, "Chaos Bot");
      if (bot) {
        bot.bot = true;
        bot.profile = {
          avatar: "BOT",
          banner: "Rule Storm",
          boardSkin: "Arcade Grid",
          pieceSkin: "Void Metal",
          border: "Glitch",
          emote: "Chaos approved",
          cardBack: "Static Noise",
        };
      }
  
      socket.join(code);
      rooms.get(code).socketsByPlayerId.set(player.id, socket.id);
      recordGameStarted(account, "singleplayer");
  
      if (room.players.length === 2 && !room.game.started) {
        room.game.start(room.players);
      }
  
      cb?.({ ok: true, code, playerId: player.id, color: player.color });
      pushEffectsAndState(code);
      emitOpenServers();
    });
  
    socket.on("lobby:join", ({ code, authToken } = {}, cb) => {
      const account = accountFromPayload({ authToken });
      if (!account) return cb?.({ ok: false, error: "Sign in before joining a server." });
      onlineUsers.set(account.id, { socketId: socket.id, username: account.username });
      const entry = rooms.get(code);
      if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
      const room = entry.room;
      if (room.players.some((p) => p.userId && p.userId === account.id)) {
        return cb?.({ ok: false, error: "You are already in this lobby." });
      }
      const player = room.addPlayer(socket.id, account.username);
      if (!player) return cb?.({ ok: false, error: "Lobby full" });
      applyAccountToPlayer(player, account);
  
      socket.join(code);
      entry.socketsByPlayerId.set(player.id, socket.id);
      recordGameStarted(account, "multiplayer");
      cb?.({ ok: true, code, playerId: player.id, color: player.color });
  
      // Start once both players are in.
      if (room.players.length === 2 && !room.game.started) {
        room.game.start(room.players);
      }
      pushEffectsAndState(code);
      emitOpenServers();
    });
  
    function withGamePlayer(payload = {}, cb, handler) {
      const { code, playerId } = payload;
      const entry = rooms.get(code);
      if (!entry) {
        cb?.({ ok: false, error: "Lobby not found" });
        return null;
      }
      const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
      if (!pid) {
        cb?.({ ok: false, error: "Not in this lobby" });
        return null;
      }
      touchPlayerSocket({ code, entry, playerId: pid, socket });
      return handler({ code, entry, game: entry.room.game, playerId: pid });
    }

    function registerGameAction(event, action) {
      socket.on(event, (payload = {}, cb) => {
        withGamePlayer(payload, cb, ({ code, game, playerId }) => {
          const res = action(game, playerId, payload);
          if (!res.ok) return cb?.(res);
          cb?.({ ok: true, ...(res.extra || {}) });
          pushEffectsAndState(code);
        });
      });
    }

    socket.on("game:requestMoves", (payload = {}, cb) => {
      withGamePlayer(payload, cb, ({ game, playerId }) => {
        cb?.({ ok: true, from: payload.from, to: game.getLegalDestinations(playerId, payload.from) });
      });
    });

    const gameActions = {
      "game:move": (game, playerId, { from, to, promotion }) => game.tryMove(playerId, { from, to, promotion }),
      "game:chooseRule": (game, playerId, { ruleId }) => game.chooseRule(playerId, ruleId),
      "game:ruleTarget": (game, playerId, { square }) => game.submitRuleTarget(playerId, square),
      "game:pawnSoldierShot": (game, playerId, { target }) => game.submitPawnSoldierShot(playerId, target),
      "game:mutantSelection": (game, playerId, { squares }) => game.setMutantSelection(playerId, squares),
      "game:mutantConfirm": (game, playerId) => game.confirmMutantFusion(playerId),
      "game:supermarketPurchase": (game, playerId, { items }) => game.submitSupermarketPurchase(playerId, items),
      "game:fruitMachineSpin": (game, playerId) => game.submitFruitMachineSpin(playerId),
      "game:fruitMachineCollect": (game, playerId) => game.collectFruitMachinePrizes(playerId),
      "game:boardPopupChoice": (game, playerId, { choiceId }) => game.submitBoardPopupChoice(playerId, choiceId),
      "game:rpsChoice": (game, playerId, { choice }) => game.submitRpsChoice(playerId, choice),
      "game:wagerSelection": (game, playerId, { squares }) => game.setWagerSelection(playerId, squares),
      "game:wagerConfirm": (game, playerId) => game.confirmWager(playerId),
      "game:ready": (game, playerId) => {
        const res = game.toggleReady(playerId);
        return res.ok ? { ok: true, extra: { allReady: res.allReady } } : res;
      },
    };

    for (const [event, action] of Object.entries(gameActions)) registerGameAction(event, action);

    socket.on("social:challenge", ({ authToken, username } = {}, cb) => {
      const challenger = accountFromPayload({ authToken });
      if (!challenger) return cb?.({ ok: false, error: "Sign in first." });
      const targetName = String(username || "").trim();
      const target = Object.values(accountService.userStore.users || {}).find(
        (u) => u?.usernameKey === String(targetName).toLowerCase().trim()
      );
      if (!target) return cb?.({ ok: false, error: "Player not found." });
      hydrateUser(target);
      if (target.id === challenger.id) return cb?.({ ok: false, error: "You cannot challenge yourself." });
      if (!areFriends(challenger, target) && !shareClub(challenger, target)) return cb?.({ ok: false, error: "You can only challenge friends or clubmates." });
      if (!userAvailableForChallenge(challenger.id)) return cb?.({ ok: false, error: "You are already in a game or lobby." });
      if (!userAvailableForChallenge(target.id)) return cb?.({ ok: false, error: "That player is not available right now." });

      const inviteId = `C${Date.now().toString(36)}${Math.floor(Math.random() * 100000).toString(36)}`;
      challengeInvites.set(inviteId, { fromUserId: challenger.id, toUserId: target.id, createdAt: Date.now() });
      const targetOnline = onlineUsers.get(target.id);
      io.to(targetOnline.socketId).emit("social:challenge", {
        id: inviteId,
        fromUserId: challenger.id,
        fromUsername: challenger.username,
        message: `${challenger.username} challenged you to a game.`,
      });
      cb?.({ ok: true });
    });

    socket.on("social:challengeResponse", ({ authToken, challengeId, accepted } = {}, cb) => {
      const target = accountFromPayload({ authToken });
      if (!target) return cb?.({ ok: false, error: "Sign in first." });
      const invite = challengeInvites.get(challengeId);
      if (!invite || invite.toUserId !== target.id) return cb?.({ ok: false, error: "Challenge not found." });
      challengeInvites.delete(challengeId);
      const challenger = userById(invite.fromUserId);
      if (!challenger) return cb?.({ ok: false, error: "Challenger not found." });
      hydrateUser(challenger);

      const challengerOnline = onlineUsers.get(challenger.id);
      const targetOnline = onlineUsers.get(target.id);
      if (!accepted) {
        if (challengerOnline?.socketId) {
          io.to(challengerOnline.socketId).emit("social:challengeDeclined", { fromUsername: target.username });
        }
        return cb?.({ ok: true });
      }
      if (!userAvailableForChallenge(challenger.id) || !userAvailableForChallenge(target.id)) {
        return cb?.({ ok: false, error: "Both players must be online and outside a game." });
      }

      const code = createLobbyCode((c) => rooms.has(c));
      const room = createRoom(code, { visibility: "private" });
      room.game = new Game({ roomCode: code, debugMode: runtimeFlags.debugMode });
      rooms.set(code, { room, socketsByPlayerId: new Map() });
      const entry = rooms.get(code);

      const white = room.addPlayer(challengerOnline.socketId, challenger.username);
      applyAccountToPlayer(white, challenger);
      const black = room.addPlayer(targetOnline.socketId, target.username);
      applyAccountToPlayer(black, target);
      io.sockets.sockets.get(challengerOnline.socketId)?.join(code);
      io.sockets.sockets.get(targetOnline.socketId)?.join(code);
      entry.socketsByPlayerId.set(white.id, white.socketId);
      entry.socketsByPlayerId.set(black.id, black.socketId);
      recordGameStarted(challenger, "multiplayer");
      recordGameStarted(target, "multiplayer");
      room.game.start(room.players);

      io.to(white.socketId).emit("lobby:challengeStarted", { ok: true, code, playerId: white.id, color: white.color });
      io.to(black.socketId).emit("lobby:challengeStarted", { ok: true, code, playerId: black.id, color: black.color });
      cb?.({ ok: true });
      pushEffectsAndState(code);
      emitOpenServers();
    });

    socket.on("game:emote", (payload = {}, cb) => {
      withGamePlayer(payload, cb, ({ code, entry, playerId }) => {
        const player = entry.room.players.find((p) => p.id === playerId);
        const text = String(player?.profile?.emote || "Good game").slice(0, 40);
        emitToRoomAndPlayers(code, entry, "game:emote", {
          playerId,
          name: player?.name || "Player",
          color: player?.color || null,
          text,
        });
        cb?.({ ok: true });
      });
    });

    socket.on("disconnect", () => {
      if (socket.data?.userId && onlineUsers.get(socket.data.userId)?.socketId === socket.id) {
        onlineUsers.delete(socket.data.userId);
      }
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
        const humanPlayers = room.players.filter((p) => !p.bot);
        const allGone = humanPlayers.length > 0 && humanPlayers.every((p) => !p.socketId);
        const oldestGoneAt = Math.min(...humanPlayers.map((p) => p.disconnectedAt || Date.now()));
        if (allGone && Date.now() - oldestGoneAt > 2 * 60_000) {
          removeRoom(code, entry);
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
    cleanupAbandonedRooms();
  }, 500);

  function updateActivePlayerNamesInRooms(user) {
    if (!user) return;
    const changedRooms = [];
    for (const entry of rooms.values()) {
      const changedPlayers = [];
      for (const p of entry.room.players || []) {
        if (p.userId !== user.id) continue;
        p.name = user.username;
        p.profile = accountService.publicPlayerProfile(user);
        changedPlayers.push(p.id);
      }
      if (!changedPlayers.length || !entry.room.game?.players) continue;
      for (const gp of entry.room.game.players) {
        if (!changedPlayers.includes(gp.id)) continue;
        gp.name = user.username;
        gp.profile = accountService.publicPlayerProfile(user);
      }
      if (entry.room?.code) changedRooms.push(entry.room.code);
    }
    for (const code of changedRooms) pushEffectsAndState(code);
  }

  return {
    rooms,
    updateActivePlayerNamesInRooms,
  };
}

module.exports = { createRealtimeController };
