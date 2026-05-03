const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const { createLobbyCode, createRoom, getRoom, joinRoom, leaveRoom } = require("./src/server/lobby");
const { Game } = require("./src/server/game/Game");
const { allRules, getRuleById } = require("./src/server/game/rules/ruleset");
const {
  applyMoveNoValidation,
  generateLegalMoves,
  idxToFile,
  idxToRank,
  isInCheck,
  other,
  pieceValue,
} = require("./src/server/game/ChessEngine");

function readBoolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

// DEBUG MODE: enables debug-only UI/behaviour (e.g. player named "DEBUG" sees all rules at rule choice).
const DEFAULT_DEBUG_MODE = readBoolEnv("DEBUG_MODE", true);
const runtimeFlags = {
  debugMode: DEFAULT_DEBUG_MODE,
};

const app = express();
app.use(express.json({ limit: "32kb" }));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "env"));

const DATA_DIR = path.join(__dirname, "data");
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

const COSMETIC_CATALOG = {
  avatars: [
    { name: "CC", label: "Classic CC", price: 0 },
    { name: "K", label: "King Sigil", price: 225 },
    { name: "Q", label: "Queen Mark", price: 225 },
    { name: "CH", label: "Chaos Crest", price: 420 },
    { name: "!!", label: "Rule Breaker", price: 540 },
    { name: "GM", label: "Grand Anarchist", price: 840 },
    { name: "RX", label: "Rook X", price: 620 },
    { name: "ZZ", label: "Zigzag", price: 700 },
    { name: "NO", label: "Knight Orbit", price: 760 },
    { name: "8B", label: "Eight Bit", price: 820 },
    { name: "VP", label: "Void Prince", price: 940 },
  ],
  borders: [
    { name: "None", label: "None", price: 0 },
    { name: "Neon", label: "Neon", price: 360 },
    { name: "Lava Pulse", label: "Lava Pulse", price: 540 },
    { name: "Royal Gold", label: "Royal Gold", price: 660 },
    { name: "Glitch", label: "Glitch", price: 780 },
    { name: "Anarchist", label: "Anarchist", price: 1080 },
    { name: "Circuit", label: "Circuit", price: 900 },
    { name: "Frost", label: "Frost", price: 960 },
    { name: "Candy Stripe", label: "Candy Stripe", price: 1020 },
    { name: "Void Rift", label: "Void Rift", price: 1180 },
    { name: "Emerald", label: "Emerald", price: 1260 },
  ],
  boardSkins: [
    { name: "Classic Chaos", label: "Classic Chaos", price: 0 },
    { name: "Lava Board", label: "Lava Board", price: 1400 },
    { name: "Midnight", label: "Midnight", price: 1650 },
    { name: "Candy Clash", label: "Candy Clash", price: 2000 },
    { name: "Arcade Grid", label: "Arcade Grid", price: 2260 },
    { name: "Royal Marble", label: "Royal Marble", price: 2500 },
    { name: "Forest Tactics", label: "Forest Tactics", price: 2100 },
    { name: "Frosted Glass", label: "Frosted Glass", price: 2380 },
    { name: "Desert Mirage", label: "Desert Mirage", price: 2440 },
    { name: "Cyber Circuit", label: "Cyber Circuit", price: 2680 },
    { name: "Monochrome", label: "Monochrome", price: 2820 },
  ],
  pieceSkins: [
    { name: "Standard", label: "Standard", price: 0 },
    { name: "Royal Glass", label: "Royal Glass", price: 1100 },
    { name: "Neon Plastic", label: "Neon Plastic", price: 1240 },
    { name: "Lava Stone", label: "Lava Stone", price: 1550 },
    { name: "Toy Army", label: "Toy Army", price: 1720 },
    { name: "Void Metal", label: "Void Metal", price: 2000 },
    { name: "Crystal Set", label: "Crystal Set", price: 1820 },
    { name: "Brass Engines", label: "Brass Engines", price: 1940 },
    { name: "Candy Pieces", label: "Candy Pieces", price: 2060 },
    { name: "Shadow Ink", label: "Shadow Ink", price: 2180 },
    { name: "Hologram", label: "Hologram", price: 2360 },
  ],
  emotes: [
    { name: "Good game", label: "Good game", price: 0 },
    { name: "Calculated", label: "Calculated", price: 240 },
    { name: "Oops", label: "Oops", price: 240 },
    { name: "Rule diff", label: "Rule diff", price: 360 },
    { name: "My queen was bait", label: "My queen was bait", price: 420 },
    { name: "Chaos approved", label: "Chaos approved", price: 540 },
    { name: "Your move", label: "Your move", price: 420 },
    { name: "Brilliant chaos", label: "Brilliant chaos", price: 520 },
    { name: "Not like this", label: "Not like this", price: 560 },
    { name: "Try that again", label: "Try that again", price: 620 },
    { name: "Check the rules", label: "Check the rules", price: 700 },
  ],
  banners: [
    { name: "Sunset Clash", label: "Sunset Clash", price: 0 },
    { name: "Rule Storm", label: "Rule Storm", price: 480 },
    { name: "Gold Table", label: "Gold Table", price: 660 },
    { name: "Lava Lounge", label: "Lava Lounge", price: 720 },
    { name: "Neon Boardwalk", label: "Neon Boardwalk", price: 780 },
    { name: "Grand Arena", label: "Grand Arena", price: 1020 },
    { name: "Aurora Field", label: "Aurora Field", price: 880 },
    { name: "Storm Front", label: "Storm Front", price: 940 },
    { name: "Crystal Hall", label: "Crystal Hall", price: 1040 },
    { name: "Verdant Crown", label: "Verdant Crown", price: 1120 },
    { name: "Void Horizon", label: "Void Horizon", price: 1280 },
  ],
  cardBacks: [
    { name: "Classic Cards", label: "Classic Cards", price: 0 },
    { name: "Lava Cards", label: "Lava Cards", price: 1000 },
    { name: "Gold Foil", label: "Gold Foil", price: 1200 },
    { name: "Static Noise", label: "Static Noise", price: 1450 },
    { name: "Nebula", label: "Nebula", price: 1320 },
    { name: "Circuit Board", label: "Circuit Board", price: 1380 },
    { name: "Frosted", label: "Frosted", price: 1500 },
    { name: "Candy Pop", label: "Candy Pop", price: 1560 },
    { name: "Emerald Felt", label: "Emerald Felt", price: 1680 },
  ],
};

const COSMETIC_PROFILE_FIELDS = {
  avatars: "avatar",
  borders: "border",
  boardSkins: "boardSkin",
  pieceSkins: "pieceSkin",
  emotes: "emote",
  banners: "banner",
  cardBacks: "cardBack",
};

function normalizeUsername(username) {
  return String(username || "").trim().replace(/\s+/g, " ").slice(0, 16);
}

function usernameKey(username) {
  return normalizeUsername(username).toLowerCase();
}

const ADMIN_MIN_COIN_BALANCE = 1_000_000_000;

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
  if (!user || typeof rooms === "undefined") return;
  const changedRooms = [];
  for (const entry of rooms.values()) {
    const changedPlayers = [];
    for (const p of entry.room.players || []) {
      if (p.userId !== user.id) continue;
      p.name = user.username;
      p.profile = publicPlayerProfile(user);
      changedPlayers.push(p.id);
    }
    if (!changedPlayers.length || !entry.room.game?.players) continue;
    for (const gp of entry.room.game.players) {
      if (!changedPlayers.includes(gp.id)) continue;
      gp.name = user.username;
      gp.profile = publicPlayerProfile(user);
    }
    if (entry.room?.code) changedRooms.push(entry.room.code);
  }
  for (const code of changedRooms) pushEffectsAndState(code);
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
const io = new Server(server, {
  pingInterval: 25_000,
  pingTimeout: 60_000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60_000,
    skipMiddlewares: true,
  },
});

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
  for (let from = 0; from < game.state.board.length; from++) {
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
  for (let sq = 0; sq < board.length; sq++) {
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
  const size = Math.max(8, Math.round(Math.sqrt(board.length || 64)));
  const center = (size - 1) / 2;
  for (let sq = 0; sq < board.length; sq++) {
    const p = board[sq];
    if (!p || p.color === "x") continue;
    const sign = p.color === color ? 1 : -1;
    const file = sq % size;
    const rank = Math.floor(sq / size);
    const centerDist = Math.abs(file - center) + Math.abs(rank - center);
    score += sign * (18 - centerDist * 4);
    if (p.type === "p") {
      const progress = p.color === "w" ? rank : size - 1 - rank;
      score += sign * progress * 8;
    }
    if ((p.type === "n" || p.type === "b") && ((p.color === "w" && rank > 0) || (p.color === "b" && rank < 7))) {
      score += sign * 12;
    }
    if (p.type === "k") {
      const homeRank = p.color === "w" ? Math.floor((size - 8) / 2) : Math.floor((size - 8) / 2) + 7;
      const earlyShelter = rank === homeRank && (file === 6 || file === 2) ? 18 : 0;
      score += sign * earlyShelter;
    }
    if (p.color === color && p.type === "p") score += (rank - center) * forward;
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
  const size = Math.max(8, Number(before.boardSize || Math.round(Math.sqrt(before.board.length || 64))));
  const toRank = Math.floor(move.to / size);
  if (piece?.type === "p" && (toRank === 0 || toRank === size - 1)) score += 750;
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

  const fromFile = move.from % size;
  const fromRank = Math.floor(move.from / size);
  const toFile = move.to % size;
  const centerRank = Math.floor(move.to / size);
  const center = (size - 1) / 2;
  const centerGain = Math.abs(fromFile - center) + Math.abs(fromRank - center) - (Math.abs(toFile - center) + Math.abs(centerRank - center));
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
  } else if (game.phase === "mutantFusion") {
    if (game.mutantFusion?.playerId === bot.id) {
      const color = game.playerColor(bot.id);
      const pieces = [];
      for (let sq = 0; sq < 64; sq++) {
        const p = game.state.board[sq];
        if (p && p.color === color && p.color !== "x" && p.type !== "k") pieces.push(sq);
      }
      if (!pieces.length) {
        for (let sq = 0; sq < 64; sq++) {
          const p = game.state.board[sq];
          if (p && p.color === color && p.color !== "x") pieces.push(sq);
        }
      }
      const chosen = pieces.length ? [randItem(pieces)] : [];
      const selectedOk = game.setMutantSelection(bot.id, chosen);
      const confirmedOk = selectedOk.ok ? game.confirmMutantFusion(bot.id) : selectedOk;
      changed = !!confirmedOk.ok;
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
  else if (["wager", "rps", "ruleChoice", "bonusRuleChoice", "targetRule", "mutantFusion", "pawnSoldierShot", "supermarket"].includes(game.phase)) scheduleBotTurn(roomCode);
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

function userById(userId) {
  return Object.values(userStore.users).find((u) => u.id === userId) || null;
}

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
    const delta = ratingDelta(beforeRating, opponentRating, score, opponentUser ? 24 : 16);
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
    user.stats.rating = Math.max(100, beforeRating + delta);
    user.stats.peakRating = Math.max(user.stats.peakRating || 1000, user.stats.rating);

    updateRuleCollection(user, game.matchStats?.ruleUses?.[color], won);
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
    changedUsers.add(user.id);
  }

  if (changedUsers.size) saveUsers(userStore);
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

  socket.on("lobby:singleplayer", ({ authToken } = {}, cb) => {
    const account = accountFromPayload({ authToken });
    if (!account) return cb?.({ ok: false, error: "Sign in before starting singleplayer." });
    const code = createLobbyCode((c) => rooms.has(c));
    const room = createRoom(code, { visibility: "private" });
    room.game = new Game({ roomCode: code, debugMode: runtimeFlags.debugMode });
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

  socket.on("game:mutantSelection", ({ code, playerId, squares } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.setMutantSelection(pid, squares);
    if (!res.ok) return cb?.(res);
    cb?.({ ok: true });
    pushEffectsAndState(code);
  });

  socket.on("game:mutantConfirm", ({ code, playerId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const game = entry.room.game;
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const res = game.confirmMutantFusion(pid);
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

  socket.on("game:emote", ({ code, playerId } = {}, cb) => {
    const entry = rooms.get(code);
    if (!entry) return cb?.({ ok: false, error: "Lobby not found" });
    const pid = getOrRebindPlayerId({ code, room: entry.room, socket, playerId });
    if (!pid) return cb?.({ ok: false, error: "Not in this lobby" });
    touchPlayerSocket({ code, entry, playerId: pid, socket });
    const player = entry.room.players.find((p) => p.id === pid);
    const text = String(player?.profile?.emote || "Good game").slice(0, 40);
    emitToRoomAndPlayers(code, entry, "game:emote", { playerId: pid, name: player?.name || "Player", color: player?.color || null, text });
    cb?.({ ok: true });
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

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("uncaughtException", err);
});

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("unhandledRejection", reason);
});

const PORT = process.env.PORT || 3000;
async function start() {
  await initDatabaseStore();
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `Chess Variant server running on http://localhost:${PORT} using ${USE_DATABASE ? "Postgres" : "JSON"} account store`
    );
  });
}

start().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
