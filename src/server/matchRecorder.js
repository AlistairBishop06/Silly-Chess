function createMatchRecorder({
  completeCampaignLevelForUser,
  getUserStore,
  hydrateUser,
  ruleName,
  saveUsers,
  userById,
}) {
  function ratingDelta(rating, opponentRating, score, k = 24) {
    const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
    return Math.round(k * (score - expected));
  }
  
  function addRival(user, opponentName) {
    if (!opponentName || opponentName === user.username) return;
    const rivals = user.social.rivals;
    const existing = rivals.find((r) => r.name === opponentName);
    if (existing) existing.matches = (existing.matches || 0) + 1;
    else rivals.push({ name: opponentName, matches: 1 });
    rivals.sort((a, b) => (b.matches || 0) - (a.matches || 0));
    user.social.rivals = rivals.slice(0, 5);
  }
  
  function updateRuleCollection(user, ruleUses, won) {
    for (const [ruleId, count] of Object.entries(ruleUses || {})) {
      if (!count) continue;
      const item = user.ruleCollection[ruleId] || { used: 0, wins: 0, survived: 0 };
      item.used += count;
      item.survived += 1;
      if (won) item.wins += 1;
      user.ruleCollection[ruleId] = item;
    }
  }
  
  function recordMatchIfNeeded(code, entry) {
    const room = entry?.room;
    const game = room?.game;
    if (!room || !game?.resultInfo) return;
    const key = `${game.rematchId}:${game.resultInfo.winner}:${game.resultInfo.loser}:${game.resultInfo.reason}`;
    if (entry.recordedResultKey === key) return;
    entry.recordedResultKey = key;
  
    const endedAt = Date.now();
    const durationMs = Math.max(0, endedAt - (entry.matchStartedAt || room.createdAt || endedAt));
    const humanPlayers = (room.players || []).filter((p) => !p.bot && p.userId);
    if (!humanPlayers.length) return;
  
    const playersByColor = Object.fromEntries((room.players || []).map((p) => [p.color, p]));
    const oldRatings = {};
    for (const p of humanPlayers) {
      const user = hydrateUser(userById(p.userId));
      if (user) oldRatings[p.color] = user.stats.rating || 1000;
    }
  
    const changedUsers = new Set();
    const isSingleplayer = game.mode === "singleplayer";
    for (const p of humanPlayers) {
      const user = hydrateUser(userById(p.userId));
      if (!user) continue;
      const color = p.color;
      const won = game.resultInfo.winner === color;
      const lost = game.resultInfo.loser === color;
      const opponent = playersByColor[color === "w" ? "b" : "w"];
      const opponentUser = opponent?.userId ? hydrateUser(userById(opponent.userId)) : null;
      const opponentRating = opponentUser ? oldRatings[opponent.color] || opponentUser.stats.rating || 1000 : 900;
      const score = won ? 1 : lost ? 0 : 0.5;
      const beforeRating = oldRatings[color] || user.stats.rating || 1000;
      const delta = isSingleplayer ? 0 : ratingDelta(beforeRating, opponentRating, score, opponentUser ? 24 : 16);
      const coinsEarned = won ? (opponentUser ? 100 : 60) : 0;
  
      user.stats.gamesCompleted += 1;
      if (won) {
        user.stats.wins += 1;
        user.stats.coins += coinsEarned;
        user.stats.coinsEarned += coinsEarned;
        user.stats.currentWinstreak += 1;
        user.stats.highestWinstreak = Math.max(user.stats.highestWinstreak || 0, user.stats.currentWinstreak);
      } else if (lost) {
        user.stats.losses += 1;
        user.stats.currentWinstreak = 0;
      } else {
        user.stats.draws += 1;
        user.stats.currentWinstreak = 0;
      }
      if (color === "w") {
        user.stats.whiteGames += 1;
        if (won) user.stats.whiteWins += 1;
      } else {
        user.stats.blackGames += 1;
        if (won) user.stats.blackWins += 1;
      }
      if (won && game.resultInfo.reason === "checkmate") user.stats.checkmatesDelivered += 1;
      if (won && game.resultInfo.reason === "checkmate" && game.ply < 20) user.stats.fastCheckmates += 1;
      user.stats.capturesMade += game.matchStats?.captures?.[color] || 0;
      user.stats.extraMovesEarned += game.matchStats?.extraMoves?.[color] || 0;
      user.stats.kingsExploded += game.matchStats?.kingsExploded?.[color] || 0;
      user.stats.queensSacrificed += game.matchStats?.queensSacrificed?.[color] || 0;
      user.stats.pawnsPromoted += game.matchStats?.promotions?.[color] || 0;
      user.stats.lavaDeaths += game.matchStats?.lavaDeaths?.[color] || 0;
      user.stats.rulesSurvived += Object.keys(game.matchStats?.ruleUses?.[color] || {}).length;
      user.stats.totalGamePlies += game.ply || 0;
      user.stats.completedGameLengths += 1;
      if (!isSingleplayer) {
        user.stats.rating = Math.max(100, beforeRating + delta);
        user.stats.peakRating = Math.max(user.stats.peakRating || 1000, user.stats.rating);
      }
  
      updateRuleCollection(user, game.matchStats?.ruleUses?.[color], won);
      if (isSingleplayer) {
        completeCampaignLevelForUser(user, game.campaignLevel, won);
      } else {
        addRival(user, opponent?.name || "Chaos Bot");
        user.matchHistory.unshift({
          id: `${code}-${key}-${color}`,
          at: new Date(endedAt).toISOString(),
          opponent: opponent?.name || "Chaos Bot",
          result: won ? "Win" : lost ? "Loss" : "Draw",
          ratingChange: delta,
          ratingBefore: beforeRating,
          ratingAfter: user.stats.rating,
          coinsEarned,
          durationMs,
          plies: game.ply || 0,
          reason: game.resultInfo.reason,
          detail: game.resultInfo.detail || game.result || "",
          color,
          activatedRules: Object.keys(game.matchStats?.ruleUses?.[color] || {}).map((ruleId) => ruleName(ruleId)),
          moveList: Array.isArray(game.moveList) ? game.moveList.slice(-80) : [],
          replay: null,
        });
        user.matchHistory = user.matchHistory.slice(0, 30);
      }
      changedUsers.add(user.id);
    }
  
    if (changedUsers.size) saveUsers(getUserStore());
  }

  return { recordMatchIfNeeded };
}

module.exports = { createMatchRecorder };
