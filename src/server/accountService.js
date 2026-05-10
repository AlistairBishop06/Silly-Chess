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
      if (!parsed || typeof parsed !== "object" || !parsed.users || typeof parsed.users !== "object") return { users: {}, sessions: {}, clubs: {} };
      if (!parsed.sessions || typeof parsed.sessions !== "object") parsed.sessions = {};
      if (!parsed.clubs || typeof parsed.clubs !== "object") parsed.clubs = {};
      return parsed;
    } catch (err) {
      if (err.code !== "ENOENT") console.error("Failed to load users.json", err);
      return { users: {}, sessions: {}, clubs: {} };
    }
  }
  
  let userStore = { users: {}, sessions: {}, clubs: {} };
  let userStoreWriteQueue = Promise.resolve();
  
  function saveUsers(store, options = {}) {
    if (!USE_DATABASE) {
      ensureDataDir();
      fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2));
      return;
    }
    const snapshot = JSON.parse(JSON.stringify(store));
    const writeOptions = JSON.parse(JSON.stringify(options || {}));
    userStoreWriteQueue = userStoreWriteQueue
      .then(() => persistStoreChanges(snapshot, writeOptions))
      .catch((err) => {
        console.error("persistStoreChanges failed", err);
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
      await client.query("DELETE FROM app_clubs");
      for (const club of Object.values(store.clubs || {})) {
        await client.query(
          `INSERT INTO app_clubs (club_id, slug, payload, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, COALESCE(($3::jsonb->>'createdAt')::timestamptz, NOW()), NOW())`,
          [club.id, club.slug, JSON.stringify(club)]
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

  function usersByIds(store, ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).filter(Boolean));
    if (!wanted.size) return [];
    return Object.values(store.users || {}).filter((user) => wanted.has(user?.id));
  }

  function sessionsByTokens(store, tokens) {
    return (Array.isArray(tokens) ? tokens : [])
      .filter((token) => token && store.sessions?.[token])
      .map((token) => [token, store.sessions[token]]);
  }

  async function persistStoreChanges(store, options = {}) {
    if (!USE_DATABASE) return;
    if (options.fullSnapshot) {
      await persistStoreSnapshot(store);
      return;
    }

    const users = usersByIds(store, options.userIds);
    const sessions = sessionsByTokens(store, options.sessionTokens);
    const deleteUserIds = (Array.isArray(options.deleteUserIds) ? options.deleteUserIds : []).filter(Boolean);
    const deleteSessionTokens = (Array.isArray(options.deleteSessionTokens) ? options.deleteSessionTokens : []).filter(Boolean);
    const clubs = (Array.isArray(options.clubIds) ? options.clubIds : [])
      .filter(Boolean)
      .map((id) => store.clubs?.[id])
      .filter(Boolean);
    const deleteClubIds = (Array.isArray(options.deleteClubIds) ? options.deleteClubIds : []).filter(Boolean);

    if (!users.length && !sessions.length && !clubs.length && !deleteUserIds.length && !deleteSessionTokens.length && !deleteClubIds.length) return;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      if (deleteSessionTokens.length) {
        await client.query("DELETE FROM app_sessions WHERE session_token = ANY($1::text[])", [deleteSessionTokens]);
      }
      if (deleteUserIds.length) {
        await client.query("DELETE FROM app_sessions WHERE user_id = ANY($1::uuid[])", [deleteUserIds]);
        await client.query("DELETE FROM app_users WHERE user_id = ANY($1::uuid[])", [deleteUserIds]);
      }
      if (deleteClubIds.length) {
        await client.query("DELETE FROM app_clubs WHERE club_id = ANY($1::text[])", [deleteClubIds]);
      }
      for (const user of users) {
        await client.query(
          `INSERT INTO app_users (user_id, username_key, payload, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, COALESCE(($3::jsonb->>'createdAt')::timestamptz, NOW()), NOW())
           ON CONFLICT (user_id) DO UPDATE
           SET username_key = EXCLUDED.username_key,
               payload = EXCLUDED.payload,
               updated_at = NOW()`,
          [user.id, user.usernameKey, JSON.stringify(user)]
        );
      }
      for (const [token, session] of sessions) {
        await client.query(
          `INSERT INTO app_sessions (session_token, user_id, payload, created_at)
           VALUES ($1, $2, $3::jsonb, COALESCE(($3::jsonb->>'createdAt')::bigint, EXTRACT(EPOCH FROM NOW()) * 1000)::bigint)
           ON CONFLICT (session_token) DO UPDATE
           SET user_id = EXCLUDED.user_id,
               payload = EXCLUDED.payload,
               created_at = EXCLUDED.created_at`,
          [token, session.userId, JSON.stringify(session)]
        );
      }
      for (const club of clubs) {
        await client.query(
          `INSERT INTO app_clubs (club_id, slug, payload, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, COALESCE(($3::jsonb->>'createdAt')::timestamptz, NOW()), NOW())
           ON CONFLICT (club_id) DO UPDATE
           SET slug = EXCLUDED.slug,
               payload = EXCLUDED.payload,
               updated_at = NOW()`,
          [club.id, club.slug, JSON.stringify(club)]
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

  async function loadDatabaseUserByUsernameKey(key) {
    if (!USE_DATABASE || !key) return null;
    const result = await db.query("SELECT payload FROM app_users WHERE username_key = $1 LIMIT 1", [key]);
    return result.rows[0]?.payload || null;
  }

  async function loadDatabaseUserById(userId) {
    if (!USE_DATABASE || !userId) return null;
    const result = await db.query("SELECT payload FROM app_users WHERE user_id = $1 LIMIT 1", [userId]);
    return result.rows[0]?.payload || null;
  }

  async function refreshDatabaseUserByUsernameKey(key) {
    const user = hydrateUser(await loadDatabaseUserByUsernameKey(key));
    if (!user) return null;
    if (user.usernameKey !== key && userStore.users[key]?.id === user.id) delete userStore.users[key];
    userStore.users[user.usernameKey] = user;
    return user;
  }

  async function refreshDatabaseUserById(userId) {
    const user = hydrateUser(await loadDatabaseUserById(userId));
    if (!user) return null;
    for (const [key, existing] of Object.entries(userStore.users || {})) {
      if (existing?.id === user.id && key !== user.usernameKey) delete userStore.users[key];
    }
    userStore.users[user.usernameKey] = user;
    return user;
  }

  async function refreshDatabaseUsers() {
    if (!USE_DATABASE) return;
    const usersRes = await db.query("SELECT payload FROM app_users");
    const users = {};
    for (const row of usersRes.rows) {
      const user = hydrateUser(row.payload);
      if (user?.usernameKey) users[user.usernameKey] = user;
    }
    userStore.users = users;
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
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_clubs (
        club_id text PRIMARY KEY,
        slug text UNIQUE NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);
  
    const usersRes = await db.query("SELECT payload FROM app_users");
    const sessionsRes = await db.query("SELECT session_token, payload FROM app_sessions");
    const clubsRes = await db.query("SELECT payload FROM app_clubs");
    const users = {};
    for (const row of usersRes.rows) {
      const user = row.payload;
      if (user?.usernameKey) users[user.usernameKey] = user;
    }
    const sessions = {};
    for (const row of sessionsRes.rows) {
      sessions[row.session_token] = row.payload;
    }
    const clubs = {};
    for (const row of clubsRes.rows) {
      const club = row.payload;
      if (club?.id) clubs[club.id] = club;
    }
  
    if (!Object.keys(users).length && fs.existsSync(USERS_FILE)) {
      userStore = loadUsers();
      await persistStoreSnapshot(userStore);
      return;
    }
  
    userStore = { users, sessions, clubs };
  }
  
  function normalizeUsername(username) {
    return String(username || "").trim().replace(/\s+/g, " ").slice(0, 16);
  }
  
  function usernameKey(username) {
    return normalizeUsername(username).toLowerCase();
  }

  function normalizeClubName(name) {
    return String(name || "").trim().replace(/\s+/g, " ").slice(0, 32);
  }

  function clubSlug(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  }
  
  const ADMIN_MIN_COIN_BALANCE = 1_000_000_000;
  const CLUB_CREATE_COST = 2000;
  const DEFAULT_AVATAR_STYLE = "thumbs";
  const AVATAR_STYLE_ALIASES = {
    adventurer: "adventurer",
    "adventurer-neutral": "adventurerNeutral",
    avataaars: "avataaars",
    "avataaars-neutral": "avataaarsNeutral",
    "big-ears": "bigEars",
    "big-ears-neutral": "bigEarsNeutral",
    "big-smile": "bigSmile",
    "bottts": "bottts",
    "bottts-neutral": "botttsNeutral",
    croodles: "croodles",
    "croodles-neutral": "croodlesNeutral",
    dylan: "dylan",
    "fun-emoji": "funEmoji",
    glass: "glass",
    icons: "icons",
    identicon: "identicon",
    initials: "initials",
    lorelei: "lorelei",
    "lorelei-neutral": "loreleiNeutral",
    micah: "micah",
    miniavs: "miniavs",
    notionists: "notionists",
    "notionists-neutral": "notionistsNeutral",
    "open-peeps": "openPeeps",
    personas: "personas",
    "pixel-art": "pixelArt",
    "pixel-art-neutral": "pixelArtNeutral",
    rings: "rings",
    shapes: "shapes",
    thumbs: "thumbs",
    "toon-head": "toonHead",
  };
  let dicebearModulesPromise = null;
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
      avatar: DEFAULT_AVATAR_STYLE,
      avatarSeed: "",
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
    if (!avatarCatalog.has(user.profile.avatar)) {
      if (user.profile.avatar) user.profile.customAvatar = String(user.profile.avatar).slice(0, 4);
      user.profile.avatar = DEFAULT_AVATAR_STYLE;
    }
    if (!user.profile.avatarDefaultMigratedToThumbs && ["lorelei", "pixel-art"].includes(user.profile.avatar)) {
      user.profile.avatar = DEFAULT_AVATAR_STYLE;
      user.profile.avatarDefaultMigratedToThumbs = true;
    }
    if (!user.profile.avatarSeed) {
      user.profile.avatarSeed = user.id ? `user:${user.id}` : `user:${user.usernameKey || usernameKey(user.username)}`;
    }
    if (!user.profile.customAvatar) {
      user.profile.customAvatar = normalizeUsername(user.username).slice(0, 2).toUpperCase() || "CC";
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
    user.social.notifications = Array.isArray(user.social.notifications) ? user.social.notifications : [];
    user.campaign = normalizeCampaignProgress(user.campaign, buildCampaignRulePlan());
    return user;
  }

  function hydrateClub(club) {
    if (!club) return null;
    club.id = String(club.id || crypto.randomUUID());
    club.name = normalizeClubName(club.name || "Club");
    club.slug = clubSlug(club.slug || club.name) || club.id;
    club.description = String(club.description || "").trim().slice(0, 180);
    club.ownerUserId = club.ownerUserId || null;
    club.ownerUsername = club.ownerUsername || "Unknown";
    club.createdAt = club.createdAt || new Date().toISOString();
    club.members = Array.isArray(club.members) ? club.members : [];
    club.joinRequests = Array.isArray(club.joinRequests) ? club.joinRequests : [];
    club.activity = Array.isArray(club.activity) ? club.activity : [];
    club.announcements = Array.isArray(club.announcements) ? club.announcements : [];
    club.settings = club.settings && typeof club.settings === "object" ? club.settings : {};
    club.settings.visibility = club.settings.visibility === "private" ? "private" : "public";
    club.settings.requestOnly = club.settings.requestOnly !== false;
    return club;
  }

  function clubById(clubId) {
    return hydrateClub(userStore.clubs?.[String(clubId || "")]);
  }

  function clubsForUser(userId) {
    return Object.values(userStore.clubs || {}).map(hydrateClub).filter((club) => club?.members.some((m) => m.userId === userId));
  }

  function clubRole(club, userId) {
    if (!club || !userId) return null;
    if (club.ownerUserId === userId) return "owner";
    return club.members.find((m) => m.userId === userId)?.role || null;
  }

  function canManageClub(club, userId) {
    const role = clubRole(club, userId);
    return role === "owner" || role === "admin";
  }

  function addClubActivity(club, text) {
    club.activity = [{ id: notificationId(), text, createdAt: Date.now() }, ...(club.activity || [])].slice(0, 40);
  }

  function publicClubCard(club, viewer = null) {
    hydrateClub(club);
    const role = viewer?.id ? clubRole(club, viewer.id) : null;
    return {
      id: club.id,
      name: club.name,
      slug: club.slug,
      description: club.description,
      ownerUsername: club.ownerUsername,
      createdAt: club.createdAt,
      memberCount: club.members.length,
      role,
      isMember: !!role,
      hasRequested: !!viewer?.id && club.joinRequests.some((r) => r.userId === viewer.id),
      settings: { ...club.settings },
    };
  }

  function publicClubDetail(club, viewer) {
    hydrateClub(club);
    const role = clubRole(club, viewer?.id);
    const canManage = canManageClub(club, viewer?.id);
    const usersByIdMap = new Map(Object.values(userStore.users || {}).map((u) => [u.id, hydrateUser(u)]));
    const members = club.members.map((member) => {
      const user = usersByIdMap.get(member.userId);
      return {
        userId: member.userId,
        username: user?.username || member.username || "Unknown",
        role: member.role || "member",
        joinedAt: member.joinedAt || club.createdAt,
        profile: user ? publicProfile(user) : null,
        stats: user ? { rating: user.stats?.rating || 1000, gamesPlayed: user.stats?.gamesPlayed || 0 } : { rating: 1000, gamesPlayed: 0 },
      };
    });
    return {
      ...publicClubCard(club, viewer),
      canManage,
      members,
      joinRequests: canManage ? club.joinRequests : [],
      activity: club.activity || [],
      announcements: club.announcements || [],
      stats: {
        totalMembers: members.length,
        totalGamesPlayed: members.reduce((sum, m) => sum + Number(m.stats?.gamesPlayed || 0), 0),
        topRated: members.slice().sort((a, b) => (b.stats?.rating || 0) - (a.stats?.rating || 0)).slice(0, 5),
      },
    };
  }

  function notificationId() {
    return `N${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
  }

  function publicNotifications(user) {
    hydrateUser(user);
    return (user.social.notifications || [])
      .filter((n) => n && typeof n === "object")
      .slice()
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 60)
      .map((n) => ({
        id: n.id,
        type: n.type,
        fromUserId: n.fromUserId || null,
        fromUsername: n.fromUsername || "Player",
        message: n.message || "",
        createdAt: n.createdAt || Date.now(),
      }));
  }

  function addNotification(user, notification) {
    hydrateUser(user);
    user.social.notifications = [
      {
        id: notification.id || notificationId(),
        createdAt: Date.now(),
        ...notification,
      },
      ...(user.social.notifications || []),
    ].slice(0, 80);
  }

  function removeNotification(user, notificationIdValue) {
    hydrateUser(user);
    const before = user.social.notifications.length;
    user.social.notifications = user.social.notifications.filter((n) => n?.id !== notificationIdValue);
    return user.social.notifications.length !== before;
  }

  function areFriends(a, b) {
    hydrateUser(a);
    hydrateUser(b);
    return (a.social.friends || []).some((name) => usernameKey(name) === b.usernameKey);
  }

  function shareClub(a, b) {
    if (!a?.id || !b?.id) return false;
    return Object.values(userStore.clubs || {}).some((club) => {
      hydrateClub(club);
      return club.members.some((m) => m.userId === a.id) && club.members.some((m) => m.userId === b.id);
    });
  }

  function addMutualFriend(a, b) {
    hydrateUser(a);
    hydrateUser(b);
    if (!areFriends(a, b)) a.social.friends.push(b.username);
    if (!areFriends(b, a)) b.social.friends.push(a.username);
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

  function avatarStyleKey(style) {
    const raw = String(style || DEFAULT_AVATAR_STYLE).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    return AVATAR_STYLE_ALIASES[raw] ? raw : DEFAULT_AVATAR_STYLE;
  }

  function avatarSeedForUser(user) {
    return user?.profile?.avatarSeed || (user?.id ? `user:${user.id}` : `user:${user?.usernameKey || usernameKey(user?.username)}`);
  }

  function avatarUrl(style, seed) {
    const avatarStyle = avatarStyleKey(style);
    const avatarSeed = String(seed || "player").slice(0, 128);
    return `/api/avatar/${encodeURIComponent(avatarStyle)}.svg?seed=${encodeURIComponent(avatarSeed)}`;
  }

  function publicProfile(user) {
    hydrateUser(user);
    const p = user?.profile || {};
    const style = avatarStyleKey(p.avatar);
    const seed = avatarSeedForUser(user);
    return {
      ...p,
      avatar: style,
      avatarSeed: seed,
      avatarUrl: avatarUrl(style, seed),
    };
  }

  async function dicebearModules() {
    if (!dicebearModulesPromise) {
      dicebearModulesPromise = Promise.all([import("@dicebear/core"), import("@dicebear/collection")]).then(([core, collection]) => ({
        createAvatar: core.createAvatar,
        collection,
      }));
    }
    return dicebearModulesPromise;
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
    const avatarCandidates = [];
    const otherCandidates = [];
    for (const [group, items] of Object.entries(COSMETIC_CATALOG)) {
      for (const item of items) {
        if ((item.price || 0) <= 0) continue;
        const candidate = { group, ...item };
        if (group === "avatars") avatarCandidates.push(candidate);
        else otherCandidates.push(candidate);
      }
    }
  
    const random = seededRandom(hashSeed(`shop:${window.key}`));
    const shuffleForShop = (items) =>
      items
        .map((item) => ({ item, sort: random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ item }) => item);
    const limited = [
      ...shuffleForShop(avatarCandidates).slice(0, 1),
      ...shuffleForShop(otherCandidates).slice(0, 4),
    ];
    const shuffled = limited
      .map((item) => ({ item, sort: random() }))
      .sort((a, b) => a.sort - b.sort)
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
    const p = publicProfile(user);
    return {
      avatar: p.avatar || DEFAULT_AVATAR_STYLE,
      avatarSeed: p.avatarSeed,
      avatarUrl: p.avatarUrl,
      banner: p.banner || "Sunset Clash",
      boardSkin: p.boardSkin || "Classic Chaos",
      pieceSkin: p.pieceSkin || "Standard",
      border: p.border || "None",
      emote: p.emote || "Good game",
      cardBack: p.cardBack || "Classic Cards",
    };
  }

  function publicSocial(user) {
    hydrateUser(user);
    const friends = user.social?.friends || [];
    const friendProfiles = friends.map((name) => {
      const friend = userStore.users[usernameKey(name)];
      if (!friend) return { username: name, profile: null };
      return { username: friend.username, profile: publicProfile(friend) };
    });
    return {
      friends,
      friendProfiles,
      rivals: user.social?.rivals || [],
      clubs: clubsForUser(user.id).map((club) => ({
        id: club.id,
        name: club.name,
        slug: club.slug,
        role: clubRole(club, user.id),
        memberCount: club.members.length,
      })),
      notifications: publicNotifications(user),
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
    if (achievementState.awardedCoins > 0) saveUsers(userStore, { userIds: [user.id] });
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
      profile: publicProfile(user),
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
      social: publicSocial(user),
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
    saveUsers(userStore, { sessionTokens: [token] });
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
    saveUsers(userStore, { userIds: [user.id] });
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
    app.get("/api/avatar/:style.svg", async (req, res) => {
      try {
        const style = avatarStyleKey(req.params.style);
        const seed = String(req.query.seed || "player").slice(0, 128);
        const { createAvatar, collection } = await dicebearModules();
        const avatar = createAvatar(collection[AVATAR_STYLE_ALIASES[style]], {
          seed,
          size: 128,
          radius: 8,
          backgroundColor: ["ffd166", "24d6c8", "ff4f8b", "f8fafc"],
        });
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=604800, immutable");
        res.send(avatar.toString());
      } catch (err) {
        console.error("Failed to render DiceBear avatar", err);
        res.status(500).type("text/plain").send("Avatar unavailable");
      }
    });

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
    
    app.get("/api/users/:username/profile", async (req, res) => {
      const key = usernameKey(req.params.username);
      const user = USE_DATABASE ? await refreshDatabaseUserByUsernameKey(key) : userStore.users[key];
      if (!user) return res.status(404).json({ ok: false, error: "Player not found." });
      const profile = publicUser(user, { awardAchievements: false });
      delete profile.isAdmin;
      delete profile.cosmetics;
      if (profile.social) delete profile.social.notifications;
      res.json({ ok: true, user: profile });
    });
    
    app.post("/api/auth/signup", async (req, res) => {
      const validation = validateSignup(req.body?.username, req.body?.password);
      if (!validation.ok) return res.status(400).json(validation);
      const key = usernameKey(validation.username);
      if (userStore.users[key]) return res.status(409).json({ ok: false, error: "Username is already taken." });
    
      const password = hashPassword(req.body.password);
      const id = crypto.randomUUID();
      const user = {
        id,
        username: validation.username,
        usernameKey: key,
        salt: password.salt,
        passwordHash: password.hash,
        createdAt: new Date().toISOString(),
        stats: defaultStats(),
        profile: { ...defaultProfile(validation.username), avatarSeed: `user:${id}` },
        matchHistory: [],
        ruleCollection: {},
        achievementRewards: {},
        cosmetics: {},
        social: { friends: [], rivals: [], clubs: [], notifications: [] },
        campaign: createDefaultCampaignProgress(buildCampaignRulePlan()),
      };
      userStore.users[key] = user;
      saveUsers(userStore, { userIds: [user.id] });
      await flushUserStoreWrites();
    
      const token = createSession(user.id);
      await flushUserStoreWrites();
      res.json({ ok: true, token, user: publicUser(user) });
    });
    
    app.post("/api/auth/login", async (req, res) => {
      const key = usernameKey(req.body?.username);
      const user = USE_DATABASE ? await refreshDatabaseUserByUsernameKey(key) : userStore.users[key];
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
        saveUsers(userStore, { deleteSessionTokens: [token] });
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
    
      saveUsers(userStore, { userIds: [user.id] });
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
        saveUsers(userStore, { userIds: [user.id] });
        await flushUserStoreWrites();
        return res.json({ ok: true, campaign: user.campaign, user: publicUser(user) });
      }
    
      if (action === "openChest") {
        const result = openCampaignChestForUser(user, req.body?.chestIndex, plan);
        if (!result.ok) return res.status(400).json(result);
        saveUsers(userStore, { userIds: [user.id] });
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
      saveUsers(userStore, { userIds: [user.id] });
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
      saveUsers(userStore, { userIds: [user.id] });
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
      hydrateUser(friend);
      if (areFriends(user, friend)) return res.json({ ok: true, user: publicUser(user), alreadyFriends: true });
      const existing = (friend.social.notifications || []).find(
        (n) => n?.type === "friendRequest" && n.fromUserId === user.id
      );
      if (!existing) {
        addNotification(friend, {
          type: "friendRequest",
          fromUserId: user.id,
          fromUsername: user.username,
          message: `${user.username} sent you a friend request.`,
        });
      }
      saveUsers(userStore, { userIds: [friend.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, user: publicUser(user), requested: true });
    });

    app.delete("/api/me/friends/:username", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const friendKey = usernameKey(req.params.username);
      const friend = Object.values(userStore.users || {}).find((u) => u?.usernameKey === friendKey);
      if (!friend) return res.status(404).json({ ok: false, error: "Player not found." });
      hydrateUser(friend);
      user.social.friends = (user.social.friends || []).filter((name) => usernameKey(name) !== friend.usernameKey);
      friend.social.friends = (friend.social.friends || []).filter((name) => usernameKey(name) !== user.usernameKey);
      saveUsers(userStore, { userIds: [user.id, friend.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, user: publicUser(user) });
    });

    app.get("/api/clubs", (req, res) => {
      const viewer = accountFromToken(authTokenFromReq(req));
      const clubs = Object.values(userStore.clubs || {}).map((club) => publicClubCard(club, viewer));
      clubs.sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name));
      res.json({ ok: true, clubs });
    });

    app.post("/api/clubs", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const name = normalizeClubName(req.body?.name);
      const description = String(req.body?.description || "").trim().slice(0, 180);
      const slug = clubSlug(name);
      if (name.length < 3 || !slug) return res.status(400).json({ ok: false, error: "Club name must be at least 3 characters." });
      if (Object.values(userStore.clubs || {}).some((club) => hydrateClub(club).slug === slug)) {
        return res.status(409).json({ ok: false, error: "A club with that name already exists." });
      }
      if (!user.isAdmin && Number(user.stats?.coins || 0) < CLUB_CREATE_COST) {
        return res.status(400).json({ ok: false, error: `Creating a club costs ${CLUB_CREATE_COST} coins.` });
      }
      if (!user.isAdmin) {
        user.stats.coins -= CLUB_CREATE_COST;
        user.stats.coinsSpent += CLUB_CREATE_COST;
      }
      const club = hydrateClub({
        id: crypto.randomUUID(),
        name,
        slug,
        description,
        ownerUserId: user.id,
        ownerUsername: user.username,
        createdAt: new Date().toISOString(),
        members: [{ userId: user.id, username: user.username, role: "owner", joinedAt: Date.now() }],
        joinRequests: [],
        activity: [],
        announcements: [],
        settings: { visibility: req.body?.visibility === "private" ? "private" : "public", requestOnly: true },
      });
      addClubActivity(club, `${user.username} founded the club.`);
      userStore.clubs[club.id] = club;
      saveUsers(userStore, { userIds: [user.id], clubIds: [club.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, club: publicClubDetail(club, user), user: publicUser(user) });
    });

    app.get("/api/clubs/:clubId", (req, res) => {
      const user = accountFromToken(authTokenFromReq(req));
      const club = clubById(req.params.clubId);
      if (!club) return res.status(404).json({ ok: false, error: "Club not found." });
      const role = clubRole(club, user?.id);
      if (club.settings.visibility === "private" && !role) return res.status(403).json({ ok: false, error: "This club is private." });
      res.json({ ok: true, club: role ? publicClubDetail(club, user) : publicClubCard(club, user) });
    });

    app.patch("/api/clubs/:clubId", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const club = clubById(req.params.clubId);
      if (!club) return res.status(404).json({ ok: false, error: "Club not found." });
      if (clubRole(club, user.id) !== "owner") return res.status(403).json({ ok: false, error: "Only the owner can edit club details." });
      if (typeof req.body?.name === "string") {
        const name = normalizeClubName(req.body.name);
        const slug = clubSlug(name);
        if (name.length < 3 || !slug) return res.status(400).json({ ok: false, error: "Club name must be at least 3 characters." });
        if (slug !== club.slug && Object.values(userStore.clubs || {}).some((c) => hydrateClub(c).slug === slug)) {
          return res.status(409).json({ ok: false, error: "A club with that name already exists." });
        }
        club.name = name;
        club.slug = slug;
      }
      if (typeof req.body?.description === "string") club.description = req.body.description.trim().slice(0, 180);
      if (req.body?.visibility === "public" || req.body?.visibility === "private") club.settings.visibility = req.body.visibility;
      saveUsers(userStore, { clubIds: [club.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, club: publicClubDetail(club, user) });
    });

    app.delete("/api/clubs/:clubId", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const club = clubById(req.params.clubId);
      if (!club) return res.status(404).json({ ok: false, error: "Club not found." });
      if (clubRole(club, user.id) !== "owner") return res.status(403).json({ ok: false, error: "Only the owner can delete the club." });
      delete userStore.clubs[club.id];
      saveUsers(userStore, { deleteClubIds: [club.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, user: publicUser(user) });
    });

    app.post("/api/clubs/:clubId/request", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const club = clubById(req.params.clubId);
      if (!club) return res.status(404).json({ ok: false, error: "Club not found." });
      if (clubRole(club, user.id)) return res.json({ ok: true, club: publicClubDetail(club, user), alreadyMember: true });
      if (!club.joinRequests.some((r) => r.userId === user.id)) {
        club.joinRequests.push({ userId: user.id, username: user.username, createdAt: Date.now() });
        for (const member of club.members.filter((m) => m.role === "owner" || m.role === "admin")) {
          const manager = userById(member.userId);
          if (manager) {
            addNotification(manager, {
              type: "clubJoinRequest",
              fromUserId: user.id,
              fromUsername: user.username,
              clubId: club.id,
              clubName: club.name,
              message: `${user.username} requested to join ${club.name}.`,
            });
          }
        }
      }
      saveUsers(userStore, { clubIds: [club.id], userIds: club.members.map((m) => m.userId) });
      await flushUserStoreWrites();
      res.json({ ok: true, club: publicClubCard(club, user), requested: true });
    });

    async function resolveClubRequest(req, res, accepted) {
      const user = authedUser(req, res);
      if (!user) return;
      const club = clubById(req.params.clubId);
      if (!club) return res.status(404).json({ ok: false, error: "Club not found." });
      if (!canManageClub(club, user.id)) return res.status(403).json({ ok: false, error: "Only club admins can manage requests." });
      const target = userById(req.params.userId);
      const request = club.joinRequests.find((r) => r.userId === req.params.userId);
      if (!request) return res.status(404).json({ ok: false, error: "Join request not found." });
      club.joinRequests = club.joinRequests.filter((r) => r.userId !== req.params.userId);
      if (accepted && target && !clubRole(club, target.id)) {
        club.members.push({ userId: target.id, username: target.username, role: "member", joinedAt: Date.now() });
        addClubActivity(club, `${target.username} joined the club.`);
      }
      if (target) {
        addNotification(target, {
          type: accepted ? "clubJoinAccepted" : "clubJoinDenied",
          fromUserId: user.id,
          fromUsername: user.username,
          clubId: club.id,
          clubName: club.name,
          message: accepted ? `Your request to join ${club.name} was accepted.` : `Your request to join ${club.name} was denied.`,
        });
      }
      saveUsers(userStore, { clubIds: [club.id], userIds: [target?.id, ...club.members.map((m) => m.userId)].filter(Boolean) });
      await flushUserStoreWrites();
      res.json({ ok: true, club: publicClubDetail(club, user) });
    }

    app.post("/api/clubs/:clubId/requests/:userId/accept", (req, res) => resolveClubRequest(req, res, true));
    app.post("/api/clubs/:clubId/requests/:userId/deny", (req, res) => resolveClubRequest(req, res, false));

    app.post("/api/clubs/:clubId/leave", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const club = clubById(req.params.clubId);
      if (!club) return res.status(404).json({ ok: false, error: "Club not found." });
      if (club.ownerUserId === user.id) return res.status(400).json({ ok: false, error: "Owners must delete the club or promote another owner first." });
      club.members = club.members.filter((m) => m.userId !== user.id);
      addClubActivity(club, `${user.username} left the club.`);
      saveUsers(userStore, { clubIds: [club.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, user: publicUser(user) });
    });

    async function setClubMemberRole(req, res, role) {
      const user = authedUser(req, res);
      if (!user) return;
      const club = clubById(req.params.clubId);
      if (!club) return res.status(404).json({ ok: false, error: "Club not found." });
      if (clubRole(club, user.id) !== "owner") return res.status(403).json({ ok: false, error: "Only the owner can change roles." });
      const member = club.members.find((m) => m.userId === req.params.userId);
      if (!member || member.role === "owner") return res.status(404).json({ ok: false, error: "Member not found." });
      member.role = role;
      saveUsers(userStore, { clubIds: [club.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, club: publicClubDetail(club, user) });
    }

    app.post("/api/clubs/:clubId/members/:userId/promote", (req, res) => setClubMemberRole(req, res, "admin"));
    app.post("/api/clubs/:clubId/members/:userId/demote", (req, res) => setClubMemberRole(req, res, "member"));

    app.delete("/api/clubs/:clubId/members/:userId", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const club = clubById(req.params.clubId);
      if (!club) return res.status(404).json({ ok: false, error: "Club not found." });
      if (!canManageClub(club, user.id)) return res.status(403).json({ ok: false, error: "Only club admins can remove members." });
      const member = club.members.find((m) => m.userId === req.params.userId);
      if (!member || member.role === "owner") return res.status(404).json({ ok: false, error: "Member not found." });
      club.members = club.members.filter((m) => m.userId !== req.params.userId);
      addClubActivity(club, `${member.username} was removed from the club.`);
      saveUsers(userStore, { clubIds: [club.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, club: publicClubDetail(club, user) });
    });

    app.post("/api/clubs/:clubId/announcements", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const club = clubById(req.params.clubId);
      if (!club) return res.status(404).json({ ok: false, error: "Club not found." });
      if (!canManageClub(club, user.id)) return res.status(403).json({ ok: false, error: "Only club admins can post announcements." });
      const text = String(req.body?.text || "").trim().slice(0, 180);
      if (!text) return res.status(400).json({ ok: false, error: "Announcement cannot be empty." });
      club.announcements = [{ id: notificationId(), text, author: user.username, createdAt: Date.now() }, ...(club.announcements || [])].slice(0, 20);
      addClubActivity(club, `${user.username} posted an announcement.`);
      for (const member of club.members) {
        if (member.userId === user.id) continue;
        const target = userById(member.userId);
        if (target) addNotification(target, { type: "clubAnnouncement", fromUserId: user.id, fromUsername: user.username, clubId: club.id, clubName: club.name, message: `${club.name}: ${text}` });
      }
      saveUsers(userStore, { clubIds: [club.id], userIds: club.members.map((m) => m.userId) });
      await flushUserStoreWrites();
      res.json({ ok: true, club: publicClubDetail(club, user) });
    });

    app.get("/api/me/notifications", (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      res.json({ ok: true, notifications: publicNotifications(user), user: publicUser(user) });
    });

    app.post("/api/me/notifications/:id/accept", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const note = (user.social.notifications || []).find((n) => n?.id === req.params.id);
      if (!note) return res.status(404).json({ ok: false, error: "Notification not found." });
      if (note.type !== "friendRequest") return res.status(400).json({ ok: false, error: "That notification cannot be accepted here." });
      const sender = userById(note.fromUserId);
      if (!sender) {
        removeNotification(user, note.id);
        saveUsers(userStore, { userIds: [user.id] });
        await flushUserStoreWrites();
        return res.status(404).json({ ok: false, error: "That player no longer exists." });
      }
      addMutualFriend(user, sender);
      removeNotification(user, note.id);
      addNotification(sender, {
        type: "friendAccepted",
        fromUserId: user.id,
        fromUsername: user.username,
        message: `${user.username} accepted your friend request.`,
      });
      saveUsers(userStore, { userIds: [user.id, sender.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, user: publicUser(user), notifications: publicNotifications(user) });
    });

    app.delete("/api/me/notifications/:id", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      removeNotification(user, req.params.id);
      saveUsers(userStore, { userIds: [user.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, notifications: publicNotifications(user), user: publicUser(user) });
    });
    
    app.delete("/api/me", async (req, res) => {
      const user = authedUser(req, res);
      if (!user) return;
      const deletedSessionTokens = [];
      for (const [token, session] of Object.entries(userStore.sessions || {})) {
        if (session.userId === user.id) {
          deletedSessionTokens.push(token);
          delete userStore.sessions[token];
        }
      }
      delete userStore.users[user.usernameKey];
      const changedClubIds = [];
      const deletedClubIds = [];
      for (const club of Object.values(userStore.clubs || {}).map(hydrateClub)) {
        if (club.ownerUserId === user.id) {
          delete userStore.clubs[club.id];
          deletedClubIds.push(club.id);
          continue;
        }
        const beforeMembers = club.members.length;
        const beforeRequests = club.joinRequests.length;
        club.members = club.members.filter((m) => m.userId !== user.id);
        club.joinRequests = club.joinRequests.filter((r) => r.userId !== user.id);
        if (club.members.length !== beforeMembers || club.joinRequests.length !== beforeRequests) changedClubIds.push(club.id);
      }
      saveUsers(userStore, { deleteUserIds: [user.id], deleteSessionTokens: deletedSessionTokens, clubIds: changedClubIds, deleteClubIds: deletedClubIds });
      await flushUserStoreWrites();
      res.json({ ok: true });
    });
    
    app.get("/api/admin/users", async (req, res) => {
      const admin = adminUser(req, res);
      if (!admin) return;
      await refreshDatabaseUsers();
      const users = Object.values(userStore.users || {}).map((u) => sanitizeAdminUserPayload(u));
      users.sort((a, b) => String(a.username || "").localeCompare(String(b.username || ""), undefined, { sensitivity: "base" }));
      res.json({ ok: true, users });
    });
    
    app.patch("/api/admin/users/:id", async (req, res) => {
      const admin = adminUser(req, res);
      if (!admin) return;
      const target = USE_DATABASE ? await refreshDatabaseUserById(req.params.id) : userById(req.params.id);
      if (!target) return res.status(404).json({ ok: false, error: "User not found." });
      hydrateUser(target);
    
      const incoming = req.body?.user;
      if (!incoming || typeof incoming !== "object") return res.status(400).json({ ok: false, error: "Missing user payload." });

      const validation = validateSignup(typeof incoming.username === "string" ? incoming.username : target.username, "0000");
      if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error.replace("Password must be at least 4 characters.", "Invalid username.") });
      const nextKey = usernameKey(validation.username);
      if (nextKey !== target.usernameKey && userStore.users[nextKey] && userStore.users[nextKey].id !== target.id) {
        return res.status(409).json({ ok: false, error: "Username is already taken." });
      }

      const originalKey = target.usernameKey;
      const nextUser = {
        ...JSON.parse(JSON.stringify(target)),
        ...JSON.parse(JSON.stringify(incoming)),
        id: target.id,
        username: validation.username,
        usernameKey: nextKey,
        salt: target.salt,
        passwordHash: target.passwordHash,
      };
      if (!nextUser.createdAt) nextUser.createdAt = target.createdAt || new Date().toISOString();

      hydrateUser(nextUser);
      if (originalKey !== nextUser.usernameKey) delete userStore.users[originalKey];
      userStore.users[nextUser.usernameKey] = nextUser;
      updateActivePlayerNames(nextUser);

      saveUsers(userStore, { userIds: [nextUser.id] });
      await flushUserStoreWrites();
      res.json({ ok: true, user: sanitizeAdminUserPayload(nextUser) });
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
    addNotification,
    areFriends,
    shareClub,
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
