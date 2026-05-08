const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { createAchievementService } = require("./account/achievements");
const { COSMETIC_CATALOG, COSMETIC_PROFILE_FIELDS } = require("./account/cosmetics");
const { readBoolEnv } = require("./env");
const { allRules, getRuleById } = require("./game/rules/ruleset");

function createAccountService({ rootDir, runtimeFlags, onUserUpdated = () => {} } = {}) {
  const DATA_DIR = path.join(rootDir || process.cwd(), "data");
  const USERS_FILE = path.join(DATA_DIR, "users.json");
  const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.POSTGRES_URL || "";
  const USE_DATABASE = !!DATABASE_URL && !readBoolEnv("DISABLE_DATABASE", false);
  const db = USE_DATABASE
    ? new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      })
    : null;

  function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  function loadUsers() {
    ensureDataDir();
    try {
      const raw = fs.readFileSync(USERS_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.users || typeof parsed.users !== "object") return { users: {}, sessions: {} };
      if (!parsed.sessions || typeof parsed.sessions !== "object") parsed.sessions = {};
      return parsed;
    } catch (err) {
      if (err.code !== "ENOENT") console.error("Failed to load users.json", err);
      return { users: {}, sessions: {} };
    }
  }
  
  let userStore = { users: {}, sessions: {} };
  let userStoreWriteQueue = Promise.resolve();
  
  function saveUsers(store) {
    if (!USE_DATABASE) {
      ensureDataDir();
      fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2));
      return;
    }
    const snapshot = JSON.parse(JSON.stringify(store));
    userStoreWriteQueue = userStoreWriteQueue
      .then(() => persistStoreSnapshot(snapshot))
      .catch((err) => {
        console.error("persistStoreSnapshot failed", err);
      });
  }
  
  async function flushUserStoreWrites() {
    await userStoreWriteQueue;
  }
  
  async function persistStoreSnapshot(store) {
    if (!USE_DATABASE) return;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM app_sessions");
      await client.query("DELETE FROM app_users");
      for (const user of Object.values(store.users || {})) {
        await client.query(
          `INSERT INTO app_users (user_id, username_key, payload, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, COALESCE(($3::jsonb->>'createdAt')::timestamptz, NOW()), NOW())`,
          [user.id, user.usernameKey, JSON.stringify(user)]
        );
      }
      for (const [token, session] of Object.entries(store.sessions || {})) {
        await client.query(
          `INSERT INTO app_sessions (session_token, user_id, payload, created_at)
           VALUES ($1, $2, $3::jsonb, COALESCE(($3::jsonb->>'createdAt')::bigint, EXTRACT(EPOCH FROM NOW()) * 1000)::bigint)`,
          [token, session.userId, JSON.stringify(session)]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  
  async function initDatabaseStore() {
    if (!USE_DATABASE) {
      userStore = loadUsers();
      return;
    }
  
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        user_id uuid PRIMARY KEY,
        username_key text UNIQUE NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_sessions (
        session_token text PRIMARY KEY,
        user_id uuid NOT NULL,
        payload jsonb NOT NULL,
        created_at bigint NOT NULL
      )
    `);
  
    const usersRes = await db.query("SELECT payload FROM app_users");
    const sessionsRes = await db.query("SELECT session_token, payload FROM app_sessions");
    const users = {};
    for (const row of usersRes.rows) {
      const user = row.payload;
      if (user?.usernameKey) users[user.usernameKey] = user;
    }
    const sessions = {};
    for (const row of sessionsRes.rows) {
      sessions[row.session_token] = row.payload;
    }
  
    if (!Object.keys(users).length && fs.existsSync(USERS_FILE)) {
      userStore = loadUsers();
      await persistStoreSnapshot(userStore);
      return;
    }
  
    userStore = { users, sessions };
  }
  
  function normalizeUsername(username) {
    return String(username || "").trim().replace(/\s+/g, " ").slice(0, 16);
  }
  
  function usernameKey(username) {
    return normalizeUsername(username).toLowerCase();
  }
  
  const ADMIN_MIN_COIN_BALANCE = 1_000_000_000;
  const CAMPAIGN_CONFIG = {
    totalLevels: 100,
    levelsPerWorld: 10,
    chestEvery: 3,
    basicRuleIds: [
      "inst_oops_explosion",
      "inst_pawn_herding",
      "inst_rps_duel",
      "inst_swap_queens",
      "inst_coinflip_wager",
    ],
    excludedFromCampaignPool: [],
  };
  
  function userById(userId) {
    if (!userId) return null;
    return Object.values(userStore.users || {}).find((u) => u?.id === userId) || null;
  }
  
  function defaultStats() {
    return {
      gamesStarted: 0,
      gamesPlayed: 0,
      gamesCompleted: 0,
      singleplayerGames: 0,
      multiplayerGames: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      coins: 0,
      coinsEarned: 0,
      coinsSpent: 0,
      rating: 1000,
      peakRating: 1000,
      currentWinstreak: 0,
      highestWinstreak: 0,
      checkmatesDelivered: 0,
      capturesMade: 0,
      totalGamePlies: 0,
      completedGameLengths: 0,
      rulesSurvived: 0,
      extraMovesEarned: 0,
      kingsExploded: 0,
      queensSacrificed: 0,
      pawnsPromoted: 0,
      lavaDeaths: 0,
      whiteGames: 0,
      whiteWins: 0,
      blackGames: 0,
      blackWins: 0,
      fastCheckmates: 0,
    };
  }
  
  function defaultProfile(username = "Player") {
    const customAvatar = normalizeUsername(username).slice(0, 2).toUpperCase() || "CC";
    return {
      avatar: customAvatar,
      customAvatar,
      banner: "Sunset Clash",
      country: "",
      bio: "",
      onlineStatus: "Online",
      boardSkin: "Classic Chaos",
      pieceSkin: "Standard",
      border: "None",
      emote: "Good game",
      cardBack: "Classic Cards",
    };
  }
  
  function hydrateUser(user) {
    if (!user) return null;
    if (!user.usernameKey) user.usernameKey = usernameKey(user.username);
    user.isAdmin = !!user.isAdmin;
    user.stats = { ...defaultStats(), ...(user.stats || {}) };
    if (!user.stats.gamesPlayed && user.stats.gamesStarted) user.stats.gamesPlayed = user.stats.gamesStarted;
    if (!user.stats.rating) user.stats.rating = 1000;
    if (!user.stats.peakRating) user.stats.peakRating = user.stats.rating;
    if (user.isAdmin) {
      user.stats.coins = Math.max(Number(user.stats.coins || 0), ADMIN_MIN_COIN_BALANCE);
    }
    user.profile = { ...defaultProfile(user.username), ...(user.profile || {}) };
    const avatarCatalog = new Set((COSMETIC_CATALOG.avatars || []).map((item) => item.name));
    if (!user.profile.customAvatar) {
      user.profile.customAvatar = avatarCatalog.has(user.profile.avatar)
        ? (normalizeUsername(user.username).slice(0, 2).toUpperCase() || "CC")
        : (user.profile.avatar || normalizeUsername(user.username).slice(0, 2).toUpperCase() || "CC");
    }
    user.matchHistory = Array.isArray(user.matchHistory) ? user.matchHistory : [];
    user.ruleCollection = user.ruleCollection && typeof user.ruleCollection === "object" ? user.ruleCollection : {};
    user.achievementRewards = user.achievementRewards && typeof user.achievementRewards === "object" ? user.achievementRewards : {};
    user.cosmetics = user.cosmetics && typeof user.cosmetics === "object" ? user.cosmetics : {};
    for (const [group, items] of Object.entries(COSMETIC_CATALOG)) {
      const freeItems = items.filter((item) => item.price <= 0).map((item) => item.name);
      const existing = Array.isArray(user.cosmetics[group]) ? user.cosmetics[group] : [];
      const selected = user.profile?.[COSMETIC_PROFILE_FIELDS[group]];
      user.cosmetics[group] = [...new Set([...freeItems, ...existing, selected].filter(Boolean))];
    }
    user.social = user.social && typeof user.social === "object" ? user.social : {};
    user.social.friends = Array.isArray(user.social.friends) ? user.social.friends : [];
    user.social.rivals = Array.isArray(user.social.rivals) ? user.social.rivals : [];
    user.social.clubs = Array.isArray(user.social.clubs) ? user.social.clubs : [];
    user.campaign = normalizeCampaignProgress(user.campaign, buildCampaignRulePlan());
    return user;
  }
  
  function tierForRating(rating) {
    if (rating >= 2200) return { name: "Grand Anarchist", floor: 2200, next: null };
    if (rating >= 1800) return { name: "Chaos Master", floor: 1800, next: 2200 };
    if (rating >= 1400) return { name: "Gold", floor: 1400, next: 1800 };
    if (rating >= 1100) return { name: "Silver", floor: 1100, next: 1400 };
    return { name: "Bronze", floor: 0, next: 1100 };
  }
  
  function ruleName(ruleId) {
    return getRuleById(ruleId)?.name || ruleId;
  }
  
  function uniqueStrings(arr) {
    return [...new Set((Array.isArray(arr) ? arr : []).filter((id) => typeof id === "string"))];
  }
  
  function uniqueNumbers(arr, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
    return [
      ...new Set(
        (Array.isArray(arr) ? arr : [])
          .map((value) => Number(value))
          .filter((n) => Number.isFinite(n) && n >= min && n <= max)
      ),
    ];
  }
  
  function campaignChestMilestones() {
    const out = [];
    for (let level = CAMPAIGN_CONFIG.chestEvery; level < CAMPAIGN_CONFIG.totalLevels; level += CAMPAIGN_CONFIG.chestEvery) {
      out.push(level);
    }
    return out;
  }
  
  function buildCampaignRulePlan(ruleCatalog = allRules()) {
    const allRuleIds = uniqueStrings((ruleCatalog || []).map((rule) => rule.id));
    const fallbackBasics = allRuleIds.slice(0, Math.min(6, allRuleIds.length));
    const startingRuleIds = uniqueStrings(CAMPAIGN_CONFIG.basicRuleIds).filter((id) => allRuleIds.includes(id));
    const basicRules = startingRuleIds.length ? startingRuleIds : fallbackBasics;
    const excluded = new Set(uniqueStrings(CAMPAIGN_CONFIG.excludedFromCampaignPool));
    const unlockableRuleIds = allRuleIds.filter((id) => !basicRules.includes(id) && !excluded.has(id));
    const chestLevels = campaignChestMilestones();
    return { allRuleIds, basicRules, unlockableRuleIds, chestLevels };
  }
  
  function createDefaultCampaignProgress(plan = buildCampaignRulePlan()) {
    return {
      highestUnlockedLevel: 1,
      completedLevels: [],
      openedChests: [],
      unlockedRuleIds: uniqueStrings(plan.basicRules || []),
    };
  }
  
  function normalizeCampaignProgress(raw, plan = buildCampaignRulePlan()) {
    const parsed = raw && typeof raw === "object" ? raw : {};
    const completed = uniqueNumbers(parsed.completedLevels, { min: 1, max: CAMPAIGN_CONFIG.totalLevels });
    const openedChests = uniqueNumbers(parsed.openedChests, { min: 0, max: plan.chestLevels.length - 1 });
    const unlockedRuleIds = uniqueStrings(parsed.unlockedRuleIds).filter((id) => plan.allRuleIds.includes(id));
    const highestCompleted = completed.length ? Math.max(...completed) : 0;
    const highestUnlockedLevel = Math.max(
      1,
      Math.min(
        CAMPAIGN_CONFIG.totalLevels,
        Math.max(Number(parsed.highestUnlockedLevel) || 1, Math.min(CAMPAIGN_CONFIG.totalLevels, highestCompleted + 1))
      )
    );
    return {
      highestUnlockedLevel,
      completedLevels: completed,
      openedChests,
      unlockedRuleIds: uniqueStrings([...(plan.basicRules || []), ...unlockedRuleIds]),
    };
  }
  
  function ensureCampaignProgress(user, plan = buildCampaignRulePlan()) {
    hydrateUser(user);
    user.campaign = normalizeCampaignProgress(user.campaign, plan);
    return user.campaign;
  }
  
  function openCampaignChestForUser(user, chestIndex, plan = buildCampaignRulePlan()) {
    const campaign = ensureCampaignProgress(user, plan);
    const idx = Math.floor(Number(chestIndex));
    const chestLevel = plan.chestLevels[idx];
    if (!Number.isFinite(idx) || chestLevel == null) return { ok: false, error: "Chest not found." };
    if (campaign.highestUnlockedLevel <= chestLevel) return { ok: false, error: "Chest is still locked." };
    if (campaign.openedChests.includes(idx)) return { ok: true, campaign, rewards: [], alreadyOpened: true };
  
    const unlockedSet = new Set(campaign.unlockedRuleIds || []);
    const unopenedChestIndexes = plan.chestLevels.map((_, i) => i).filter((i) => i >= idx && !campaign.openedChests.includes(i));
    const remainingRules = plan.unlockableRuleIds.filter((id) => !unlockedSet.has(id));
    const remainingChestCount = unopenedChestIndexes.length || 1;
    const rewardCount = remainingRules.length ? Math.ceil(remainingRules.length / remainingChestCount) : 0;
    const rewards = remainingRules.slice(0, rewardCount);
    for (const ruleId of rewards) unlockedSet.add(ruleId);
    campaign.openedChests = uniqueNumbers([...campaign.openedChests, idx], { min: 0, max: plan.chestLevels.length - 1 });
    campaign.unlockedRuleIds = [...unlockedSet];
    user.campaign = normalizeCampaignProgress(campaign, plan);
    return { ok: true, campaign: user.campaign, rewards };
  }
  
  function completeCampaignLevelForUser(user, level, won) {
    const plan = buildCampaignRulePlan();
    const campaign = ensureCampaignProgress(user, plan);
    const normalizedLevel = Math.floor(Number(level));
    if (!won || !Number.isFinite(normalizedLevel) || normalizedLevel < 1 || normalizedLevel > CAMPAIGN_CONFIG.totalLevels) {
      return { ok: false, campaign };
    }
    campaign.completedLevels = uniqueNumbers([...campaign.completedLevels, normalizedLevel], { min: 1, max: CAMPAIGN_CONFIG.totalLevels });
    campaign.highestUnlockedLevel = Math.min(
      CAMPAIGN_CONFIG.totalLevels,
      Math.max(campaign.highestUnlockedLevel || 1, normalizedLevel + 1)
    );
    user.campaign = normalizeCampaignProgress(campaign, plan);
    const chestIndex = plan.chestLevels.indexOf(normalizedLevel);
    if (chestIndex >= 0) openCampaignChestForUser(user, chestIndex, plan);
    return { ok: true, campaign: user.campaign };
  }
  
  function favoriteRule(collection) {
    const entries = Object.entries(collection || {});
    entries.sort((a, b) => (b[1]?.used || 0) - (a[1]?.used || 0));
    if (!entries.length || !(entries[0][1]?.used > 0)) return null;
    return { id: entries[0][0], name: ruleName(entries[0][0]), used: entries[0][1].used || 0 };
  }
  
  function mostSuccessfulRule(collection) {
    const entries = Object.entries(collection || {})
      .filter(([, data]) => (data?.used || 0) > 0)
      .map(([id, data]) => ({ id, name: ruleName(id), used: data.used || 0, wins: data.wins || 0, winRate: (data.wins || 0) / Math.max(1, data.used || 0) }));
    entries.sort((a, b) => b.winRate - a.winRate || b.used - a.used);
    return entries[0] || null;
  }
  
  const { buildAchievementsForUser } = createAchievementService({ allRules, hydrateUser });

  function catalogItem(group, name) {
    return (COSMETIC_CATALOG[group] || []).find((item) => item.name === name) || null;
  }
  
  function localDayWindow(now = Date.now()) {
    const d = new Date(now);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { key, start, end };
  }
  
  function hashSeed(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  
  function seededRandom(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  
  function dailyShopOffers(user = null, now = Date.now()) {
    const window = localDayWindow(now);
    const candidates = [];
    for (const [group, items] of Object.entries(COSMETIC_CATALOG)) {
      for (const item of items) {
        if ((item.price || 0) <= 0) continue;
        candidates.push({ group, ...item });
      }
    }
  
    const random = seededRandom(hashSeed(`shop:${window.key}`));
    const shuffled = candidates
      .map((item) => ({ item, sort: random() }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, 5)
      .map(({ item }) => {
        const owned = user ? ownsCosmetic(user, item.group, item.name) : false;
        return {
          ...item,
          owned,
          affordable: !!user?.isAdmin || !!owned || (user?.stats?.coins || 0) >= item.price,
        };
      });
  
    return { key: window.key, resetAt: window.end, serverNow: now, offers: shuffled };
  }
  
  function isDailyShopOffer(group, name) {
    return dailyShopOffers(null).offers.some((item) => item.group === group && item.name === name);
  }
  
  function ownsCosmetic(user, group, name) {
    hydrateUser(user);
    return (user.cosmetics[group] || []).includes(name);
  }
  
  function cosmeticInventory(user) {
    const selected = user.profile || {};
    const out = {};
    for (const [group, items] of Object.entries(COSMETIC_CATALOG)) {
      const selectedName = selected[COSMETIC_PROFILE_FIELDS[group]];
      out[group] = items.map((item) => ({
        ...item,
        unlocked: ownsCosmetic(user, group, item.name),
        selected: selectedName === item.name,
        affordable: user.isAdmin || (user.stats?.coins || 0) >= item.price,
      }));
      if (selectedName && !out[group].some((item) => item.name === selectedName)) {
        out[group].unshift({ name: selectedName, label: `Custom (${selectedName})`, price: 0, unlocked: true, selected: true, affordable: true });
      }
    }
    return out;
  }
  
  function performanceInsights(user) {
    const s = user.stats || {};
    const whiteRate = s.whiteGames ? Math.round((s.whiteWins / s.whiteGames) * 100) : 0;
    const blackRate = s.blackGames ? Math.round((s.blackWins / s.blackGames) * 100) : 0;
    const bestRule = mostSuccessfulRule(user.ruleCollection);
    return {
      whiteWinRate: whiteRate,
      blackWinRate: blackRate,
      bestOpeningStyle: s.whiteGames >= s.blackGames ? "White-side pressure" : "Black-side counterplay",
      strongestTimeOfDay: "Not enough data",
      averageBlunderRate: "Not tracked yet",
      bestRuleWinRate: bestRule ? `${bestRule.name}: ${Math.round(bestRule.winRate * 100)}%` : "No rule wins yet",
    };
  }
  
  function publicPlayerProfile(user) {
    hydrateUser(user);
    const p = user?.profile || {};
    return {
      avatar: p.avatar || "CC",
      banner: p.banner || "Sunset Clash",
      boardSkin: p.boardSkin || "Classic Chaos",
      pieceSkin: p.pieceSkin || "Standard",
      border: p.border || "None",
      emote: p.emote || "Good game",
      cardBack: p.cardBack || "Classic Cards",
    };
  }
  
  function applyAccountToPlayer(player, account) {
    if (!player || !account) return;
    player.userId = account.id;
    player.name = account.username;
    player.profile = publicPlayerProfile(account);
  }
  
  function publicUser(user, { awardAchievements = true } = {}) {
    hydrateUser(user);
    if (!user) return null;
    const achievementState = buildAchievementsForUser(user, { award: awardAchievements });
    if (achievementState.awardedCoins > 0) saveUsers(userStore);
    const tier = tierForRating(user.stats.rating);
    const winRate = user.stats.gamesCompleted ? Math.round((user.stats.wins / user.stats.gamesCompleted) * 100) : 0;
    const averageGameLength = user.stats.completedGameLengths ? Math.round(user.stats.totalGamePlies / user.stats.completedGameLengths) : 0;
    const collection = Object.entries(user.ruleCollection || {})
      .map(([id, data]) => ({
        id,
        name: ruleName(id),
        used: data.used || 0,
        wins: data.wins || 0,
        survived: data.survived || 0,
        mastery: Math.min(5, Math.floor((data.used || 0) / 5) + 1),
        winRate: data.used ? Math.round(((data.wins || 0) / data.used) * 100) : 0,
        rare: (data.used || 0) >= 10,
      }))
      .sort((a, b) => b.used - a.used || a.name.localeCompare(b.name));
    return {
      id: user.id,
      username: user.username,
      isAdmin: !!user.isAdmin,
      createdAt: user.createdAt,
      profile: user.profile,
      stats: {
        ...user.stats,
        winRate,
        averageGameLength,
        favoriteRule: favoriteRule(user.ruleCollection),
        mostSuccessfulRule: mostSuccessfulRule(user.ruleCollection),
      },
      rank: {
        rating: user.stats.rating,
        peakRating: user.stats.peakRating,
        tier: tier.name,
        nextTierAt: tier.next,
        progress: tier.next ? Math.max(0, Math.min(100, Math.round(((user.stats.rating - tier.floor) / (tier.next - tier.floor)) * 100))) : 100,
        seasonalRank: tier.name,
      },
      matchHistory: user.matchHistory.slice(0, 20),
      ruleCollection: collection,
      campaign: user.campaign,
      achievements: achievementState.achievements,
      cosmetics: cosmeticInventory(user),
      social: user.social,
      insights: performanceInsights(user),
    };
  }
  
  function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return { salt, hash };
  }
  
  function verifyPassword(password, user) {
    if (!user?.salt || !user?.passwordHash) return false;
    const test = crypto.scryptSync(String(password), user.salt, 64);
    const saved = Buffer.from(user.passwordHash, "hex");
    return saved.length === test.length && crypto.timingSafeEqual(saved, test);
  }
  
  function createSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    userStore.sessions[token] = { userId, createdAt: Date.now() };
    saveUsers(userStore);
    return token;
  }
  
  function authTokenFromReq(req) {
    const header = String(req.headers.authorization || "");
    if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
    return "";
  }
  
  function accountFromToken(token) {
    const session = userStore.sessions[String(token || "")];
    if (!session) return null;
    return Object.values(userStore.users).find((u) => u.id === session.userId) || null;
  }
  
  function accountFromPayload(payload) {
    return accountFromToken(payload?.authToken);
  }
  
  function validateSignup(username, password) {
    const clean = normalizeUsername(username);
    if (clean.length < 2) return { ok: false, error: "Username must be at least 2 characters." };
    if (!/^[a-z0-9 _-]+$/i.test(clean)) return { ok: false, error: "Username can only use letters, numbers, spaces, _ and -." };
    if (String(password || "").length < 4) return { ok: false, error: "Password must be at least 4 characters." };
    return { ok: true, username: clean };
  }
  
  function recordGameStarted(user, mode) {
    hydrateUser(user);
    if (!user) return;
    user.stats = user.stats || {};
    user.stats.gamesStarted = (user.stats.gamesStarted || 0) + 1;
    user.stats.gamesPlayed = (user.stats.gamesPlayed || 0) + 1;
    if (mode === "singleplayer") user.stats.singleplayerGames = (user.stats.singleplayerGames || 0) + 1;
    else user.stats.multiplayerGames = (user.stats.multiplayerGames || 0) + 1;
    saveUsers(userStore);
  }
  
  function updateActivePlayerNames(user) {
    onUserUpdated?.(user);
  }
  
  function authedUser(req, res) {
    const user = accountFromToken(authTokenFromReq(req));
    if (!user) {
      res.status(401).json({ ok: false, error: "Not signed in." });
      return null;
    }
    return hydrateUser(user);
  }
  
  function adminUser(req, res) {
    const user = authedUser(req, res);
    if (!user) return null;
    if (!user.isAdmin) {
      res.status(403).json({ ok: false, error: "Admin only." });
      return null;
    }
    return user;
  }
  
  function sanitizeAdminUserPayload(user) {
    hydrateUser(user);
    const clone = JSON.parse(JSON.stringify(user));
    delete clone.salt;
    delete clone.passwordHash;
    return clone;
  }
  
  function setProfileCosmetic(user, group, value) {
    const field = COSMETIC_PROFILE_FIELDS[group];
    if (!field || typeof value !== "string") return { ok: true };
    const name = value.trim();
    if (!name) return { ok: true };
    if (group === "avatars" && name === "__custom_avatar__") {
      user.profile.avatar = user.profile.customAvatar || normalizeUsername(user.username).slice(0, 2).toUpperCase() || "CC";
      return { ok: true };
    }
    if (!ownsCosmetic(user, group, name)) return { ok: false, error: `You have not unlocked ${name}.` };
    user.profile[field] = name;
    return { ok: true };
  }
  
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

  function registerRoutes(app) {
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
    
    app.get("/api/users/:username/profile", (req, res) => {
      const key = usernameKey(req.params.username);
      const user = userStore.users[key];
      if (!user) return res.status(404).json({ ok: false, error: "Player not found." });
      const profile = publicUser(user, { awardAchievements: false });
      delete profile.isAdmin;
      delete profile.cosmetics;
      res.json({ ok: true, user: profile });
    });
    
    app.post("/api/auth/signup", async (req, res) => {
      const validation = validateSignup(req.body?.username, req.body?.password);
      if (!validation.ok) return res.status(400).json(validation);
      const key = usernameKey(validation.username);
      if (userStore.users[key]) return res.status(409).json({ ok: false, error: "Username is already taken." });
    
      const password = hashPassword(req.body.password);
      const user = {
        id: crypto.randomUUID(),
        username: validation.username,
        usernameKey: key,
        salt: password.salt,
        passwordHash: password.hash,
        createdAt: new Date().toISOString(),
        stats: defaultStats(),
        profile: defaultProfile(validation.username),
        matchHistory: [],
        ruleCollection: {},
        achievementRewards: {},
        cosmetics: {},
        social: { friends: [], rivals: [], clubs: [] },
        campaign: createDefaultCampaignProgress(buildCampaignRulePlan()),
      };
      userStore.users[key] = user;
      saveUsers(userStore);
      await flushUserStoreWrites();
    
      const token = createSession(user.id);
      await flushUserStoreWrites();
      res.json({ ok: true, token, user: publicUser(user) });
    });
    
    app.post("/api/auth/login", async (req, res) => {
      const key = usernameKey(req.body?.username);
      const user = userStore.users[key];
      if (!user || !verifyPassword(req.body?.password || "", user)) {
        return res.status(401).json({ ok: false, error: "Username or password is wrong." });
      }
      const token = createSession(user.id);
      await flushUserStoreWrites();
      res.json({ ok: true, token, user: publicUser(user) });
    });
    
    app.post("/api/auth/logout", async (req, res) => {
      const token = authTokenFromReq(req) || req.body?.token;
      if (token && userStore.sessions[token]) {
        delete userStore.sessions[token];
        saveUsers(userStore);
        await flushUserStoreWrites();
      }
      res.json({ ok: true });
    });
    
    app.get("/api/me", (req, res) => {
      const user = accountFromToken(authTokenFromReq(req));
      if (!user) return res.status(401).json({ ok: false, error: "Not signed in." });
      res.json({ ok: true, user: publicUser(user) });
    });
    
    app.patch("/api/me", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const body = req.body || {};
    
      if (typeof body.username === "string") {
        const validation = validateSignup(body.username, "0000");
        if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error.replace("Password must be at least 4 characters.", "Invalid username.") });
        const nextKey = usernameKey(validation.username);
        if (nextKey !== user.usernameKey && userStore.users[nextKey]) return res.status(409).json({ ok: false, error: "Username is already taken." });
        if (nextKey !== user.usernameKey) {
          delete userStore.users[user.usernameKey];
          user.username = validation.username;
          user.usernameKey = nextKey;
          userStore.users[nextKey] = user;
          updateActivePlayerNames(user);
        }
      }
    
      const p = user.profile || (user.profile = defaultProfile(user.username));
      if (typeof body.customAvatar === "string") {
        p.customAvatar = body.customAvatar.trim().slice(0, 4) || normalizeUsername(user.username).slice(0, 2).toUpperCase() || "CC";
      }
      if (typeof body.country === "string") p.country = body.country.trim().slice(0, 32);
      if (typeof body.bio === "string") p.bio = body.bio.trim().slice(0, 160);
      for (const [group, field] of Object.entries(COSMETIC_PROFILE_FIELDS)) {
        if (typeof body[field] !== "string") continue;
        const result = setProfileCosmetic(user, group, body[field]);
        if (!result.ok) return res.status(400).json(result);
      }
      updateActivePlayerNames(user);
    
      saveUsers(userStore);
      await flushUserStoreWrites();
      res.json({ ok: true, user: publicUser(user) });
    });
    
    app.get("/api/me/campaign", (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      res.json({ ok: true, campaign: ensureCampaignProgress(user), user: publicUser(user) });
    });
    
    app.patch("/api/me/campaign", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const action = String(req.body?.action || "");
      const plan = buildCampaignRulePlan();
    
      if (action === "reset") {
        user.campaign = createDefaultCampaignProgress(plan);
        saveUsers(userStore);
        await flushUserStoreWrites();
        return res.json({ ok: true, campaign: user.campaign, user: publicUser(user) });
      }
    
      if (action === "openChest") {
        const result = openCampaignChestForUser(user, req.body?.chestIndex, plan);
        if (!result.ok) return res.status(400).json(result);
        saveUsers(userStore);
        await flushUserStoreWrites();
        return res.json({ ok: true, campaign: result.campaign, rewards: result.rewards || [], user: publicUser(user) });
      }
    
      res.status(400).json({ ok: false, error: "Unknown campaign action." });
    });
    
    app.get("/api/shop/daily", (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      res.json({ ok: true, shop: dailyShopOffers(user) });
    });
    
    app.post("/api/me/shop/buy", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const group = String(req.body?.group || "");
      const name = String(req.body?.name || "");
      const item = catalogItem(group, name);
      if (!item) return res.status(404).json({ ok: false, error: "Shop item not found." });
      if (ownsCosmetic(user, group, name)) return res.json({ ok: true, user: publicUser(user), alreadyOwned: true });
      if ((item.price || 0) > 0 && !isDailyShopOffer(group, name)) {
        return res.status(400).json({ ok: false, error: "That item is not in today's shop." });
      }
      if (!user.isAdmin) {
        if ((user.stats.coins || 0) < item.price) return res.status(400).json({ ok: false, error: "Not enough coins." });
        user.stats.coins -= item.price;
        user.stats.coinsSpent += item.price;
      }
      user.cosmetics[group] = [...new Set([...(user.cosmetics[group] || []), name])];
      saveUsers(userStore);
      await flushUserStoreWrites();
      res.json({ ok: true, user: publicUser(user), bought: { group, name, price: item.price } });
    });
    
    app.patch("/api/me/password", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const currentPassword = req.body?.currentPassword || "";
      const nextPassword = req.body?.nextPassword || "";
      if (!verifyPassword(currentPassword, user)) return res.status(403).json({ ok: false, error: "Current password is wrong." });
      if (String(nextPassword).length < 4) return res.status(400).json({ ok: false, error: "New password must be at least 4 characters." });
      const next = hashPassword(nextPassword);
      user.salt = next.salt;
      user.passwordHash = next.hash;
      saveUsers(userStore);
      await flushUserStoreWrites();
      res.json({ ok: true });
    });
    
    app.post("/api/me/friends", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const friendName = normalizeUsername(req.body?.username);
      if (!friendName) return res.status(400).json({ ok: false, error: "Enter a username." });
      if (usernameKey(friendName) === user.usernameKey) return res.status(400).json({ ok: false, error: "You cannot add yourself." });
      const friend = userStore.users[usernameKey(friendName)];
      if (!friend) return res.status(404).json({ ok: false, error: "Player not found." });
      if (!user.social.friends.includes(friend.username)) user.social.friends.push(friend.username);
      saveUsers(userStore);
      await flushUserStoreWrites();
      res.json({ ok: true, user: publicUser(user) });
    });
    
    app.delete("/api/me", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      for (const [token, session] of Object.entries(userStore.sessions || {})) {
        if (session.userId === user.id) delete userStore.sessions[token];
      }
      delete userStore.users[user.usernameKey];
      saveUsers(userStore);
      await flushUserStoreWrites();
      res.json({ ok: true });
    });
    
    app.get("/api/admin/users", (req, res) => {
      const admin = adminUser(req, res);
      if (!admin) return;
      const users = Object.values(userStore.users || {}).map((u) => sanitizeAdminUserPayload(u));
      users.sort((a, b) => String(a.username || "").localeCompare(String(b.username || ""), undefined, { sensitivity: "base" }));
      res.json({ ok: true, users });
    });
    
    app.patch("/api/admin/users/:id", async (req, res) => {
      const admin = adminUser(req, res);
      if (!admin) return;
      const target = userById(req.params.id);
      if (!target) return res.status(404).json({ ok: false, error: "User not found." });
      hydrateUser(target);
    
      const incoming = req.body?.user;
      if (!incoming || typeof incoming !== "object") return res.status(400).json({ ok: false, error: "Missing user payload." });
    
      if (typeof incoming.username === "string") {
        const validation = validateSignup(incoming.username, "0000");
        if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error.replace("Password must be at least 4 characters.", "Invalid username.") });
        const nextKey = usernameKey(validation.username);
        if (nextKey !== target.usernameKey && userStore.users[nextKey] && userStore.users[nextKey].id !== target.id) {
          return res.status(409).json({ ok: false, error: "Username is already taken." });
        }
        if (nextKey !== target.usernameKey) {
          delete userStore.users[target.usernameKey];
          target.username = validation.username;
          target.usernameKey = nextKey;
          userStore.users[nextKey] = target;
          updateActivePlayerNames(target);
        }
      }
    
      if (incoming.isAdmin != null) target.isAdmin = !!incoming.isAdmin;
    
      if (incoming.stats && typeof incoming.stats === "object") {
        const allowed = Object.keys(defaultStats());
        let ratingUpdated = false;
        for (const k of allowed) {
          if (!(k in incoming.stats)) continue;
          const v = Number(incoming.stats[k]);
          if (!Number.isFinite(v)) continue;
          target.stats[k] = Math.max(0, Math.round(v));
          if (k === "rating") ratingUpdated = true;
        }
        if (ratingUpdated) {
          target.stats.peakRating = Math.max(target.stats.peakRating || 0, target.stats.rating);
        }
      }
    
      if (incoming.profile && typeof incoming.profile === "object") {
        const p = incoming.profile;
        if (typeof p.country === "string") target.profile.country = p.country.trim().slice(0, 32);
        if (typeof p.bio === "string") target.profile.bio = p.bio.trim().slice(0, 160);
        if (typeof p.onlineStatus === "string") target.profile.onlineStatus = p.onlineStatus.trim().slice(0, 32) || "Online";
        if (typeof p.customAvatar === "string") target.profile.customAvatar = p.customAvatar.trim().slice(0, 4) || target.profile.customAvatar;
        for (const [group, field] of Object.entries(COSMETIC_PROFILE_FIELDS)) {
          if (typeof p[field] !== "string") continue;
          const result = setProfileCosmetic(target, group, p[field]);
          if (!result.ok) return res.status(400).json(result);
        }
        updateActivePlayerNames(target);
      }
    
      if (incoming.cosmetics && typeof incoming.cosmetics === "object") {
        const next = {};
        for (const [group, items] of Object.entries(incoming.cosmetics)) {
          if (!COSMETIC_CATALOG[group]) continue;
          if (!Array.isArray(items)) continue;
          next[group] = [...new Set(items.map((x) => String(x)).filter(Boolean))].slice(0, 200);
        }
        target.cosmetics = { ...(target.cosmetics || {}), ...next };
      }
    
      if (incoming.social && typeof incoming.social === "object") {
        const social = incoming.social;
        if (Array.isArray(social.friends)) target.social.friends = [...new Set(social.friends.map((x) => normalizeUsername(x)).filter(Boolean))].slice(0, 200);
        if (Array.isArray(social.rivals)) target.social.rivals = [...new Set(social.rivals.map((x) => normalizeUsername(x)).filter(Boolean))].slice(0, 200);
        if (Array.isArray(social.clubs)) target.social.clubs = [...new Set(social.clubs.map((x) => String(x).trim().slice(0, 32)).filter(Boolean))].slice(0, 200);
      }
    
      if (Array.isArray(incoming.matchHistory)) {
        target.matchHistory = incoming.matchHistory.slice(0, 50);
      }
    
      if (incoming.ruleCollection && typeof incoming.ruleCollection === "object") {
        target.ruleCollection = incoming.ruleCollection;
      }
    
      hydrateUser(target);
      saveUsers(userStore);
      await flushUserStoreWrites();
      res.json({ ok: true, user: sanitizeAdminUserPayload(target) });
    });
    
    app.get("/api/admin/flags", (req, res) => {
      const admin = adminUser(req, res);
      if (!admin) return;
      res.json({ ok: true, flags: { ...runtimeFlags } });
    });
    
    app.patch("/api/admin/flags", (req, res) => {
      const admin = adminUser(req, res);
      if (!admin) return;
      if (typeof req.body?.debugMode === "boolean") runtimeFlags.debugMode = req.body.debugMode;
      res.json({ ok: true, flags: { ...runtimeFlags } });
    });
  }

  return {
    accountFromPayload,
    applyAccountToPlayer,
    completeCampaignLevelForUser,
    ensureCampaignProgress,
    flushUserStoreWrites,
    hydrateUser,
    initDatabaseStore,
    publicPlayerProfile,
    publicUser,
    recordGameStarted,
    registerRoutes,
    ruleName,
    saveUsers,
    uniqueStrings,
    userById,
    get userStore() {
      return userStore;
    },
    get useDatabase() {
      return USE_DATABASE;
    },
  };
}

module.exports = { createAccountService };
