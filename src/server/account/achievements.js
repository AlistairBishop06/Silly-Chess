function createAchievementService({ allRules, hydrateUser }) {
  function achievementsForUser(user) {
    return buildAchievementsForUser(user).achievements;
  }
  
  function ruleUseCount(user, ruleId) {
    return user.ruleCollection?.[ruleId]?.used || 0;
  }
  
  function ruleWinCount(user, ruleId) {
    return user.ruleCollection?.[ruleId]?.wins || 0;
  }
  
  function rulesUsedByKind(user, kind) {
    return allRules().filter((rule) => rule.kind === kind).reduce((sum, rule) => sum + ruleUseCount(user, rule.id), 0);
  }
  
  function discoveredRules(user) {
    return Object.values(user.ruleCollection || {}).filter((entry) => (entry?.used || 0) > 0).length;
  }
  
  function uniqueRuleWins(user) {
    return Object.values(user.ruleCollection || {}).filter((entry) => (entry?.wins || 0) > 0).length;
  }
  
  const ACHIEVEMENT_DEFS = [
    { id: "first_game", name: "At The Table", description: "Start your first match.", target: 1, reward: 20, progress: (u) => u.stats.gamesPlayed },
    { id: "first_win", name: "First Chaos Win", description: "Win a match.", target: 1, reward: 60, progress: (u) => u.stats.wins },
    { id: "wins_5", name: "Table Regular", description: "Win 5 matches.", target: 5, reward: 120, progress: (u) => u.stats.wins },
    { id: "wins_10", name: "Chaos Competitor", description: "Win 10 matches.", target: 10, reward: 220, progress: (u) => u.stats.wins },
    { id: "wins_25", name: "Board Menace", description: "Win 25 matches.", target: 25, reward: 450, progress: (u) => u.stats.wins },
    { id: "wins_50", name: "Grand Anarchist Path", description: "Win 50 matches.", target: 50, reward: 900, progress: (u) => u.stats.wins },
    { id: "singleplayer_5", name: "Bot Bully", description: "Start 5 singleplayer games.", target: 5, reward: 80, progress: (u) => u.stats.singleplayerGames },
    { id: "multiplayer_5", name: "Public Menace", description: "Start 5 multiplayer games.", target: 5, reward: 100, progress: (u) => u.stats.multiplayerGames },
    { id: "captures_25", name: "Piece Collector", description: "Capture 25 pieces.", target: 25, reward: 100, progress: (u) => u.stats.capturesMade },
    { id: "captures_100", name: "Board Cleaner", description: "Capture 100 pieces.", target: 100, reward: 250, progress: (u) => u.stats.capturesMade },
    { id: "checkmates_3", name: "Finisher", description: "Deliver 3 checkmates.", target: 3, reward: 150, progress: (u) => u.stats.checkmatesDelivered },
    { id: "checkmates_10", name: "Checkmate Dealer", description: "Deliver 10 checkmates.", target: 10, reward: 350, progress: (u) => u.stats.checkmatesDelivered },
    { id: "fast_mate", name: "Speed Trial", description: "Checkmate in under 10 turns.", target: 1, reward: 180, progress: (u) => u.stats.fastCheckmates },
    { id: "streak_3", name: "On A Run", description: "Reach a 3-game win streak.", target: 3, reward: 120, progress: (u) => u.stats.highestWinstreak },
    { id: "streak_7", name: "Untouchable", description: "Reach a 7-game win streak.", target: 7, reward: 400, progress: (u) => u.stats.highestWinstreak },
    { id: "silver_rating", name: "Silver Table", description: "Reach Silver rating.", target: 1100, reward: 160, progress: (u) => u.stats.peakRating },
    { id: "gold_rating", name: "Gold Table", description: "Reach Gold rating.", target: 1400, reward: 300, progress: (u) => u.stats.peakRating },
    { id: "chaos_master_rating", name: "Chaos Master", description: "Reach Chaos Master rating.", target: 1800, reward: 650, progress: (u) => u.stats.peakRating },
    { id: "grand_anarchist_rating", name: "Grand Anarchist", description: "Reach Grand Anarchist rating.", target: 2200, reward: 1200, progress: (u) => u.stats.peakRating },
    { id: "lava_5", name: "Lava Proof", description: "Have lava decide 5 piece deaths.", target: 5, reward: 160, progress: (u) => u.stats.lavaDeaths },
    { id: "lava_20", name: "Volcanic Lifestyle", description: "Have lava decide 20 piece deaths.", target: 20, reward: 400, progress: (u) => u.stats.lavaDeaths },
    { id: "extra_moves_10", name: "Tempo Thief", description: "Earn 10 extra moves.", target: 10, reward: 160, progress: (u) => u.stats.extraMovesEarned },
    { id: "extra_moves_50", name: "Time Hog", description: "Earn 50 extra moves.", target: 50, reward: 420, progress: (u) => u.stats.extraMovesEarned },
    { id: "promotions_5", name: "Promotion Party", description: "Promote 5 pawns.", target: 5, reward: 140, progress: (u) => u.stats.pawnsPromoted },
    { id: "queens_sacrificed_5", name: "Queen Gambler", description: "Lose or sacrifice 5 queens.", target: 5, reward: 140, progress: (u) => u.stats.queensSacrificed },
    { id: "kings_exploded_3", name: "Regicide Enjoyer", description: "Have 3 kings destroyed by hazards.", target: 3, reward: 220, progress: (u) => u.stats.kingsExploded },
    { id: "discover_10_rules", name: "Rule Tourist", description: "Discover 10 different rule cards.", target: 10, reward: 150, progress: discoveredRules },
    { id: "discover_25_rules", name: "Rule Collector", description: "Discover 25 different rule cards.", target: 25, reward: 350, progress: discoveredRules },
    { id: "discover_50_rules", name: "Rule Archivist", description: "Discover 50 different rule cards.", target: 50, reward: 800, progress: discoveredRules },
    { id: "win_with_10_rules", name: "Adaptive Winner", description: "Win with 10 different rule cards.", target: 10, reward: 300, progress: uniqueRuleWins },
    { id: "instant_10", name: "Instant Gratification", description: "Use 10 instant rules.", target: 10, reward: 160, progress: (u) => rulesUsedByKind(u, "instant") },
    { id: "delayed_10", name: "Fuse Lighter", description: "Use 10 delayed rules.", target: 10, reward: 160, progress: (u) => rulesUsedByKind(u, "delayed") },
    { id: "duration_10", name: "Long-Term Planner", description: "Use 10 duration rules.", target: 10, reward: 160, progress: (u) => rulesUsedByKind(u, "duration") },
    { id: "pot_greed_3", name: "Greed Is Good", description: "Use Pot of Greed 3 times.", target: 3, reward: 130, progress: (u) => ruleUseCount(u, "inst_pot_of_greed") },
    { id: "supermarket_3", name: "Loyal Customer", description: "Use Supermarket 3 times.", target: 3, reward: 130, progress: (u) => ruleUseCount(u, "dur_supermarket_10") },
    { id: "ads_3", name: "Ad Blocker Needed", description: "Use Ads 3 times.", target: 3, reward: 130, progress: (u) => ruleUseCount(u, "dur_ads_7") },
    { id: "rps_wins_3", name: "Rock Paper Tyrant", description: "Win 3 games where you used RPS Duel.", target: 3, reward: 180, progress: (u) => ruleWinCount(u, "inst_rps_duel") },
    { id: "lava_wins_3", name: "Lava Landlord", description: "Win 3 games where you used Lava Fields.", target: 3, reward: 180, progress: (u) => ruleWinCount(u, "del_lava_random_6") },
    { id: "black_hole_wins_3", name: "Event Horizon", description: "Win 3 games where you used Black Hole.", target: 3, reward: 200, progress: (u) => ruleWinCount(u, "del_black_hole_6") },
    { id: "orbital_wins_3", name: "Orbital Authority", description: "Win 3 games where you used Orbital Strike.", target: 3, reward: 220, progress: (u) => ruleWinCount(u, "del_orbital_strike_10") },
    { id: "double_tempo_wins_3", name: "Tempo Baron", description: "Win 3 games where you used Double Tempo.", target: 3, reward: 180, progress: (u) => ruleWinCount(u, "dur_move_twice_4") },
    { id: "titan_wins_3", name: "Titan Pilot", description: "Win 3 games where you used Titan.", target: 3, reward: 180, progress: (u) => ruleWinCount(u, "inst_titan") },
    { id: "first_shop_purchase", name: "Cosmetic Shopper", description: "Spend coins in the shop.", target: 1, reward: 60, progress: (u) => (u.stats.coinsSpent > 0 ? 1 : 0) },
    { id: "spender_500", name: "Drip Budget", description: "Spend 500 coins in the shop.", target: 500, reward: 120, progress: (u) => u.stats.coinsSpent },
    { id: "earner_1000", name: "Coin Magnet", description: "Earn 1000 coins.", target: 1000, reward: 250, progress: (u) => u.stats.coinsEarned },
  ];
  
  function ruleAchievementDefs() {
    return allRules().map((rule) => ({
      id: `rule_used_${rule.id}`,
      name: `Played: ${rule.name}`,
      description: `Pick ${rule.name} in a match.`,
      target: 1,
      reward: rule.kind === "delayed" ? 35 : rule.kind === "duration" ? 35 : 25,
      progress: (user) => ruleUseCount(user, rule.id),
    }));
  }
  
  function buildAchievementsForUser(user, { award = false } = {}) {
    hydrateUser(user);
    let awardedCoins = 0;
    const defs = [...ACHIEVEMENT_DEFS, ...ruleAchievementDefs()];
    const achievements = defs.map((def) => {
      const rawProgress = Math.max(0, Number(def.progress(user)) || 0);
      const target = Math.max(1, Number(def.target) || 1);
      const unlocked = rawProgress >= target;
      const claimed = !!user.achievementRewards[def.id];
      if (award && unlocked && !claimed) {
        const reward = Math.max(0, Number(def.reward) || 0);
        user.stats.coins += reward;
        user.stats.coinsEarned += reward;
        user.achievementRewards[def.id] = { reward, awardedAt: new Date().toISOString() };
        awardedCoins += reward;
      }
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        progress: Math.min(target, rawProgress),
        target,
        reward: Math.max(0, Number(def.reward) || 0),
        unlocked,
        claimed: unlocked && !!user.achievementRewards[def.id],
      };
    });
    return { achievements, awardedCoins };
  }

  return {
    achievementsForUser,
    buildAchievementsForUser,
  };
}

module.exports = { createAchievementService };
