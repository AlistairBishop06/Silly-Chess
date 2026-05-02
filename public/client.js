/* global io */

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

const els = {
  status: document.getElementById("status"),
  profileBtn: document.getElementById("profileBtn"),
  accountSummary: document.getElementById("accountSummary"),
  accountActionBtn: document.getElementById("accountActionBtn"),
  authModal: document.getElementById("authModal"),
  authTitle: document.getElementById("authTitle"),
  authCloseBtn: document.getElementById("authCloseBtn"),
  loginTabBtn: document.getElementById("loginTabBtn"),
  signupTabBtn: document.getElementById("signupTabBtn"),
  authUsername: document.getElementById("authUsername"),
  authPassword: document.getElementById("authPassword"),
  authStatus: document.getElementById("authStatus"),
  authSubmitBtn: document.getElementById("authSubmitBtn"),
  profileModal: document.getElementById("profileModal"),
  profileCloseBtn: document.getElementById("profileCloseBtn"),
  profileTabs: document.getElementById("profileTabs"),
  profileContent: document.getElementById("profileContent"),
  adminTabBtn: document.getElementById("adminTabBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  singleplayerBtn: document.getElementById("singleplayerBtn"),
  createBtn: document.getElementById("createBtn"),
  createModal: document.getElementById("createModal"),
  createCloseBtn: document.getElementById("createCloseBtn"),
  createPublicBtn: document.getElementById("createPublicBtn"),
  createPrivateBtn: document.getElementById("createPrivateBtn"),
  shopBtn: document.getElementById("shopBtn"),
  shopModal: document.getElementById("shopModal"),
  shopCloseBtn: document.getElementById("shopCloseBtn"),
  shopResetTimer: document.getElementById("shopResetTimer"),
  shopStatus: document.getElementById("shopStatus"),
  shopOffers: document.getElementById("shopOffers"),
  code: document.getElementById("codeInput"),
  joinBtn: document.getElementById("joinBtn"),
  joinModal: document.getElementById("joinModal"),
  joinCloseBtn: document.getElementById("joinCloseBtn"),
  joinCodeBtn: document.getElementById("joinCodeBtn"),
  refreshServersBtn: document.getElementById("refreshServersBtn"),
  openServers: document.getElementById("openServers"),
  rulebookBtn: document.getElementById("rulebookBtn"),
  rulebookModal: document.getElementById("rulebookModal"),
  rulebookCloseBtn: document.getElementById("rulebookCloseBtn"),
  rulebookCards: document.getElementById("rulebookCards"),
  lobbyPanel: document.getElementById("lobbyPanel"),
  gamePanel: document.getElementById("gamePanel"),
  leaveBtn: document.getElementById("leaveBtn"),
  resultModal: document.getElementById("resultModal"),
  resultTitle: document.getElementById("resultTitle"),
  resultDetail: document.getElementById("resultDetail"),
  readyStatus: document.getElementById("readyStatus"),
  readyBtn: document.getElementById("readyBtn"),
  confetti: document.getElementById("confetti"),
  lobbyCode: document.getElementById("lobbyCode"),
  youInfo: document.getElementById("youInfo"),
  turnInfo: document.getElementById("turnInfo"),
  plyInfo: document.getElementById("plyInfo"),
  emoteBtn: document.getElementById("emoteBtn"),
  canvas: document.getElementById("board"),
  overlayText: document.getElementById("overlayText"),
  sideLabelTop: document.getElementById("sideLabelTop"),
  sideLabelBottom: document.getElementById("sideLabelBottom"),
  boardWrap: document.querySelector(".boardWrap"),
  activeCards: document.getElementById("activeCards"),
  choiceArea: document.getElementById("choiceArea"),
  choiceCards: document.getElementById("choiceCards"),
  choiceTimer: document.getElementById("choiceTimer"),
  choiceTitle: document.getElementById("choiceTitle"),
  rpsModal: document.getElementById("rpsModal"),
  rpsTimer: document.getElementById("rpsTimer"),
  rpsStatus: document.getElementById("rpsStatus"),
  rpsRockBtn: document.getElementById("rpsRockBtn"),
  rpsPaperBtn: document.getElementById("rpsPaperBtn"),
  rpsScissorsBtn: document.getElementById("rpsScissorsBtn"),
  wagerModal: document.getElementById("wagerModal"),
  wagerTimer: document.getElementById("wagerTimer"),
  wagerStatus: document.getElementById("wagerStatus"),
  wagerYouGrid: document.getElementById("wagerYouGrid"),
  wagerOppGrid: document.getElementById("wagerOppGrid"),
  wagerConfirmBtn: document.getElementById("wagerConfirmBtn"),
  coinArea: document.getElementById("coinArea"),
  coinAssign: document.getElementById("coinAssign"),
  coinSpin: document.getElementById("coinSpin"),
  wagerResult: document.getElementById("wagerResult"),
  supermarketModal: document.getElementById("supermarketModal"),
  supermarketBudget: document.getElementById("supermarketBudget"),
  supermarketStatus: document.getElementById("supermarketStatus"),
  supermarketItems: document.getElementById("supermarketItems"),
  supermarketCheckoutBtn: document.getElementById("supermarketCheckoutBtn"),
  mutantModal: document.getElementById("mutantModal"),
  mutantStatus: document.getElementById("mutantStatus"),
  mutantSelected: document.getElementById("mutantSelected"),
  mutantConfirmBtn: document.getElementById("mutantConfirmBtn"),
  cardPopupLayer: document.getElementById("cardPopupLayer"),
  adsLayer: document.getElementById("adsLayer"),
  log: document.getElementById("log"),
  gameMsg: document.getElementById("gameMsg"),
};

const ctx = els.canvas.getContext("2d");

const state = {
  connected: false,
  lobby: null,
  playerId: null,
  color: null,
  serverState: null,
  selected: null,
  legalTo: null,
  flipVisual: false,
  particles: [],
  animations: [],
  supplyDrops: [],
  lawnmowers: [],
  bullets: [],
  lastEffectsSeen: new Set(),
  lastChoiceKey: null,
  lastStateAt: 0,
  lastSyncAt: 0,
  lastRematchId: null,
  pendingTargetKey: null,
  cachedRulebook: null,
  openServers: [],
  supermarketItems: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  supermarketKey: null,
  ads: [],
  nextAdAt: 0,
  authToken: null,
  account: null,
  authMode: "login",
  profileTab: "overview",
  viewedProfile: null,
  viewedProfileReadOnly: false,
  lastProfileResultKey: null,
  adminUsers: null,
  adminFlags: null,
  adminSelectedUserId: null,
  adminUserDraft: "",
  activeEmotes: {},
  dailyShop: null,
  shopClockOffset: 0,
};

const confetti = {
  running: false,
  parts: [],
  raf: 0,
};

const CARD_POPUP_HOLD_MS = 2000;
const CARD_POPUP_EXIT_MS = 560;
const CARD_POPUP_ENTER_MS = Math.max(240, CARD_POPUP_HOLD_MS - CARD_POPUP_EXIT_MS);

const PIECE_GLYPH_MONO = {
  p: "♙",
  n: "♘",
  b: "♗",
  r: "♖",
  q: "♕",
  k: "♔",
};

function sqToAlg(sq) {
  const file = sq % 8;
  const rank = Math.floor(sq / 8);
  return String.fromCharCode(97 + file) + String(rank + 1);
}

function titanFootprint(anchor) {
  const file = anchor % 8;
  const rank = Math.floor(anchor / 8);
  if (file < 0 || file > 6 || rank < 0 || rank > 6) return [];
  return [anchor, anchor + 1, anchor + 8, anchor + 9];
}

function titanAnchorAtSquare(board, square) {
  const piece = board?.[square];
  if (piece?.tags?.includes("titan")) return square;
  if (!piece?.tags?.includes("titanBody")) return null;
  const candidates = [square, square - 1, square - 8, square - 9].filter((sq) => sq >= 0 && sq < 64);
  for (const candidate of candidates) {
    const titan = board?.[candidate];
    if (!titan?.tags?.includes("titan")) continue;
    if (titanFootprint(candidate).includes(square)) return candidate;
  }
  return null;
}

function titanBounds(anchor) {
  const footprint = titanFootprint(anchor).map((sq) => squareToCanvasCenter(sq));
  const xs = footprint.map((p) => p.x);
  const ys = footprint.map((p) => p.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

function titanAnchorFromCanvasPoint(anchors, px, py) {
  const point = canvasPoint(px, py);
  const size = els.canvas.width / 8;
  for (const anchor of anchors || []) {
    const box = titanBounds(anchor);
    const left = box.left - size / 2;
    const right = box.right + size / 2;
    const top = box.top - size / 2;
    const bottom = box.bottom + size / 2;
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return anchor;
  }
  return null;
}

function stopConfetti() {
  confetti.running = false;
  confetti.parts = [];
  if (confetti.raf) cancelAnimationFrame(confetti.raf);
  confetti.raf = 0;
  const c = els.confetti;
  if (c) {
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
  }
}

function startConfetti() {
  const c = els.confetti;
  if (!c) return;

  const resize = () => {
    const rect = c.getBoundingClientRect();
    c.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
    c.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });

  const colors = ["#7bd3ff", "#7dffb3", "#ffe58f", "#ff8fb1", "#caa6ff"];
  const g = c.getContext("2d");
  confetti.parts = [];
  for (let i = 0; i < 140; i++) {
    confetti.parts.push({
      x: Math.random() * c.width,
      y: -Math.random() * c.height,
      vx: (Math.random() - 0.5) * 220,
      vy: 160 + Math.random() * 360,
      r: 6 + Math.random() * 10,
      a: Math.random() * Math.PI * 2,
      va: (Math.random() - 0.5) * 6,
      color: colors[i % colors.length],
    });
  }
  confetti.running = true;

  let last = performance.now();
  const tick = (t) => {
    if (!confetti.running) return;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    g.clearRect(0, 0, c.width, c.height);
    for (const p of confetti.parts) {
      p.x += p.vx * dt * devicePixelRatio;
      p.y += p.vy * dt * devicePixelRatio;
      p.a += p.va * dt;
      p.vy += 40 * dt * devicePixelRatio;

      if (p.y > c.height + 30 * devicePixelRatio) {
        p.y = -20 * devicePixelRatio;
        p.x = Math.random() * c.width;
        p.vy = 160 + Math.random() * 360;
      }

      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.a);
      g.fillStyle = p.color;
      g.globalAlpha = 0.9;
      g.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9);
      g.restore();
    }

    confetti.raf = requestAnimationFrame(tick);
  };

  confetti.raf = requestAnimationFrame(tick);
}

function resetToLobby(reason) {
  if (reason) logLine(`<strong>Lobby</strong>: ${escapeHtml(reason)}`);
  state.lobby = null;
  state.playerId = null;
  state.color = null;
  state.serverState = null;
  state.selected = null;
  state.legalTo = null;
  state.lastChoiceKey = null;
  state.lastEffectsSeen = new Set();
  state.lastRematchId = null;
  state.lastStateAt = 0;
  state.lastSyncAt = 0;
  state.supplyDrops = [];
  state.activeEmotes = {};
  clearAds();
  stopConfetti();
  saveSession();
  syncUI();
}

function enterLobby({ code, playerId, color }) {
  state.lobby = code;
  state.playerId = playerId;
  state.color = color;
  state.serverState = null;
  state.selected = null;
  state.legalTo = null;
  state.lastChoiceKey = null;
  state.lastEffectsSeen = new Set();
  state.lastRematchId = null;
  state.lastStateAt = 0;
  state.lastSyncAt = 0;
  state.supplyDrops = [];
  state.activeEmotes = {};
  clearAds();
  stopConfetti();
  if (els.resultModal) els.resultModal.hidden = true;
  saveSession();
  syncUI();
  socket.emit("game:sync", { code, playerId });
}

function loadSession() {
  try {
    const raw = localStorage.getItem("chaosChessSession");
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") return;
    if (typeof s.lobby === "string") state.lobby = s.lobby;
    if (typeof s.playerId === "string") state.playerId = s.playerId;
    if (s.color === "w" || s.color === "b") state.color = s.color;
  } catch {
    // ignore
  }
}

function saveSession() {
  try {
    if (!state.lobby || !state.playerId || !state.color) {
      localStorage.removeItem("chaosChessSession");
      return;
    }
    localStorage.setItem("chaosChessSession", JSON.stringify({ lobby: state.lobby, playerId: state.playerId, color: state.color }));
  } catch {
    // ignore
  }
}

function loadAccountSession() {
  try {
    const raw = localStorage.getItem("chaosChessAccount");
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (typeof saved?.token === "string") state.authToken = saved.token;
    if (saved?.user && typeof saved.user === "object") state.account = saved.user;
  } catch {
    // ignore
  }
}

function saveAccountSession() {
  try {
    if (!state.authToken || !state.account) {
      localStorage.removeItem("chaosChessAccount");
      return;
    }
    localStorage.setItem("chaosChessAccount", JSON.stringify({ token: state.authToken, user: state.account }));
  } catch {
    // ignore
  }
}

function authHeaders() {
  return state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {};
}

async function refreshAccount() {
  if (!state.authToken) {
    state.account = null;
    renderAccountUI();
    return;
  }
  try {
    const res = await fetch("/api/me", { headers: authHeaders() });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Not signed in.");
    state.account = json.user;
    saveAccountSession();
  } catch {
    state.authToken = null;
    state.account = null;
    saveAccountSession();
  }
  renderAccountUI();
  if (state.account && els.profileModal && !els.profileModal.hidden) renderProfile();
}

function renderAccountUI() {
  const user = state.account;
  const signedIn = !!user;
  if (els.accountSummary) els.accountSummary.textContent = signedIn ? `Playing as ${user.username}` : "Sign up or log in to play.";
  if (els.accountActionBtn) els.accountActionBtn.textContent = signedIn ? "Profile" : "Sign in";
  if (els.profileBtn) els.profileBtn.textContent = signedIn ? user.username : "Sign in";
}

function openAuthModal(mode = "login") {
  state.authMode = mode === "signup" ? "signup" : "login";
  if (!els.authModal) return;
  els.authModal.hidden = false;
  renderAuthMode();
  setTimeout(() => els.authUsername?.focus(), 0);
}

function closeAuthModal() {
  if (els.authModal) els.authModal.hidden = true;
}

function renderAuthMode() {
  const signup = state.authMode === "signup";
  if (els.authTitle) els.authTitle.textContent = signup ? "Sign up" : "Sign in";
  if (els.authSubmitBtn) els.authSubmitBtn.textContent = signup ? "Create account" : "Log in";
  els.loginTabBtn?.classList.toggle("active", !signup);
  els.signupTabBtn?.classList.toggle("active", signup);
  if (els.authPassword) els.authPassword.autocomplete = signup ? "new-password" : "current-password";
  if (els.authStatus) els.authStatus.textContent = "";
}

async function submitAuth() {
  const username = els.authUsername?.value.trim() || "";
  const password = els.authPassword?.value || "";
  const route = state.authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
  if (els.authStatus) els.authStatus.textContent = "";
  try {
    const res = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Account request failed.");
    state.authToken = json.token;
    state.account = json.user;
    saveAccountSession();
    renderAccountUI();
    closeAuthModal();
    if (els.authPassword) els.authPassword.value = "";
  } catch (err) {
    if (els.authStatus) els.authStatus.textContent = err.message || "Account request failed.";
  }
}

function ensureSignedIn() {
  if (state.account && state.authToken) return true;
  openAuthModal("login");
  if (els.authStatus) els.authStatus.textContent = "Sign in or create an account to play.";
  return false;
}

function openProfileModal() {
  if (!state.account) return openAuthModal("login");
  if (!els.profileModal) return;
  state.viewedProfile = null;
  state.viewedProfileReadOnly = false;
  renderProfile();
  els.profileModal.hidden = false;
}

async function openPlayerProfile(player) {
  if (!player || !els.profileModal) return;
  if (player.id === state.playerId) return openProfileModal();

  state.viewedProfileReadOnly = true;
  state.viewedProfile = playerFallbackProfile(player);
  if (["settings", "admin", "cosmetics"].includes(state.profileTab)) state.profileTab = "overview";
  renderProfile();
  els.profileModal.hidden = false;

  try {
    const res = await fetch(`/api/users/${encodeURIComponent(player.name || "")}/profile`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.ok || !json.user) throw new Error(json?.error || "Profile unavailable.");
    state.viewedProfile = json.user;
    renderProfile();
  } catch (err) {
    logLine(`<strong>Profile</strong>: ${escapeHtml(err.message || "Profile unavailable.")}`);
  }
}

function closeProfileModal() {
  if (els.profileModal) els.profileModal.hidden = true;
}

function renderProfile() {
  const user = state.viewedProfile || state.account;
  if (!user || !els.profileContent) return;
  const readOnly = !!state.viewedProfileReadOnly;
  els.profileTabs?.querySelectorAll("button[data-tab]").forEach((btn) => {
    const privateTab = ["settings", "admin", "cosmetics"].includes(btn.dataset.tab);
    btn.hidden = readOnly && privateTab;
  });
  if (els.adminTabBtn) els.adminTabBtn.hidden = readOnly || !user.isAdmin;
  if ((state.profileTab === "admin" && !user.isAdmin) || (readOnly && ["settings", "admin", "cosmetics"].includes(state.profileTab))) {
    state.profileTab = "overview";
  }
  const profile = user.profile || {};
  const stats = user.stats || {};
  const rank = user.rank || {};
  const created = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-";
  const winRate = Number(stats.winRate || 0);
  const avatar = escapeHtml(profile.avatar || user.username.slice(0, 2).toUpperCase());
  const country = profile.country ? `<span>${escapeHtml(profile.country)}</span>` : `<span>Region unset</span>`;
  const bio = profile.bio ? escapeHtml(profile.bio) : "No bio yet.";
  const tier = escapeHtml(rank.tier || "Bronze");
  const progress = Math.max(0, Math.min(100, Number(rank.progress || 0)));

  const hero = `
    <div class="profileHero profileBanner-${bannerClass(profile.banner)}">
      <div class="profileAvatar">${avatar}</div>
      <div class="profileHeroMain">
        <div class="profileNameRow">
          <div>
            <div class="profileName">${escapeHtml(user.username)}</div>
            <div class="profileMeta">Joined ${escapeHtml(created)} &middot; ${country} &middot; <span class="onlineDot"></span>${escapeHtml(profile.onlineStatus || "Online")}</div>
          </div>
          <div class="rankBadge">
            <strong>${tier}</strong>
            <span>${Number(rank.rating || 1000)} MMR</span>
          </div>
        </div>
        <div class="profileBio">${bio}</div>
        <div class="rankProgress"><span style="width: ${progress}%"></span></div>
        <div class="profileMeta">${rank.nextTierAt ? `${progress}% to next rank at ${rank.nextTierAt}` : "Top rank reached"} &middot; Seasonal rank: ${escapeHtml(rank.seasonalRank || tier)}</div>
      </div>
    </div>
  `;

  const tab = state.profileTab || "overview";
  els.profileTabs?.querySelectorAll("button").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  els.profileContent.innerHTML = hero + renderProfileTab(user, tab, winRate, readOnly);
}

function playerFallbackProfile(player) {
  const p = player.profile || {};
  return {
    username: player.name || "Player",
    createdAt: null,
    profile: {
      avatar: p.avatar || (player.name || "?").slice(0, 2).toUpperCase(),
      banner: p.banner || "Sunset Clash",
      country: "",
      bio: player.name === "Chaos Bot" ? "Local chaos engine. Surprisingly judgmental about hanging queens." : "Profile details are loading.",
      onlineStatus: "In match",
      border: p.border || "None",
    },
    stats: {},
    rank: { rating: 1000, tier: "Unranked", progress: 0 },
    matchHistory: [],
    ruleCollection: [],
    achievements: [],
    social: { friends: [], rivals: [], clubs: [] },
    insights: {},
  };
}

function bannerClass(name) {
  return String(name || "Sunset Clash").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sunset-clash";
}

function n(value) {
  return Number(value || 0).toLocaleString();
}

function coinsText(user) {
  return user?.isAdmin ? "∞" : n(user?.stats?.coins);
}

function msDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function statTile(label, value) {
  return `<div><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderProfileTab(user, tab, winRate, readOnly = false) {
  const s = user.stats || {};
  if (tab === "stats") return renderStatsTab(user, winRate);
  if (tab === "history") return renderHistoryTab(user);
  if (tab === "rules") return renderRulesTab(user);
  if (tab === "cosmetics") return renderCosmeticsTab(user);
  if (tab === "achievements") return renderAchievementsTab(user);
  if (tab === "settings") return renderSettingsTab(user);
  if (tab === "admin") return renderAdminTab(user);
  return `
    <div class="profileGrid">
      <section class="profileSection">
        <h3>Overall</h3>
        <div class="profileStats">
          ${statTile("games played", n(s.gamesPlayed))}
          ${statTile("wins", n(s.wins))}
          ${statTile("losses", n(s.losses))}
          ${statTile("draws", n(s.draws))}
          ${statTile("win rate", `${winRate}%`)}
          ${statTile("coins", coinsText(user))}
          ${statTile("best streak", n(s.highestWinstreak))}
        </div>
      </section>
      <section class="profileSection">
        <h3>Rule Identity</h3>
        <div class="profileList">
          <div><span>Favourite rule</span><strong>${escapeHtml(s.favoriteRule?.name || "None yet")}</strong></div>
          <div><span>Most successful rule</span><strong>${escapeHtml(s.mostSuccessfulRule?.name || "None yet")}</strong></div>
          <div><span>Rules discovered</span><strong>${n((user.ruleCollection || []).length)}</strong></div>
        </div>
      </section>
      <section class="profileSection">
        <h3>Social</h3>
        <div class="profileList">
          <div><span>Friends</span><strong>${escapeHtml((user.social?.friends || []).join(", ") || "No friends added")}</strong></div>
          <div><span>Favourite rivals</span><strong>${escapeHtml((user.social?.rivals || []).map((r) => r.name).join(", ") || "None yet")}</strong></div>
          <div><span>Clubs</span><strong>${escapeHtml((user.social?.clubs || []).join(", ") || "No club")}</strong></div>
        </div>
        <div class="friendList">
          ${(user.social?.friends || []).map((name) => `<div><span>${escapeHtml(name)}</span><button type="button" disabled>Challenge</button></div>`).join("") || `<div><span>No friends to challenge yet.</span></div>`}
        </div>
        ${readOnly ? "" : `<div class="friendRow">
          <input id="friendUsername" placeholder="Friend username" maxlength="16" autocomplete="off" />
          <button id="addFriendBtn" type="button">Add friend</button>
        </div>`}
      </section>
      <section class="profileSection">
        <h3>Performance Insights</h3>
        ${renderInsights(user)}
      </section>
    </div>
  `;
}

function renderStatsTab(user, winRate) {
  const s = user.stats || {};
  return `
    <div class="profileGrid">
      <section class="profileSection wide">
        <h3>Stats Dashboard</h3>
        <div class="profileStats">
          ${statTile("games played", n(s.gamesPlayed))}
          ${statTile("wins", n(s.wins))}
          ${statTile("losses", n(s.losses))}
          ${statTile("draws", n(s.draws))}
          ${statTile("win rate", `${winRate}%`)}
          ${statTile("coins", coinsText(user))}
          ${statTile("coins earned", n(s.coinsEarned))}
          ${statTile("coins spent", n(s.coinsSpent))}
          ${statTile("avg game length", `${n(s.averageGameLength)} turns`)}
          ${statTile("checkmates", n(s.checkmatesDelivered))}
          ${statTile("captures", n(s.capturesMade))}
          ${statTile("highest winstreak", n(s.highestWinstreak))}
          ${statTile("rules survived", n(s.rulesSurvived))}
          ${statTile("extra moves", n(s.extraMovesEarned))}
          ${statTile("kings exploded", n(s.kingsExploded))}
          ${statTile("queens sacrificed", n(s.queensSacrificed))}
          ${statTile("pawns promoted", n(s.pawnsPromoted))}
          ${statTile("lava deaths", n(s.lavaDeaths))}
        </div>
      </section>
      <section class="profileSection">
        <h3>Rank</h3>
        <div class="profileList">
          <div><span>Current rating</span><strong>${n(user.rank?.rating || 1000)}</strong></div>
          <div><span>League tier</span><strong>${escapeHtml(user.rank?.tier || "Bronze")}</strong></div>
          <div><span>Peak rating</span><strong>${n(user.rank?.peakRating || 1000)}</strong></div>
        </div>
      </section>
      <section class="profileSection">
        <h3>Performance</h3>
        ${renderInsights(user)}
      </section>
    </div>
  `;
}

function renderHistoryTab(user) {
  const matches = user.matchHistory || [];
  if (!matches.length) return `<section class="profileSection wide"><h3>Match History</h3><div class="emptyServers">No completed matches yet.</div></section>`;
  return `
    <section class="profileSection wide">
      <h3>Recent Matches</h3>
      <div class="historyTable">
        <div class="historyHead"><span>Opponent</span><span>Result</span><span>Rating</span><span>Duration</span></div>
        ${matches
          .map(
            (m) => `
              <details class="historyRow">
                <summary>
                  <span>${escapeHtml(m.opponent || "Opponent")}</span>
                  <span class="result-${String(m.result || "").toLowerCase()}">${escapeHtml(m.result || "-")}</span>
                  <span>${Number(m.ratingChange || 0) >= 0 ? "+" : ""}${n(m.ratingChange)} / +${n(m.coinsEarned)} coins</span>
                  <span>${msDuration(m.durationMs)}</span>
                </summary>
                <div class="matchDetail">
                  <div>${escapeHtml(m.detail || "")}</div>
                  <div><strong>Replay:</strong> ${m.replay ? "Available" : "Not recorded yet"}</div>
                  <div><strong>Activated rules:</strong> ${escapeHtml((m.activatedRules || []).join(", ") || "None recorded")}</div>
                  <div><strong>Move list:</strong> ${escapeHtml((m.moveList || []).join(" "))}</div>
                </div>
              </details>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderRulesTab(user) {
  const rules = user.ruleCollection || [];
  return `
    <section class="profileSection wide">
      <div class="shopHeader">
        <h3>Rule Collection</h3>
        <button id="openRuleAppendixBtn" type="button">View rule appendix</button>
      </div>
      <div class="profileStats">
        ${statTile("rules discovered", n(rules.length))}
        ${statTile("rare cards", n(rules.filter((r) => r.rare).length))}
        ${statTile("card backs", "1")}
      </div>
      <div class="ruleMasteryGrid">
        ${
          rules.length
            ? rules
                .map(
                  (r) => `
                    <div class="ruleMasteryCard">
                      <strong>${escapeHtml(r.name)}</strong>
                      <span>Lv${n(r.mastery)} &middot; Used ${n(r.used)} time(s)</span>
                      <span>Win rate ${n(r.winRate)}%</span>
                    </div>
                  `
                )
                .join("")
            : `<div class="emptyServers">Pick rule cards in matches to discover them here.</div>`
        }
      </div>
    </section>
  `;
}

function renderAchievementsTab(user) {
  const achievements = user.achievements || [];
  return `
    <section class="profileSection wide">
      <h3>Achievements</h3>
      <div class="achievementGrid">
        ${achievements
          .map((a) => {
            const progress = Math.max(0, Math.min(100, Math.round(((a.progress || 0) / Math.max(1, a.target || 1)) * 100)));
            return `
              <div class="achievement ${a.unlocked ? "unlocked" : ""}">
                <strong>${escapeHtml(a.name)}</strong>
                <span>${escapeHtml(a.description)}</span>
                <div class="rankProgress"><span style="width: ${progress}%"></span></div>
                <small>${n(a.progress)} / ${n(a.target)}</small>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderCosmeticsTab(user) {
  const cosmetics = user.cosmetics || {};
  return `
    <section class="profileSection wide">
      <div class="shopHeader">
        <h3>Cosmetics</h3>
        <div class="coinBalance">${coinsText(user)} coins</div>
      </div>
      <div class="cosmeticGrid">
        ${Object.entries(cosmetics)
          .map(
            ([group, items]) => `
              <div class="cosmeticGroup">
                <h3>${escapeHtml(group.replace(/([A-Z])/g, " $1"))}</h3>
                ${(items || [])
                  .map(
                    (item) => `
                      <div class="cosmeticItem ${item.unlocked ? "unlocked" : "locked"}">
                        <span>${escapeHtml(item.label || item.name)}</span>
                        <strong>${item.selected ? "Equipped" : item.unlocked ? "Owned" : `${n(item.price)} coins`}</strong>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function cosmeticOptions(user, group, selected) {
  const items = (user.cosmetics?.[group] || []).filter((item) => item.unlocked);
  return items
    .map((item) => {
      const value = item.name;
      const label = item.label || item.name;
      return `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function cosmeticGroupLabel(group) {
  return String(group || "").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateShopTimer() {
  if (!els.shopResetTimer) return;
  const shop = state.dailyShop;
  if (!shop?.resetAt) {
    els.shopResetTimer.textContent = "--:--:--";
    return;
  }
  const serverNow = Date.now() + (state.shopClockOffset || 0);
  els.shopResetTimer.textContent = formatCountdown(shop.resetAt - serverNow);
}

function previewBoardStyle(name) {
  const p = boardPalette(name);
  return `--preview-light:${p.light};--preview-dark:${p.dark};--preview-accent:${p.accent};`;
}

function cosmeticPreview(item) {
  const group = item.group;
  const slug = cosmeticSlug(item.name);
  const label = escapeHtml(item.label || item.name);
  if (group === "avatars") {
    return `<div class="shopPreview avatarPreview">${escapeHtml(item.name.slice(0, 4).toUpperCase())}</div>`;
  }
  if (group === "borders") {
    const cls = borderClass({ border: item.name });
    return `<div class="shopPreview borderPreview ${escapeAttr(cls)}"><span>${label.slice(0, 2)}</span></div>`;
  }
  if (group === "boardSkins") {
    return `<div class="shopPreview boardPreview" style="${escapeAttr(previewBoardStyle(item.name))}">${Array.from({ length: 16 }, (_, i) => `<span class="${(Math.floor(i / 4) + i) % 2 ? "dark" : "light"}"></span>`).join("")}</div>`;
  }
  if (group === "pieceSkins") {
    return `<div class="shopPreview piecePreview piecePreview-${escapeAttr(slug)}">♛</div>`;
  }
  if (group === "emotes") {
    return `<div class="shopPreview emotePreview">${label}</div>`;
  }
  if (group === "banners") {
    return `<div class="shopPreview bannerPreview profileBanner-${escapeAttr(slug)}"></div>`;
  }
  if (group === "cardBacks") {
    const cls = slug && slug !== "classic-cards" ? `cardBack-${slug}` : "";
    return `<div class="shopPreview cardBackPreview card ${escapeAttr(cls)}"><span>Rule</span></div>`;
  }
  return `<div class="shopPreview">${label}</div>`;
}

function renderDailyShop() {
  updateShopTimer();
  if (!els.shopOffers) return;
  const shop = state.dailyShop;
  if (!shop?.offers) {
    els.shopOffers.innerHTML = `<div class="modalStatus">Loading shop...</div>`;
    return;
  }
  const user = state.account || {};
  els.shopOffers.innerHTML = shop.offers
    .map((item) => {
      const owned = !!item.owned;
      const affordable = !!item.affordable;
      const disabled = owned || !affordable ? "disabled" : "";
      const status = owned ? "Owned" : `${n(item.price)} coins`;
      return `
        <div class="dailyShopItem ${owned ? "owned" : ""}">
          ${cosmeticPreview(item)}
          <div class="dailyShopMeta">
            <span>${escapeHtml(cosmeticGroupLabel(item.group))}</span>
            <strong>${escapeHtml(item.label || item.name)}</strong>
            <small>${escapeHtml(status)}</small>
          </div>
          <button class="buyCosmeticBtn" type="button" data-buy-group="${escapeAttr(item.group)}" data-buy-name="${escapeAttr(item.name)}" ${disabled}>
            ${owned ? "Owned" : affordable ? "Buy" : "Insufficient coins"}
          </button>
        </div>
      `;
    })
    .join("");
  if (els.shopStatus) els.shopStatus.textContent = `Balance: ${coinsText(user)} coins`;
}

async function loadDailyShop() {
  if (els.shopStatus) els.shopStatus.textContent = "Loading shop...";
  if (els.shopOffers) els.shopOffers.innerHTML = "";
  try {
    const res = await fetch("/api/shop/daily", { headers: authHeaders(), cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load shop.");
    state.dailyShop = json.shop || null;
    state.shopClockOffset = Number(state.dailyShop?.serverNow || Date.now()) - Date.now();
    renderDailyShop();
  } catch (err) {
    if (els.shopStatus) els.shopStatus.textContent = err.message || "Failed to load shop.";
    if (els.shopOffers) els.shopOffers.innerHTML = "";
  }
}

function openShopModal() {
  if (!ensureSignedIn()) return;
  if (!els.shopModal) return;
  els.shopModal.hidden = false;
  loadDailyShop();
}

function closeShopModal() {
  if (els.shopModal) els.shopModal.hidden = true;
}

function renderSettingsTab(user) {
  const p = user.profile || {};
  return `
    <section class="profileSection wide">
      <h3>Settings</h3>
      <div class="settingsGrid">
        <div class="fieldStack"><label for="settingsUsername">Username</label><input id="settingsUsername" maxlength="16" value="${escapeAttr(user.username)}" /></div>
        <div class="fieldStack"><label for="settingsAvatar">Avatar / icon</label><select id="settingsAvatar">${cosmeticOptions(user, "avatars", p.avatar)}</select></div>
        <div class="fieldStack"><label for="settingsBanner">Banner</label><select id="settingsBanner">${cosmeticOptions(user, "banners", p.banner)}</select></div>
        <div class="fieldStack"><label for="settingsCountry">Country / region</label><input id="settingsCountry" maxlength="32" value="${escapeAttr(p.country || "")}" /></div>
        <div class="fieldStack wide"><label for="settingsBio">Short bio</label><input id="settingsBio" maxlength="160" value="${escapeAttr(p.bio || "")}" /></div>
        <div class="fieldStack"><label for="settingsBoardSkin">Chessboard skin</label><select id="settingsBoardSkin">${cosmeticOptions(user, "boardSkins", p.boardSkin)}</select></div>
        <div class="fieldStack"><label for="settingsPieceSkin">Piece skin</label><select id="settingsPieceSkin">${cosmeticOptions(user, "pieceSkins", p.pieceSkin)}</select></div>
        <div class="fieldStack"><label for="settingsBorder">Animated border</label><select id="settingsBorder">${cosmeticOptions(user, "borders", p.border)}</select></div>
        <div class="fieldStack"><label for="settingsEmote">Emote</label><select id="settingsEmote">${cosmeticOptions(user, "emotes", p.emote)}</select></div>
        <div class="fieldStack"><label for="settingsCardBack">Card back</label><select id="settingsCardBack">${cosmeticOptions(user, "cardBacks", p.cardBack)}</select></div>
      </div>
      <div id="settingsStatus" class="modalStatus"></div>
      <div class="modalActions"><button id="saveProfileBtn" class="primaryBtn" type="button">Save profile</button></div>
    </section>
    <section class="profileSection wide dangerZone">
      <h3>Password</h3>
      <div class="settingsGrid">
        <div class="fieldStack"><label for="currentPassword">Current password</label><input id="currentPassword" type="password" autocomplete="current-password" /></div>
        <div class="fieldStack"><label for="nextPassword">New password</label><input id="nextPassword" type="password" autocomplete="new-password" /></div>
      </div>
      <div id="passwordStatus" class="modalStatus"></div>
      <div class="modalActions"><button id="changePasswordBtn" type="button">Change password</button></div>
    </section>
    <section class="profileSection wide dangerZone">
      <h3>Account</h3>
      <div class="modalActions">
        <button id="logoutBtn" type="button">Log out</button>
        <button id="deleteAccountBtn" class="dangerBtn" type="button">Delete account</button>
      </div>
    </section>
  `;
}

function renderInsights(user) {
  const i = user.insights || {};
  return `
    <div class="profileList">
      <div><span>Win rate as White</span><strong>${n(i.whiteWinRate)}%</strong></div>
      <div><span>Win rate as Black</span><strong>${n(i.blackWinRate)}%</strong></div>
      <div><span>Best opening style</span><strong>${escapeHtml(i.bestOpeningStyle || "Not enough data")}</strong></div>
      <div><span>Strongest time of day</span><strong>${escapeHtml(i.strongestTimeOfDay || "Not enough data")}</strong></div>
      <div><span>Rule win rates</span><strong>${escapeHtml(i.bestRuleWinRate || "No rule wins yet")}</strong></div>
      <div><span>Average blunder rate</span><strong>${escapeHtml(i.averageBlunderRate || "Not tracked yet")}</strong></div>
    </div>
  `;
}

function renderAdminTab(user) {
  if (!user?.isAdmin) return `<div class="modalStatus">Admin only.</div>`;

  const flags = state.adminFlags;
  const users = Array.isArray(state.adminUsers) ? state.adminUsers : null;
  const selected = state.adminSelectedUserId && users ? users.find((u) => u.id === state.adminSelectedUserId) : null;

  const debugChecked = flags?.debugMode ? "checked" : "";
  const debugLabel = flags ? (flags.debugMode ? "Debug mode is ON" : "Debug mode is OFF") : "Debug mode (load flags)";

  const userOptions = users
    ? users
        .map(
          (u) =>
            `<option value="${escapeAttr(u.id)}"${u.id === state.adminSelectedUserId ? " selected" : ""}>${escapeHtml(u.username || u.id)}</option>`
        )
        .join("")
    : `<option value="">(load users)</option>`;

  const draft = state.adminUserDraft || (selected ? JSON.stringify(selected, null, 2) : "");

  return `
    <section class="profileSection wide">
      <h3>Admin</h3>
      <div class="settingsGrid">
        <div class="fieldStack wide">
          <label>
            <input id="adminDebugToggle" type="checkbox" ${debugChecked} ${flags ? "" : "disabled"} />
            ${escapeHtml(debugLabel)}
          </label>
          <div class="modalActions">
            <button id="adminLoadFlagsBtn" type="button">Load flags</button>
            <button id="adminRefreshUsersBtn" type="button">Refresh users</button>
          </div>
        </div>
        <div class="fieldStack wide">
          <label for="adminUserSelect">Select user</label>
          <select id="adminUserSelect">${userOptions}</select>
        </div>
        <div class="fieldStack wide">
          <label for="adminUserJson">Edit (JSON)</label>
          <textarea id="adminUserJson" spellcheck="false" rows="14" placeholder="Load users, pick one, edit JSON here...">${escapeHtml(draft)}</textarea>
        </div>
      </div>
      <div id="adminStatus" class="modalStatus"></div>
      <div class="modalActions">
        <button id="adminSaveUserBtn" class="primaryBtn" type="button" ${selected ? "" : "disabled"}>Save user</button>
      </div>
    </section>
  `;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function setAdminStatus(text) {
  const status = document.getElementById("adminStatus");
  if (status) status.textContent = text || "";
}

function selectedAdminUser() {
  if (!Array.isArray(state.adminUsers) || !state.adminSelectedUserId) return null;
  return state.adminUsers.find((u) => u.id === state.adminSelectedUserId) || null;
}

async function adminLoadFlags() {
  setAdminStatus("");
  try {
    const res = await fetch("/api/admin/flags", { headers: authHeaders(), cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load flags.");
    state.adminFlags = json.flags || null;
    renderProfile();
  } catch (err) {
    setAdminStatus(err.message || "Failed to load flags.");
  }
}

async function adminSetDebugMode(enabled) {
  setAdminStatus("");
  try {
    const res = await fetch("/api/admin/flags", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ debugMode: !!enabled }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to update flags.");
    state.adminFlags = json.flags || null;
    renderProfile();
  } catch (err) {
    setAdminStatus(err.message || "Failed to update flags.");
    renderProfile();
  }
}

async function adminRefreshUsers() {
  setAdminStatus("");
  try {
    const res = await fetch("/api/admin/users", { headers: authHeaders(), cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load users.");
    state.adminUsers = Array.isArray(json.users) ? json.users : [];
    if (state.adminSelectedUserId && !state.adminUsers.some((u) => u.id === state.adminSelectedUserId)) {
      state.adminSelectedUserId = null;
      state.adminUserDraft = "";
    }
    renderProfile();
  } catch (err) {
    setAdminStatus(err.message || "Failed to load users.");
  }
}

function adminSelectUser(userId) {
  state.adminSelectedUserId = userId || null;
  const user = selectedAdminUser();
  state.adminUserDraft = user ? JSON.stringify(user, null, 2) : "";
  setAdminStatus("");
  renderProfile();
}

function adminUpdateDraft(text) {
  state.adminUserDraft = String(text ?? "");
}

async function adminSaveUser() {
  const user = selectedAdminUser();
  if (!user) return;
  setAdminStatus("");
  let parsed;
  try {
    parsed = JSON.parse(state.adminUserDraft || "{}");
  } catch (err) {
    setAdminStatus(`Invalid JSON: ${err.message || "parse error"}`);
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ user: parsed }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to save user.");
    setAdminStatus("Saved.");
    await adminRefreshUsers();
    adminSelectUser(user.id);
  } catch (err) {
    setAdminStatus(err.message || "Failed to save user.");
  }
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: "{}" });
  } catch {
    // ignore
  }
  state.authToken = null;
  state.account = null;
  saveAccountSession();
  renderAccountUI();
  closeProfileModal();
}

function profileValue(id) {
  return document.getElementById(id)?.value || "";
}

async function saveProfileSettings() {
  const status = document.getElementById("settingsStatus");
  if (status) status.textContent = "";
  try {
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        username: profileValue("settingsUsername"),
        avatar: profileValue("settingsAvatar"),
        banner: profileValue("settingsBanner"),
        country: profileValue("settingsCountry"),
        bio: profileValue("settingsBio"),
        boardSkin: profileValue("settingsBoardSkin"),
        pieceSkin: profileValue("settingsPieceSkin"),
        border: profileValue("settingsBorder"),
        emote: profileValue("settingsEmote"),
        cardBack: profileValue("settingsCardBack"),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Save failed.");
    state.account = json.user;
    saveAccountSession();
    renderAccountUI();
    renderProfile();
    const nextStatus = document.getElementById("settingsStatus");
    if (nextStatus) nextStatus.textContent = "Saved.";
  } catch (err) {
    if (status) status.textContent = err.message || "Save failed.";
  }
}

async function changePassword() {
  const status = document.getElementById("passwordStatus");
  if (status) status.textContent = "";
  try {
    const res = await fetch("/api/me/password", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: profileValue("currentPassword"),
        nextPassword: profileValue("nextPassword"),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Password change failed.");
    if (status) status.textContent = "Password changed.";
    const current = document.getElementById("currentPassword");
    const next = document.getElementById("nextPassword");
    if (current) current.value = "";
    if (next) next.value = "";
  } catch (err) {
    if (status) status.textContent = err.message || "Password change failed.";
  }
}

async function addFriend() {
  const input = document.getElementById("friendUsername");
  const username = input?.value.trim() || "";
  if (!username) return;
  try {
    const res = await fetch("/api/me/friends", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Add friend failed.");
    state.account = json.user;
    saveAccountSession();
    renderProfile();
  } catch (err) {
    logLine(`<strong>Profile</strong>: ${escapeHtml(err.message || "Add friend failed.")}`);
  }
}

async function buyCosmetic(group, name) {
  try {
    const res = await fetch("/api/me/shop/buy", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ group, name }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Purchase failed.");
    state.account = json.user;
    saveAccountSession();
    renderAccountUI();
    if (els.profileModal && !els.profileModal.hidden) renderProfile();
    if (els.shopModal && !els.shopModal.hidden) await loadDailyShop();
  } catch (err) {
    if (els.shopStatus && els.shopModal && !els.shopModal.hidden) els.shopStatus.textContent = err.message || "Purchase failed.";
    else logLine(`<strong>Shop</strong>: ${escapeHtml(err.message || "Purchase failed.")}`);
  }
}

async function deleteAccount() {
  if (!confirm("Delete this account permanently?")) return;
  try {
    await fetch("/api/me", { method: "DELETE", headers: authHeaders() });
  } catch {
    // ignore
  }
  state.authToken = null;
  state.account = null;
  saveAccountSession();
  renderAccountUI();
  closeProfileModal();
}

function updateBodyState() {
  document.body.classList.toggle("is-connected", state.connected);
  document.body.classList.toggle("is-in-game", !!state.lobby);
  if (!state.lobby) {
    document.body.classList.remove("is-choosing");
    document.body.classList.remove("is-debug-choice");
  }
}

loadAccountSession();
loadSession();
renderAccountUI();
refreshAccount();

function logLine(html) {
  const div = document.createElement("div");
  div.className = "logLine";
  div.innerHTML = html;
  els.log.prepend(div);
}

function setOverlay(text) {
  els.overlayText.textContent = text || "";
  els.overlayText.classList.toggle("show", !!text);
}

function nowMs() {
  return performance.now();
}

function playSound(type) {
  // Tiny WebAudio sfx without external assets.
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const audio = new AudioCtx();
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.connect(g);
  g.connect(audio.destination);
  o.type = type === "explosion" ? "sawtooth" : "triangle";
  o.frequency.value = type === "explosion" ? 90 : 520;
  g.gain.setValueAtTime(0.0001, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.22);
  o.start();
  o.stop(audio.currentTime + 0.24);
  setTimeout(() => audio.close(), 260);
}

function spawnParticles(squares, color) {
  const size = els.canvas.width / 8;
  for (const sq of squares) {
    const { x, y } = squareToCanvasCenter(sq);
    for (let i = 0; i < 16; i++) {
      state.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 480,
        vy: (Math.random() - 0.5) * 480,
        life: 400 + Math.random() * 450,
        born: nowMs(),
        color,
        r: 2 + Math.random() * 3,
      });
    }
    // Quick flash ring
    state.particles.push({ ring: true, x, y, life: 220, born: nowMs(), color, r: size * 0.1 });
  }
}

function algebraic(sq) {
  const file = sq % 8;
  const rank = Math.floor(sq / 8);
  return String.fromCharCode(97 + file) + (rank + 1);
}

function canvasToSquare(px, py) {
  const { x, y } = canvasPoint(px, py);
  const size = els.canvas.width / 8;
  let file = Math.floor(x / size);
  let rank = 7 - Math.floor(y / size);

  if (state.flipVisual) {
    file = 7 - file;
    rank = 7 - rank;
  }
  return rank * 8 + file;
}

function canvasPoint(px, py) {
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: ((px - rect.left) / rect.width) * els.canvas.width,
    y: ((py - rect.top) / rect.height) * els.canvas.height,
  };
}

function squareToCanvasCenter(sq) {
  const size = els.canvas.width / 8;
  let file = sq % 8;
  let rank = Math.floor(sq / 8);
  if (state.flipVisual) {
    file = 7 - file;
    rank = 7 - rank;
  }
  const x = (file + 0.5) * size;
  const y = (7 - rank + 0.5) * size;
  return { x, y };
}

function cosmeticSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function playerForColor(color) {
  return (state.serverState?.players || []).find((p) => p.color === color) || null;
}

function playerForId(playerId) {
  return (state.serverState?.players || []).find((p) => p.id === playerId) || null;
}

function profileForColor(color) {
  return playerForColor(color)?.profile || null;
}

function profileForPlayerId(playerId) {
  return playerForId(playerId)?.profile || null;
}

function localProfile() {
  return profileForPlayerId(state.playerId) || state.account?.profile || {};
}

function boardPalette(name) {
  const skin = cosmeticSlug(name || "Classic Chaos");
  const palettes = {
    "lava-board": { light: "#4b1d24", dark: "#170e14", accent: "#ffb15c", texture: "lava" },
    midnight: { light: "#27345f", dark: "#0b1022", accent: "#7bd3ff", texture: "stars" },
    "candy-clash": { light: "#ffe9f4", dark: "#74d7d0", accent: "#ff4f8b", texture: "candy" },
    "arcade-grid": { light: "#142446", dark: "#07101f", accent: "#24d6c8", texture: "grid" },
    "royal-marble": { light: "#f5f0df", dark: "#7b83a7", accent: "#d19b38", texture: "marble" },
    "forest-tactics": { light: "#cfe8bd", dark: "#2f6b4f", accent: "#9cff6b", texture: "forest" },
    "frosted-glass": { light: "#e9fbff", dark: "#7aa9c7", accent: "#d7e7ff", texture: "frost" },
    "desert-mirage": { light: "#f6d89b", dark: "#a76e38", accent: "#ff8a5c", texture: "desert" },
    "cyber-circuit": { light: "#18213b", dark: "#030711", accent: "#8c6cff", texture: "grid" },
    monochrome: { light: "#e8e8e8", dark: "#2b2d33", accent: "#ffffff", texture: "marble" },
  };
  return palettes[skin] || { light: "#dbe2ff", dark: "#3c4b83", accent: "#24d6c8", texture: "classic" };
}

function hazardFill(base, type, light) {
  if (type === "lava") return light ? "#ffb4b4" : "#c24848";
  if (type === "deadly") return light ? "#ffd7a8" : "#9a5520";
  if (type === "lightning") return light ? "#fff1a8" : "#b88d1c";
  if (type === "missing") return "rgba(10,12,18,0.65)";
  return base;
}

function drawBoardTile(sq, x, y, size, light, palette, s, t) {
  let hazard = "";
  if (s.hazards?.lava?.includes(sq)) hazard = "lava";
  if (s.hazards?.deadly?.includes(sq)) hazard = "deadly";
  if (s.marks?.lightning?.includes(sq)) hazard = "lightning";
  if (s.missingSquares?.includes(sq)) hazard = "missing";

  ctx.fillStyle = hazardFill(light ? palette.light : palette.dark, hazard, light);
  ctx.fillRect(x, y, size, size);

  if (hazard && hazard !== "missing") return;
  ctx.save();
  ctx.globalAlpha = light ? 0.18 : 0.26;
  if (palette.texture === "lava") {
    ctx.strokeStyle = light ? "#ff8b4a" : "#ff4f5d";
    ctx.lineWidth = Math.max(1, size * 0.018);
    ctx.beginPath();
    ctx.moveTo(x + size * 0.15, y + size * (0.25 + 0.08 * Math.sin(t / 700 + sq)));
    ctx.lineTo(x + size * 0.48, y + size * 0.52);
    ctx.lineTo(x + size * 0.82, y + size * (0.38 + 0.08 * Math.cos(t / 820 + sq)));
    ctx.stroke();
  } else if (palette.texture === "stars") {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x + size * (((sq * 17) % 71) / 80 + 0.06), y + size * (((sq * 29) % 67) / 80 + 0.08), Math.max(1, size * 0.012), 0, Math.PI * 2);
    ctx.fill();
  } else if (palette.texture === "candy") {
    ctx.strokeStyle = light ? "#ff8ab0" : "#f8ffdc";
    ctx.lineWidth = Math.max(2, size * 0.028);
    ctx.beginPath();
    ctx.moveTo(x + size * 0.12, y + size * 0.88);
    ctx.lineTo(x + size * 0.88, y + size * 0.12);
    ctx.stroke();
  } else if (palette.texture === "grid") {
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + size * 0.11, y + size * 0.11, size * 0.78, size * 0.78);
  } else if (palette.texture === "marble") {
    ctx.strokeStyle = light ? "#c9b27a" : "#d8dff6";
    ctx.lineWidth = Math.max(1, size * 0.014);
    ctx.beginPath();
    ctx.moveTo(x + size * 0.08, y + size * 0.32);
    ctx.bezierCurveTo(x + size * 0.32, y + size * 0.15, x + size * 0.56, y + size * 0.85, x + size * 0.92, y + size * 0.62);
    ctx.stroke();
  } else if (palette.texture === "forest") {
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.ellipse(x + size * 0.26, y + size * 0.28, size * 0.06, size * 0.13, -0.55, 0, Math.PI * 2);
    ctx.ellipse(x + size * 0.68, y + size * 0.72, size * 0.05, size * 0.12, 0.7, 0, Math.PI * 2);
    ctx.fill();
  } else if (palette.texture === "frost") {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, size * 0.014);
    ctx.beginPath();
    ctx.moveTo(x + size * 0.5, y + size * 0.2);
    ctx.lineTo(x + size * 0.5, y + size * 0.8);
    ctx.moveTo(x + size * 0.24, y + size * 0.35);
    ctx.lineTo(x + size * 0.76, y + size * 0.65);
    ctx.stroke();
  } else if (palette.texture === "desert") {
    ctx.strokeStyle = "#ffe2a8";
    ctx.lineWidth = Math.max(1, size * 0.018);
    ctx.beginPath();
    ctx.arc(x + size * 0.4, y + size * 0.85, size * 0.44, Math.PI * 1.08, Math.PI * 1.82);
    ctx.stroke();
  }
  ctx.restore();
}

function activeRuleIds(s) {
  return new Set((s?.activeRules || []).map((r) => r.id));
}

function isFriendlyFireActive(s) {
  return !!s?.colourBlind || (s?.activeRules || []).some((r) => r.id === "dur_friendly_fire_4");
}

function drawTileGlyph(sq, drawFn) {
  const { x, y } = squareToCanvasCenter(sq);
  const size = els.canvas.width / 8;
  ctx.save();
  drawFn(x, y, size);
  ctx.restore();
}

function drawPortalTile(sq, t) {
  drawTileGlyph(sq, (x, y, size) => {
    const pulse = 0.5 + 0.5 * Math.sin(t / 260 + sq);
    const g = ctx.createRadialGradient(x, y, size * 0.08, x, y, size * 0.48);
    g.addColorStop(0, `rgba(244, 214, 255, ${0.58 + pulse * 0.2})`);
    g.addColorStop(0.42, "rgba(158, 87, 255, 0.52)");
    g.addColorStop(1, "rgba(77, 24, 144, 0.2)");
    ctx.fillStyle = g;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeStyle = "rgba(221, 174, 255, 0.88)";
    ctx.lineWidth = Math.max(2, size * 0.035);
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.ellipse(x, y, size * (0.28 + i * 0.08), size * (0.12 + i * 0.04), t / 700 + i * 1.7, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function drawBlackHoleTile(sq, t) {
  drawTileGlyph(sq, (x, y, size) => {
    const r = size * 0.34;
    const g = ctx.createRadialGradient(x, y, size * 0.05, x, y, r * 1.5);
    g.addColorStop(0, "#010207");
    g.addColorStop(0.45, "#05060d");
    g.addColorStop(0.62, "rgba(101, 52, 178, 0.85)");
    g.addColorStop(1, "rgba(36, 214, 200, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(196, 141, 255, 0.86)";
    ctx.lineWidth = Math.max(2, size * 0.03);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.2, r * 0.46, t / 620, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 209, 102, 0.42)";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.35, r * 0.3, -t / 760, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function drawAsteroidTile(sq, t) {
  drawTileGlyph(sq, (x, y, size) => {
    ctx.fillStyle = "rgba(154, 102, 55, 0.72)";
    ctx.strokeStyle = "rgba(255, 218, 158, 0.68)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + t / 1200;
      const px = x + Math.cos(a) * size * 0.18;
      const py = y + Math.sin(a * 1.2) * size * 0.16;
      ctx.beginPath();
      ctx.arc(px, py, size * (0.055 + i * 0.01), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
}

function drawPlagueTile(sq, t) {
  drawTileGlyph(sq, (x, y, size) => {
    const pulse = 0.5 + 0.5 * Math.sin(t / 220 + sq);
    ctx.fillStyle = `rgba(122, 255, 102, ${0.20 + pulse * 0.16})`;
    ctx.strokeStyle = `rgba(122, 255, 102, ${0.58 + pulse * 0.28})`;
    ctx.lineWidth = Math.max(2, size * 0.035);
    ctx.beginPath();
    ctx.arc(x, y, size * (0.25 + pulse * 0.04), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = t / 450 + i * 1.25;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * size * 0.22, y + Math.sin(a) * size * 0.22, size * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawSwapTile(sq, t) {
  drawTileGlyph(sq, (x, y, size) => {
    ctx.strokeStyle = "rgba(255, 209, 102, 0.9)";
    ctx.lineWidth = Math.max(2, size * 0.035);
    ctx.setLineDash([size * 0.08, size * 0.06]);
    ctx.lineDashOffset = -t / 34;
    ctx.strokeRect(x - size * 0.34, y - size * 0.34, size * 0.68, size * 0.68);
    ctx.setLineDash([]);
    ctx.font = `${Math.floor(size * 0.28)}px "Segoe UI Symbol", sans-serif`;
    ctx.fillStyle = "rgba(255, 209, 102, 0.94)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u21c4", x, y);
  });
}

function drawGhostTile(sq, t) {
  drawTileGlyph(sq, (x, y, size) => {
    const a = 0.22 + Math.sin(t / 360 + sq) * 0.06;
    ctx.fillStyle = `rgba(210, 230, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(x, y - size * 0.04, size * 0.22, Math.PI, 0);
    ctx.lineTo(x + size * 0.22, y + size * 0.2);
    ctx.quadraticCurveTo(x + size * 0.1, y + size * 0.12, x, y + size * 0.2);
    ctx.quadraticCurveTo(x - size * 0.1, y + size * 0.12, x - size * 0.22, y + size * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(15, 22, 38, 0.46)";
    ctx.beginPath();
    ctx.arc(x - size * 0.07, y - size * 0.04, size * 0.025, 0, Math.PI * 2);
    ctx.arc(x + size * 0.07, y - size * 0.04, size * 0.025, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawStickyTile(sq, t) {
  drawTileGlyph(sq, (x, y, size) => {
    const g = ctx.createRadialGradient(x, y, size * 0.05, x, y, size * 0.42);
    g.addColorStop(0, "rgba(255, 209, 102, 0.34)");
    g.addColorStop(1, "rgba(255, 79, 139, 0.05)");
    ctx.fillStyle = g;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeStyle = "rgba(255, 209, 102, 0.48)";
    ctx.lineWidth = Math.max(2, size * 0.025);
    for (let i = 0; i < 3; i++) {
      const yy = y - size * 0.18 + i * size * 0.18 + Math.sin(t / 300 + i) * size * 0.02;
      ctx.beginPath();
      ctx.moveTo(x - size * 0.24, yy);
      ctx.quadraticCurveTo(x, yy + size * 0.08, x + size * 0.24, yy);
      ctx.stroke();
    }
  });
}

function drawFanVisual(fan, t) {
  const rank = fan.rank;
  if (rank == null) return;
  const size = els.canvas.width / 8;
  const y = squareToCanvasCenter(toIdxSafe(0, rank)).y;
  const blowingRight = state.flipVisual ? fan.dir < 0 : fan.dir > 0;
  const fanX = blowingRight ? -size * 0.16 : els.canvas.width + size * 0.16;
  const bodyX = blowingRight ? size * 0.16 : els.canvas.width - size * 0.16;

  ctx.save();
  ctx.fillStyle = "rgba(10, 18, 35, 0.92)";
  ctx.strokeStyle = "rgba(36, 214, 200, 0.82)";
  ctx.lineWidth = Math.max(2, size * 0.03);
  ctx.beginPath();
  ctx.arc(bodyX, y, size * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.translate(bodyX, y);
  ctx.rotate(t / 120);
  ctx.fillStyle = "rgba(123, 211, 255, 0.76)";
  for (let i = 0; i < 3; i++) {
    ctx.rotate((Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.ellipse(size * 0.12, 0, size * 0.17, size * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(123, 211, 255, 0.5)";
  ctx.lineWidth = Math.max(2, size * 0.026);
  ctx.setLineDash([size * 0.18, size * 0.16]);
  ctx.lineDashOffset = (blowingRight ? -1 : 1) * (t / 18);
  for (let i = -1; i <= 1; i++) {
    const yy = y + i * size * 0.18;
    ctx.beginPath();
    ctx.moveTo(fanX, yy);
    ctx.lineTo(blowingRight ? els.canvas.width + size * 0.2 : -size * 0.2, yy + Math.sin(t / 300 + i) * size * 0.04);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawBoardEffects(s, t) {
  const ids = activeRuleIds(s);
  const size = els.canvas.width / 8;

  if (ids.has("dur_ice_board_5")) {
    const g = ctx.createLinearGradient(0, 0, els.canvas.width, els.canvas.height);
    g.addColorStop(0, "rgba(215, 247, 255, 0.30)");
    g.addColorStop(0.5, "rgba(123, 211, 255, 0.12)");
    g.addColorStop(1, "rgba(238, 252, 255, 0.24)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.strokeStyle = "rgba(238, 252, 255, 0.35)";
    ctx.lineWidth = 2;
    for (let i = -8; i < 16; i++) {
      ctx.beginPath();
      ctx.moveTo(i * size * 0.7 + (t % 800) / 800 * size, 0);
      ctx.lineTo(i * size * 0.7 + size * 1.8, els.canvas.height);
      ctx.stroke();
    }
  }

  if (ids.has("dur_wrap_8") || s.permanent?.wrapEdges) {
    ctx.strokeStyle = "rgba(255, 209, 102, 0.82)";
    ctx.lineWidth = Math.max(3, size * 0.045);
    ctx.setLineDash([size * 0.16, size * 0.12]);
    ctx.lineDashOffset = -t / 28;
    ctx.strokeRect(size * 0.04, size * 0.04, els.canvas.width - size * 0.08, els.canvas.height - size * 0.08);
    ctx.setLineDash([]);
  }

  if (ids.has("dur_gravity_6") || s.permanent?.gravity) {
    ctx.strokeStyle = "rgba(156, 255, 107, 0.24)";
    ctx.lineWidth = Math.max(2, size * 0.022);
    const down = !state.flipVisual;
    for (let file = 0; file < 8; file++) {
      const x = squareToCanvasCenter(toIdxSafe(file, 0)).x;
      ctx.beginPath();
      ctx.moveTo(x, size * 0.18);
      ctx.lineTo(x, els.canvas.height - size * 0.18);
      ctx.stroke();
      ctx.beginPath();
      const tipY = down ? els.canvas.height - size * 0.18 : size * 0.18;
      const wingY = down ? tipY - size * 0.10 : tipY + size * 0.10;
      ctx.moveTo(x - size * 0.05, wingY);
      ctx.lineTo(x, tipY);
      ctx.lineTo(x + size * 0.05, wingY);
      ctx.stroke();
    }
  }

  if (ids.has("dur_bumper_board_5")) {
    ctx.strokeStyle = "rgba(255, 79, 139, 0.86)";
    ctx.lineWidth = Math.max(4, size * 0.055);
    ctx.setLineDash([size * 0.1, size * 0.08]);
    ctx.lineDashOffset = t / 32;
    ctx.strokeRect(size * 0.08, size * 0.08, els.canvas.width - size * 0.16, els.canvas.height - size * 0.16);
    ctx.setLineDash([]);
  }

  if (ids.has("dur_friendly_fire_4") || s.colourBlind) {
    ctx.fillStyle = "rgba(255, 79, 139, 0.08)";
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  }

  if (ids.has("dur_king_of_hill_6")) {
    for (const sq of [27, 28, 35, 36]) {
      drawTileGlyph(sq, (x, y, tile) => {
        ctx.fillStyle = "rgba(255, 209, 102, 0.24)";
        ctx.strokeStyle = "rgba(255, 209, 102, 0.78)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, tile * (0.28 + Math.sin(t / 320) * 0.025), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
  }

  if (ids.has("dur_teleporter_corners_8")) {
    for (const sq of [0, 7, 56, 63]) drawPortalTile(sq, t);
  }

  for (const sq of s.marks?.blackHole || []) drawBlackHoleTile(sq, t);
  for (const sq of s.marks?.plague || []) drawPlagueTile(sq, t);
  for (const sq of s.marks?.swap || []) drawSwapTile(sq, t);
  for (const sq of s.ghostSquares || []) drawGhostTile(sq, t);
  for (const sq of s.stickySquares || []) drawStickyTile(sq, t);
  for (const sq of s.hazards?.asteroid || []) drawAsteroidTile(sq, t);
  for (const market of s.supermarkets || []) drawSupermarketTile(market.square, t);
  for (const fan of s.fans || []) drawFanVisual(fan, t);
}

function drawHazardGlyphs(s, t) {
  for (const sq of s.hazards?.lava || []) {
    drawTileGlyph(sq, (x, y, size) => {
      ctx.fillStyle = "rgba(255, 88, 52, 0.42)";
      ctx.beginPath();
      ctx.arc(x, y + Math.sin(t / 280 + sq) * size * 0.03, size * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 220, 118, 0.56)";
      ctx.beginPath();
      ctx.arc(x - size * 0.08, y - size * 0.03, size * 0.08, 0, Math.PI * 2);
      ctx.arc(x + size * 0.1, y + size * 0.06, size * 0.06, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  for (const sq of s.marks?.lightning || []) {
    drawTileGlyph(sq, (x, y, size) => {
      ctx.strokeStyle = "rgba(255, 238, 119, 0.92)";
      ctx.fillStyle = "rgba(255, 238, 119, 0.2)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + size * 0.04, y - size * 0.32);
      ctx.lineTo(x - size * 0.1, y);
      ctx.lineTo(x + size * 0.08, y);
      ctx.lineTo(x - size * 0.04, y + size * 0.32);
      ctx.stroke();
      ctx.fillRect(x - size * 0.32, y - size * 0.32, size * 0.64, size * 0.64);
    });
  }
}

function drawSupermarketTile(sq, t) {
  drawTileGlyph(sq, (x, y, size) => {
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(t / 260 + sq);

    ctx.fillStyle = `rgba(156, 255, 107, ${0.11 + pulse * 0.05})`;
    ctx.beginPath();
    ctx.arc(x, y, size * (0.45 + pulse * 0.025), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(19, 28, 45, 0.92)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = Math.max(2, size * 0.025);
    ctx.beginPath();
    ctx.roundRect(x - size * 0.34, y - size * 0.16, size * 0.68, size * 0.36, size * 0.045);
    ctx.fill();
    ctx.stroke();

    const awningY = y - size * 0.31;
    const stripeW = size * 0.12;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#ff4f8b" : "#fff7e8";
      ctx.beginPath();
      ctx.roundRect(x - size * 0.36 + i * stripeW, awningY, stripeW + 1, size * 0.15, size * 0.018);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(17, 24, 39, 0.45)";
    ctx.strokeRect(x - size * 0.36, awningY, size * 0.72, size * 0.15);

    ctx.fillStyle = "rgba(123, 211, 255, 0.42)";
    ctx.fillRect(x - size * 0.25, y - size * 0.07, size * 0.18, size * 0.14);
    ctx.fillRect(x + size * 0.07, y - size * 0.07, size * 0.18, size * 0.14);
    ctx.fillStyle = "rgba(255, 209, 102, 0.9)";
    ctx.fillRect(x - size * 0.055, y + size * 0.005, size * 0.11, size * 0.19);

    ctx.fillStyle = "rgba(16, 24, 39, 0.92)";
    ctx.font = `${Math.floor(size * 0.13)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SHOP", x, y - size * 0.235);

    ctx.strokeStyle = `rgba(156, 255, 107, ${0.42 + pulse * 0.20})`;
    ctx.lineWidth = Math.max(2, size * 0.018);
    ctx.beginPath();
    ctx.arc(x, y, size * 0.43, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

function renderSupermarket() {
  const s = state.serverState;
  const shop = s?.supermarket;
  const active = !!shop?.active && s?.phase === "supermarket";
  if (!els.supermarketModal) return;
  els.supermarketModal.hidden = !active;
  if (!active) {
    state.supermarketKey = null;
    state.supermarketItems = { p: 0, n: 0, b: 0, r: 0, q: 0 };
    return;
  }

  const key = `${shop.playerId}|${shop.square}|${shop.budget}`;
  if (state.supermarketKey !== key) {
    state.supermarketKey = key;
    state.supermarketItems = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  }

  const costs = shop.costs || { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const total = Object.entries(state.supermarketItems).reduce((sum, [type, count]) => sum + (costs[type] || 0) * count, 0);
  const remaining = Math.max(0, (shop.budget || 10) - total);
  const yourShop = shop.playerId === state.playerId;
  if (els.supermarketBudget) els.supermarketBudget.textContent = `${remaining} coins`;
  if (els.supermarketStatus) {
    els.supermarketStatus.textContent = yourShop
      ? `Choose pieces for delivery. Spent ${total}/${shop.budget || 10} coins.`
      : "Opponent is shopping.";
  }

  const labels = [
    ["q", "Queen"],
    ["r", "Rook"],
    ["b", "Bishop"],
    ["n", "Knight"],
    ["p", "Pawn"],
  ];
  if (els.supermarketItems) {
    els.supermarketItems.innerHTML = "";
    for (const [type, label] of labels) {
      const row = document.createElement("div");
      row.className = "shopItem";
      const glyph = PIECE_GLYPH_MONO[type] || type.toUpperCase();
      const count = state.supermarketItems[type] || 0;
      const cost = costs[type] || 0;
      row.innerHTML = `
        <div class="shopGlyph">${glyph}</div>
        <div class="shopMeta"><strong>${label}</strong><span>${cost} coin${cost === 1 ? "" : "s"}</span></div>
        <div class="shopStepper">
          <button type="button" data-delta="-1">-</button>
          <span>${count}</span>
          <button type="button" data-delta="1">+</button>
        </div>
      `;
      for (const btn of row.querySelectorAll("button")) {
        btn.disabled = !yourShop || (Number(btn.dataset.delta) > 0 && remaining < cost);
        btn.addEventListener("click", () => {
          const delta = Number(btn.dataset.delta);
          const next = Math.max(0, (state.supermarketItems[type] || 0) + delta);
          state.supermarketItems[type] = next;
          renderSupermarket();
        });
      }
      els.supermarketItems.appendChild(row);
    }
  }

  if (els.supermarketCheckoutBtn) {
    els.supermarketCheckoutBtn.disabled = !yourShop;
    els.supermarketCheckoutBtn.textContent = yourShop ? "Checkout" : "Waiting...";
  }
}

const AD_VARIANTS = [
  { title: "FREE QUEEN", copy: "Click now to claim unstoppable material advantage!", cta: "Claim", size: "sm", tone: "pink" },
  { title: "Your king is exposed", copy: "Install ShieldMate Pro before it is too late.", cta: "Protect", size: "md", tone: "blue" },
  { title: "Hot pawns nearby", copy: "Meet promoted pawns in your area this turn.", cta: "View", size: "sm", tone: "gold" },
  { title: "Limited rook sale", copy: "Buy one file, dominate every rank. Today only.", cta: "Shop", size: "lg", tone: "green" },
  { title: "You won a castle", copy: "Verify your lobby code to unlock prize castling.", cta: "Verify", size: "md", tone: "purple" },
  { title: "Board cleaner", copy: "Remove lava, ghosts, fans, and consequences instantly.", cta: "Download", size: "lg", tone: "red" },
];

function clearAds() {
  state.ads = [];
  state.nextAdAt = 0;
  if (els.adsLayer) els.adsLayer.innerHTML = "";
}

function spawnAd() {
  if (!els.adsLayer) return;
  const variant = AD_VARIANTS[Math.floor(Math.random() * AD_VARIANTS.length)];
  const id = `ad-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const ad = {
    id,
    ...variant,
    x: Math.random() * 72,
    y: Math.random() * 68,
    rot: (Math.random() - 0.5) * 7,
  };
  state.ads.push(ad);
  renderAds();
}

function renderAds() {
  if (!els.adsLayer) return;
  els.adsLayer.innerHTML = "";
  for (const ad of state.ads) {
    const div = document.createElement("div");
    div.className = `fakeAd ${ad.size} ${ad.tone}`;
    div.style.left = `${ad.x}%`;
    div.style.top = `${ad.y}%`;
    div.style.setProperty("--rot", `${ad.rot}deg`);
    div.innerHTML = `
      <button class="fakeAdClose" type="button" aria-label="Close ad">x</button>
      <div class="fakeAdBadge">AD</div>
      <div class="fakeAdArt" aria-hidden="true"></div>
      <strong>${escapeHtml(ad.title)}</strong>
      <span>${escapeHtml(ad.copy)}</span>
      <button class="fakeAdCta" type="button">${escapeHtml(ad.cta)}</button>
    `;
    div.querySelector(".fakeAdClose")?.addEventListener("click", () => {
      state.ads = state.ads.filter((item) => item.id !== ad.id);
      renderAds();
    });
    div.querySelector(".fakeAdCta")?.addEventListener("click", () => {
      state.ads = state.ads.filter((item) => item.id !== ad.id);
      renderAds();
    });
    els.adsLayer.appendChild(div);
  }
}

function tickAds() {
  const active = !!state.serverState?.adAttack && !!state.lobby;
  if (!active) {
    if (state.ads.length || state.nextAdAt) clearAds();
    return;
  }
  if (!els.adsLayer) return;
  const now = Date.now();
  if (!state.nextAdAt) state.nextAdAt = now;
  if (now >= state.nextAdAt) {
    spawnAd();
    state.nextAdAt = now + 2000;
  }
}

function draw() {
  requestAnimationFrame(draw);
  if (!state.serverState) return;

  const s = state.serverState;
  const size = els.canvas.width / 8;
  const t = nowMs();
  const fogVisible =
    s.fogOfWar && s.fogOfWarSquares && state.color ? new Set(s.fogOfWarSquares[state.color] || []) : null;
  const palette = boardPalette(localProfile().boardSkin);

  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

  // Board.
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const light = (rank + file) % 2 === 0;
      const sq = rank * 8 + file;
      let { x, y } = squareToCanvasCenter(sq);
      x -= size / 2;
      y -= size / 2;

      drawBoardTile(sq, x, y, size, light, palette, s, t);

      if (fogVisible && !fogVisible.has(sq) && !(s.missingSquares || []).includes(sq)) {
        ctx.fillStyle = "rgba(10,12,18,0.55)";
        ctx.fillRect(x, y, size, size);
      }
    }
  }
  drawBoardEffects(s, t);
  drawHazardGlyphs(s, t);

  // Highlights.
  if (state.selected != null) {
    const selectedPiece = s.board[state.selected];
    if (selectedPiece?.tags?.includes("titan")) {
      const box = titanBounds(state.selected);
      ctx.strokeStyle = "rgba(123,211,255,0.9)";
      ctx.lineWidth = 6;
      ctx.strokeRect(box.left - size / 2 + 3, box.top - size / 2 + 3, box.right - box.left + size - 6, box.bottom - box.top + size - 6);
    } else {
      const c = squareToCanvasCenter(state.selected);
      ctx.strokeStyle = "rgba(123,211,255,0.9)";
      ctx.lineWidth = 6;
      ctx.strokeRect(c.x - size / 2 + 3, c.y - size / 2 + 3, size - 6, size - 6);
    }
  }
  if (state.legalTo && state.selected != null) {
    const selectedPiece = s.board[state.selected];
    for (const to of state.legalTo) {
      if (fogVisible && !fogVisible.has(to)) continue;
      if (selectedPiece?.tags?.includes("titan")) {
        const box = titanBounds(to);
        ctx.fillStyle = "rgba(123,211,255,0.16)";
        ctx.strokeStyle = "rgba(123,211,255,0.38)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(box.left - size / 2 + 7, box.top - size / 2 + 7, box.right - box.left + size - 14, box.bottom - box.top + size - 14, 10);
        ctx.fill();
        ctx.stroke();
      } else {
        const c = squareToCanvasCenter(to);
        ctx.fillStyle = "rgba(123,211,255,0.25)";
        ctx.beginPath();
        ctx.arc(c.x, c.y, size * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (s.phase === "mutantFusion" && s.mutantFusion?.playerId === state.playerId) {
    for (const sq of s.mutantFusion.selected || []) {
      const c = squareToCanvasCenter(sq);
      ctx.strokeStyle = "rgba(255, 79, 139, 0.95)";
      ctx.lineWidth = 5;
      ctx.strokeRect(c.x - size / 2 + 7, c.y - size / 2 + 7, size - 14, size - 14);
      ctx.fillStyle = "rgba(255, 79, 139, 0.16)";
      ctx.fillRect(c.x - size / 2 + 8, c.y - size / 2 + 8, size - 16, size - 16);
    }
  }

  // Pieces.
  const titans = [];
  const animatedTargets = animationHiddenSquares(t);
  for (let sq = 0; sq < 64; sq++) {
    if (animatedTargets.has(sq)) continue;
    const p = s.board[sq];
    if (!p) continue;
    if (p.tags?.includes("titanBody")) continue;
    if (p.tags?.includes("titan")) {
      titans.push({ sq, p });
      continue;
    }
    if (fogVisible && p.color !== state.color && p.color !== "x" && !fogVisible.has(sq)) continue;
    if (s.invisiblePieces && !(s.visibleSquares || []).includes(sq) && p.type !== "k") continue;
    if (p.color === "x") {
      drawBlock(sq);
      continue;
    }
    drawPiece(sq, p);
  }
  for (const { sq, p } of titans) drawTitanPiece(sq, p);
  drawLawnmowers(t);
  drawAnimations(t);
  drawSupplyDrops(t);
  drawBullets(t);

  // Particles.
  const next = [];
  for (const part of state.particles) {
    const age = t - part.born;
    if (age > part.life) continue;
    const a = 1 - age / part.life;
    if (part.ring) {
      ctx.strokeStyle = part.color;
      ctx.globalAlpha = a * 0.75;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(part.x, part.y, part.r + (1 - a) * 70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      next.push(part);
      continue;
    }
    const dt = 1 / 60;
    part.x += part.vx * dt;
    part.y += part.vy * dt;
    part.vx *= 0.98;
    part.vy *= 0.98;
    ctx.fillStyle = part.color;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(part.x, part.y, part.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    next.push(part);
  }
  state.particles = next;

  // Overlay text.
  const yourTurn = s.turn === state.color && s.phase === "play";
  const msg =
    s.phase === "ruleChoice"
      ? "Rule choice!"
      : s.phase === "bonusRuleChoice"
        ? "Bonus rule picks!"
      : s.phase === "targetRule"
        ? s.pendingTargetRule?.playerId === state.playerId
          ? (s.pendingTargetRule.prompt || "Choose a target")
          : "Opponent choosing a rule target"
      : s.phase === "mutantFusion"
        ? s.mutantFusion?.playerId === state.playerId
          ? "Select pieces to fuse"
          : "Opponent making a mutant"
      : s.phase === "pawnSoldierShot"
        ? s.pendingPawnSoldierShot?.playerId === state.playerId
          ? "Click a square to fire"
          : "Opponent firing"
      : s.phase === "supermarket"
        ? s.supermarket?.playerId === state.playerId
          ? "Supermarket"
          : "Opponent shopping"
      : s.phase === "rps"
        ? "RPS Duel!"
      : s.phase === "wager"
        ? "Coinflip Wager!"
      : s.result
        ? s.result
        : yourTurn
          ? "Your move"
          : "Waiting...";
  setOverlay(msg);
}

function animationHiddenSquares(t) {
  const hidden = new Set();
  for (const anim of state.animations) {
    if (t <= anim.end && anim.to != null) hidden.add(anim.to);
  }
  for (const drop of state.supplyDrops) {
    if (t <= drop.end && drop.sq != null) hidden.add(drop.sq);
  }
  return hidden;
}

function queueMoveAnimation(effect) {
  if (effect.from == null || effect.to == null || !effect.piece) return;
  const now = nowMs();
  const style = effect.style || "move";
  const duration = style === "teleport" ? 520 : style === "fan" ? 760 : style === "ice" ? 620 : 360;
  const start = style === "move" ? now : now + 260;
  state.animations.push({
    id: effect.id,
    from: effect.from,
    to: effect.to,
    piece: effect.piece,
    style,
    start,
    end: start + duration,
  });
}

function drawAnimations(t) {
  const next = [];
  for (const anim of state.animations) {
    if (t < anim.start) {
      next.push(anim);
      continue;
    }
    const duration = Math.max(1, anim.end - anim.start);
    const p = Math.min(1, Math.max(0, (t - anim.start) / duration));
    const eased = anim.style === "fan" || anim.style === "ice" ? 1 - Math.pow(1 - p, 3) : p;
    const a = squareToCanvasCenter(anim.from);
    const b = squareToCanvasCenter(anim.to);
    let x = a.x + (b.x - a.x) * eased;
    let y = a.y + (b.y - a.y) * eased;

    ctx.save();
    if (anim.style === "teleport") {
      const fade = p < 0.5 ? 1 - p * 1.4 : (p - 0.5) * 2;
      x = p < 0.5 ? a.x : b.x;
      y = p < 0.5 ? a.y : b.y;
      ctx.globalAlpha = Math.max(0.18, Math.min(1, fade));
      ctx.strokeStyle = "rgba(196, 141, 255, 0.72)";
      ctx.lineWidth = Math.max(3, els.canvas.width / 8 * 0.045);
      ctx.beginPath();
      ctx.arc(x, y, els.canvas.width / 8 * (0.2 + Math.sin(p * Math.PI) * 0.34), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.94;
      if (anim.style === "fan") {
        ctx.shadowColor = "rgba(123, 211, 255, 0.88)";
        ctx.shadowBlur = 20;
      }
      if (anim.style === "ice") {
        ctx.shadowColor = "rgba(220, 250, 255, 0.95)";
        ctx.shadowBlur = 18;
      }
    }

    drawPieceAt(x, y, anim.piece);
    ctx.restore();
    if (p < 1) next.push(anim);
  }
  state.animations = next;
}

function queueSupplyDrop(effect) {
  const now = nowMs();
  const drops = Array.isArray(effect.drops) ? effect.drops : [];
  drops.forEach((drop, index) => {
    if (drop?.sq == null || !drop.type || !drop.color) return;
    state.supplyDrops.push({
      sq: drop.sq,
      piece: { type: drop.type, color: drop.color, moved: true },
      start: now + index * 180,
      end: now + index * 180 + 1250,
    });
  });
}

function drawSupplyDrops(t) {
  const next = [];
  const tile = els.canvas.width / 8;
  for (const drop of state.supplyDrops) {
    if (t < drop.start) {
      next.push(drop);
      continue;
    }
    const p = Math.min(1, Math.max(0, (t - drop.start) / Math.max(1, drop.end - drop.start)));
    const eased = 1 - Math.pow(1 - p, 3);
    const target = squareToCanvasCenter(drop.sq);
    const sway = Math.sin(t / 180 + drop.sq) * tile * 0.045 * (1 - p);
    const x = target.x + sway;
    const y = target.y - tile * 1.35 * (1 - eased);
    const balloonY = y - tile * 0.48;
    const crateY = y + tile * 0.08;

    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 4);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1.5, tile * 0.018);
    ctx.beginPath();
    ctx.moveTo(x - tile * 0.1, balloonY + tile * 0.18);
    ctx.lineTo(x - tile * 0.16, crateY - tile * 0.15);
    ctx.moveTo(x + tile * 0.1, balloonY + tile * 0.18);
    ctx.lineTo(x + tile * 0.16, crateY - tile * 0.15);
    ctx.stroke();

    const balloonGrad = ctx.createRadialGradient(x - tile * 0.08, balloonY - tile * 0.08, tile * 0.03, x, balloonY, tile * 0.28);
    balloonGrad.addColorStop(0, "#fff7e8");
    balloonGrad.addColorStop(0.42, "#ff8fb1");
    balloonGrad.addColorStop(1, "#ff4f8b");
    ctx.fillStyle = balloonGrad;
    ctx.strokeStyle = "rgba(17,24,39,0.38)";
    ctx.beginPath();
    ctx.ellipse(x, balloonY, tile * 0.24, tile * 0.31, Math.sin(t / 360) * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ff4f8b";
    ctx.beginPath();
    ctx.moveTo(x - tile * 0.045, balloonY + tile * 0.27);
    ctx.lineTo(x + tile * 0.045, balloonY + tile * 0.27);
    ctx.lineTo(x, balloonY + tile * 0.34);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#b8793b";
    ctx.strokeStyle = "rgba(17,24,39,0.5)";
    ctx.lineWidth = Math.max(2, tile * 0.025);
    ctx.beginPath();
    ctx.roundRect(x - tile * 0.24, crateY - tile * 0.16, tile * 0.48, tile * 0.32, tile * 0.035);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,247,232,0.35)";
    ctx.beginPath();
    ctx.moveTo(x - tile * 0.22, crateY);
    ctx.lineTo(x + tile * 0.22, crateY);
    ctx.moveTo(x, crateY - tile * 0.15);
    ctx.lineTo(x, crateY + tile * 0.15);
    ctx.stroke();

    drawPieceAt(x, crateY + tile * 0.03, drop.piece);

    if (p > 0.88) {
      ctx.globalAlpha = (p - 0.88) / 0.12;
      ctx.strokeStyle = "rgba(255,209,102,0.8)";
      ctx.lineWidth = Math.max(2, tile * 0.03);
      ctx.beginPath();
      ctx.arc(target.x, target.y, tile * (0.22 + (p - 0.88) * 1.8), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    if (p < 1) next.push(drop);
  }
  state.supplyDrops = next;
}

function queueBullets(effect) {
  if (effect.from == null || effect.to == null) return;
  const now = nowMs();
  for (let i = 0; i < 3; i++) {
    state.bullets.push({
      from: effect.from,
      to: effect.to,
      start: now + i * 85,
      end: now + i * 85 + 240,
      hit: (effect.hits || [])[i] ?? null,
    });
  }
}

function drawBullets(t) {
  const next = [];
  const size = els.canvas.width / 8;
  for (const bullet of state.bullets) {
    if (t < bullet.start) {
      next.push(bullet);
      continue;
    }
    const p = Math.min(1, Math.max(0, (t - bullet.start) / Math.max(1, bullet.end - bullet.start)));
    const a = squareToCanvasCenter(bullet.from);
    const endSq = bullet.hit != null ? bullet.hit : bullet.to;
    const b = squareToCanvasCenter(endSq);
    const headX = a.x + (b.x - a.x) * p;
    const headY = a.y + (b.y - a.y) * p;
    const tailP = Math.max(0, p - 0.22);
    const tailX = a.x + (b.x - a.x) * tailP;
    const tailY = a.y + (b.y - a.y) * tailP;

    ctx.save();
    ctx.strokeStyle = "rgba(255, 221, 87, 0.95)";
    ctx.lineWidth = Math.max(3, size * 0.045);
    ctx.shadowColor = "rgba(255, 221, 87, 0.9)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 220, 0.95)";
    ctx.beginPath();
    ctx.arc(headX, headY, Math.max(2, size * 0.035), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (p < 1) next.push(bullet);
  }
  state.bullets = next;
}

function queueLawnmower(effect) {
  if (typeof effect.row !== "number") return;
  const now = nowMs();
  state.lawnmowers.push({ row: effect.row, start: now, end: now + 950 });
}

function drawLawnmowers(t) {
  const next = [];
  const size = els.canvas.width / 8;
  for (const mower of state.lawnmowers) {
    const p = Math.min(1, Math.max(0, (t - mower.start) / Math.max(1, mower.end - mower.start)));
    const y = squareToCanvasCenter(toIdxSafe(0, mower.row)).y;
    const x = -size * 0.45 + (els.canvas.width + size * 0.9) * p;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(156, 255, 107, 0.92)";
    ctx.strokeStyle = "rgba(16, 24, 39, 0.78)";
    ctx.lineWidth = Math.max(2, size * 0.025);
    ctx.beginPath();
    ctx.roundRect(-size * 0.28, -size * 0.16, size * 0.56, size * 0.32, size * 0.06);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.arc(i * size * 0.2, size * 0.17, size * 0.06, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (p < 1) next.push(mower);
  }
  state.lawnmowers = next;
}

function pieceGlyph(type, color, colourBlind = false) {
  const map = {
    p: { w: "\u2659", b: "\u265F" },
    n: { w: "\u2658", b: "\u265E" },
    b: { w: "\u2657", b: "\u265D" },
    r: { w: "\u2656", b: "\u265C" },
    q: { w: "\u2655", b: "\u265B" },
    k: { w: "\u2654", b: "\u265A" },
  };
  return (colourBlind ? map[type]?.w : map[type]?.[color]) || "?";
}

function pieceGlyphsFor(p, colourBlind = false) {
  const types = Array.isArray(p?.movesAs) && p.movesAs.length ? p.movesAs : [p?.type];
  return [...new Set(types)].map((type) => pieceGlyph(type, p.color, colourBlind)).filter((glyph) => glyph && glyph !== "?");
}

function pieceSkinFor(p) {
  return profileForColor(p?.color)?.pieceSkin || "Standard";
}

function pieceSkinStyle(p, colourBlind = false) {
  const skin = cosmeticSlug(pieceSkinFor(p));
  if (colourBlind) return { skin, fill: "rgba(210,215,226,0.92)", stroke: "rgba(10,12,18,0.42)", accent: "#7bd3ff" };
  const white = p?.color === "w";
  const styles = {
    "royal-glass": {
      fill: white ? "#ffffff" : "#101422",
      stroke: white ? "rgba(120, 145, 190, 0.78)" : "rgba(236, 242, 255, 0.42)",
      accent: "#d7e7ff",
    },
    "neon-plastic": {
      fill: white ? "#f8fffb" : "#101827",
      stroke: white ? "#24d6c8" : "#ff4f8b",
      accent: white ? "#24d6c8" : "#ff4f8b",
      glow: white ? "rgba(36, 214, 200, 0.82)" : "rgba(255, 79, 139, 0.78)",
    },
    "lava-stone": {
      fill: white ? "#ffe6bd" : "#1a1010",
      stroke: white ? "#9a5520" : "#ff7046",
      accent: "#ff7046",
      glow: "rgba(255, 90, 100, 0.62)",
    },
    "toy-army": {
      fill: white ? "#f5f0d8" : "#18371f",
      stroke: white ? "#9b7f42" : "#9cff6b",
      accent: white ? "#ffd166" : "#9cff6b",
    },
    "void-metal": {
      fill: white ? "#e9e6ff" : "#050711",
      stroke: white ? "#8c6cff" : "#24d6c8",
      accent: white ? "#8c6cff" : "#24d6c8",
      glow: white ? "rgba(140, 108, 255, 0.72)" : "rgba(36, 214, 200, 0.72)",
    },
    "crystal-set": {
      fill: white ? "#ffffff" : "#18213b",
      stroke: white ? "#7bd3ff" : "#d7e7ff",
      accent: "#7bd3ff",
      glow: "rgba(123, 211, 255, 0.62)",
    },
    "brass-engines": {
      fill: white ? "#fff1c2" : "#30200e",
      stroke: "#d19b38",
      accent: "#ffd166",
      glow: "rgba(255, 209, 102, 0.45)",
    },
    "candy-pieces": {
      fill: white ? "#fff7fb" : "#4b1835",
      stroke: white ? "#ff4f8b" : "#74d7d0",
      accent: white ? "#74d7d0" : "#ff4f8b",
    },
    "shadow-ink": {
      fill: white ? "#d8d8e2" : "#03040a",
      stroke: white ? "#384564" : "#c7b7ff",
      accent: "#8c6cff",
      glow: "rgba(140, 108, 255, 0.45)",
    },
    hologram: {
      fill: white ? "rgba(245,255,255,0.88)" : "rgba(16,24,39,0.72)",
      stroke: white ? "#24d6c8" : "#ff4f8b",
      accent: "#d7e7ff",
      glow: "rgba(36, 214, 200, 0.72)",
    },
  };
  return styles[skin] ? { skin, ...styles[skin] } : {
    skin,
    fill: white ? "#fbfbff" : "#101422",
    stroke: white ? "rgba(10,12,18,0.28)" : "rgba(255,255,255,0.18)",
    accent: white ? "#dbe2ff" : "#3c4b83",
  };
}

function drawPieceSkinBase(x, y, size, p, style) {
  const skin = style.skin;
  if (!skin || skin === "standard") return;

  ctx.save();
  if (style.glow) {
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = size * 0.22;
  }

  if (skin === "royal-glass" || skin === "crystal-set" || skin === "hologram") {
    const g = ctx.createRadialGradient(x - size * 0.12, y - size * 0.15, size * 0.05, x, y, size * 0.42);
    g.addColorStop(0, "rgba(255,255,255,0.82)");
    g.addColorStop(0.45, p.color === "w" ? "rgba(215,231,255,0.48)" : "rgba(44,58,92,0.62)");
    g.addColorStop(1, "rgba(255,255,255,0.08)");
    ctx.fillStyle = g;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = Math.max(2, size * 0.026);
    ctx.beginPath();
    ctx.ellipse(x, y + size * 0.03, size * 0.34, size * 0.39, -0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (skin === "neon-plastic") {
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = Math.max(2, size * 0.032);
    ctx.beginPath();
    ctx.arc(x, y, size * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = style.accent;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
  } else if (skin === "lava-stone" || skin === "brass-engines" || skin === "shadow-ink") {
    ctx.fillStyle = p.color === "w" ? "rgba(64, 31, 22, 0.24)" : "rgba(255, 90, 100, 0.14)";
    if (skin === "brass-engines") ctx.fillStyle = "rgba(255, 209, 102, 0.18)";
    if (skin === "shadow-ink") ctx.fillStyle = "rgba(5, 7, 17, 0.34)";
    ctx.beginPath();
    ctx.roundRect(x - size * 0.34, y - size * 0.34, size * 0.68, size * 0.68, size * 0.08);
    ctx.fill();
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = Math.max(1.5, size * 0.018);
    ctx.beginPath();
    ctx.moveTo(x - size * 0.24, y - size * 0.08);
    ctx.lineTo(x - size * 0.04, y + size * 0.08);
    ctx.lineTo(x + size * 0.22, y - size * 0.1);
    ctx.stroke();
    if (skin === "brass-engines") {
      ctx.beginPath();
      ctx.arc(x + size * 0.24, y + size * 0.22, size * 0.07, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (skin === "toy-army" || skin === "candy-pieces") {
    ctx.fillStyle = p.color === "w" ? "rgba(255, 209, 102, 0.22)" : "rgba(156, 255, 107, 0.18)";
    if (skin === "candy-pieces") ctx.fillStyle = p.color === "w" ? "rgba(255, 79, 139, 0.18)" : "rgba(116, 215, 208, 0.18)";
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = Math.max(2, size * 0.025);
    ctx.beginPath();
    ctx.roundRect(x - size * 0.35, y - size * 0.35, size * 0.7, size * 0.7, size * 0.16);
    ctx.fill();
    ctx.stroke();
  } else if (skin === "void-metal") {
    const g = ctx.createLinearGradient(x - size * 0.34, y - size * 0.36, x + size * 0.34, y + size * 0.36);
    g.addColorStop(0, p.color === "w" ? "#ffffff" : "#111827");
    g.addColorStop(0.48, p.color === "w" ? "#aaa4ff" : "#050711");
    g.addColorStop(1, style.accent);
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.moveTo(x, y - size * 0.43);
    ctx.lineTo(x + size * 0.36, y - size * 0.06);
    ctx.lineTo(x + size * 0.22, y + size * 0.38);
    ctx.lineTo(x - size * 0.26, y + size * 0.34);
    ctx.lineTo(x - size * 0.38, y - size * 0.08);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPiece(sq, p) {
  const { x, y } = squareToCanvasCenter(sq);
  drawPieceAt(x, y, p, sq);
}

function drawPieceAt(x, y, p, sq = null) {
  const size = els.canvas.width / 8;
  const colourBlind = !!(state.serverState && state.serverState.colourBlind);
  const shieldCharges =
    p?.type === "k" && p?.color && state.serverState?.shield && typeof state.serverState.shield[p.color] === "number"
      ? state.serverState.shield[p.color]
      : 0;
  const pieceStyle = pieceSkinStyle(p, colourBlind);

  // Subtle glow for last move.
  if (sq != null && (state.serverState.lastMoveSquares || []).includes(sq)) {
    ctx.fillStyle = "rgba(125,255,179,0.18)";
    ctx.beginPath();
    ctx.arc(x, y, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  if (shieldCharges > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(nowMs() / 260 + (sq != null ? sq : 0));
    ctx.strokeStyle = `rgba(123, 211, 255, ${0.45 + pulse * 0.25})`;
    ctx.lineWidth = Math.max(2, size * 0.04);
    ctx.beginPath();
    ctx.arc(x, y, size * (0.44 + pulse * 0.03), 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 209, 102, ${0.18 + pulse * 0.18})`;
    ctx.lineWidth = Math.max(2, size * 0.028);
    for (let i = 0; i < Math.min(2, shieldCharges); i++) {
      ctx.beginPath();
      ctx.ellipse(x, y, size * (0.34 + i * 0.06), size * (0.16 + i * 0.03), nowMs() / 700 + i * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawPieceSkinBase(x, y, size, p, pieceStyle);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = pieceStyle.fill;
  ctx.strokeStyle = pieceStyle.stroke;
  if (pieceStyle.glow) {
    ctx.shadowColor = pieceStyle.glow;
    ctx.shadowBlur = size * 0.08;
  }
  ctx.lineWidth = 4;
  const mutantGlyphs = p.tags?.includes("mutant") ? pieceGlyphsFor(p, colourBlind).slice(0, 5) : null;
  if (mutantGlyphs?.length > 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(nowMs() / 420 + (sq || 0)) * 0.08);
    ctx.font = `${Math.floor(size * 0.36)}px "Segoe UI Symbol", "Noto Sans Symbols2", serif`;
    const spots = [
      [0, -0.18],
      [-0.18, 0.08],
      [0.18, 0.08],
      [-0.08, 0.28],
      [0.12, 0.28],
    ];
    mutantGlyphs.forEach((glyph, i) => {
      const [ox, oy] = spots[i] || [0, 0];
      ctx.strokeText(glyph, ox * size, oy * size + 2);
      ctx.fillText(glyph, ox * size, oy * size);
    });
    ctx.strokeStyle = "rgba(255, 79, 139, 0.86)";
    ctx.lineWidth = Math.max(2, size * 0.025);
    ctx.beginPath();
    ctx.arc(0, size * 0.03, size * 0.37, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.font = `${Math.floor(size * 0.62)}px "Segoe UI Symbol", "Noto Sans Symbols2", serif`;
    const glyph = pieceGlyph(p.type, p.color, colourBlind);
    ctx.strokeText(glyph, x, y + 2);
    ctx.fillText(glyph, x, y);
  }
  ctx.shadowBlur = 0;

  // Rule icon (tiny dot).
  if (p.tags?.includes("tempQueen")) {
    ctx.fillStyle = "rgba(255,229,143,0.9)";
    ctx.beginPath();
    ctx.arc(x + size * 0.28, y - size * 0.28, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
  if (p.tags?.includes("suicideBomber")) {
    ctx.font = `${Math.floor(size * 0.22)}px "Segoe UI Symbol", "Noto Color Emoji", sans-serif`;
    ctx.fillStyle = "#ff4f8b";
    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    ctx.lineWidth = 2;
    ctx.strokeText("\u{1F4A3}", x + size * 0.25, y - size * 0.25);
    ctx.fillText("\u{1F4A3}", x + size * 0.25, y - size * 0.25);
  }
  if (p.tags?.includes("pawnSoldier")) {
    ctx.save();
    ctx.translate(x + size * 0.18, y + size * 0.06);
    ctx.rotate(p.color === "w" ? -0.28 : 0.28);
    ctx.strokeStyle = "#151923";
    ctx.fillStyle = "#151923";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(-size * 0.17, 0);
    ctx.lineTo(size * 0.24, 0);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, size * 0.035);
    ctx.beginPath();
    ctx.moveTo(size * 0.04, 0);
    ctx.lineTo(size * 0.04, size * 0.16);
    ctx.moveTo(-size * 0.06, 0);
    ctx.lineTo(-size * 0.12, size * 0.12);
    ctx.stroke();
    ctx.fillRect(size * 0.22, -size * 0.025, size * 0.12, size * 0.05);
    ctx.restore();
  }
  if (sq != null && state.serverState?.backupVitalSquare === sq) {
    ctx.font = `${Math.floor(size * 0.2)}px "Segoe UI Symbol", "Noto Color Emoji", sans-serif`;
    ctx.fillStyle = "#ff4f8b";
    ctx.strokeStyle = "rgba(0,0,0,0.42)";
    ctx.lineWidth = 2;
    ctx.strokeText("\u2665", x - size * 0.26, y - size * 0.27);
    ctx.fillText("\u2665", x - size * 0.26, y - size * 0.27);
  }
  if (sq != null && p.maxHp && p.hp != null) {
    const w = size * 0.58;
    const h = Math.max(4, size * 0.065);
    const pct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const bx = x - w / 2;
    const by = y - size * 0.46;
    ctx.fillStyle = "rgba(10, 12, 18, 0.72)";
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = pct > 0.5 ? "#7dffb3" : pct > 0.25 ? "#ffd166" : "#ff5c7a";
    ctx.fillRect(bx, by, w * pct, h);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, w, h);
  }
}

function drawTitanPiece(sq, p) {
  const size = els.canvas.width / 8;
  const box = titanBounds(sq);
  const centerX = (box.left + box.right) / 2;
  const centerY = (box.top + box.bottom) / 2;

  ctx.save();
  ctx.fillStyle = "rgba(255, 209, 102, 0.22)";
  ctx.strokeStyle = "rgba(255, 209, 102, 0.72)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(box.left - size / 2, box.top - size / 2, box.right - box.left + size, box.bottom - box.top + size, size * 0.12);
  ctx.fill();
  ctx.stroke();

  const pieceStyle = pieceSkinStyle(p, !!state.serverState?.colourBlind);
  drawPieceSkinBase(centerX, centerY, size * 1.55, p, pieceStyle);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = pieceStyle.fill;
  ctx.strokeStyle = pieceStyle.stroke;
  if (pieceStyle.glow) {
    ctx.shadowColor = pieceStyle.glow;
    ctx.shadowBlur = size * 0.16;
  }
  ctx.lineWidth = 7;
  const mutantGlyphs = p.tags?.includes("mutant") ? pieceGlyphsFor(p, !!state.serverState?.colourBlind).slice(0, 5) : null;
  if (mutantGlyphs?.length > 1) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(Math.sin(nowMs() / 420 + sq) * 0.06);
    ctx.font = `${Math.floor(size * 0.62)}px "Segoe UI Symbol", "Noto Sans Symbols2", serif`;
    const spots = [
      [0, -0.34],
      [-0.34, 0.02],
      [0.34, 0.02],
      [-0.14, 0.38],
      [0.18, 0.38],
    ];
    mutantGlyphs.forEach((glyph, i) => {
      const [ox, oy] = spots[i] || [0, 0];
      ctx.strokeText(glyph, ox * size, oy * size + 3);
      ctx.fillText(glyph, ox * size, oy * size);
    });
    ctx.restore();
  } else {
    ctx.font = `${Math.floor(size * 1.05)}px "Segoe UI Symbol", "Noto Sans Symbols2", serif`;
    const glyph = pieceGlyph(p.type, p.color, !!state.serverState?.colourBlind);
    ctx.strokeText(glyph, centerX, centerY + 4);
    ctx.fillText(glyph, centerX, centerY);
  }
  ctx.restore();
}

function drawBlock(sq) {
  const { x, y } = squareToCanvasCenter(sq);
  const size = els.canvas.width / 8;
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(x - size * 0.34, y - size * 0.34, size * 0.68, size * 0.68);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x - size * 0.34, y - size * 0.34, size * 0.68, size * 0.68);
}

function renderCards() {
  const s = state.serverState;
  els.activeCards.innerHTML = "";
  for (const r of s.activeRules || []) {
    els.activeCards.appendChild(buildRuleCard(r, { pickable: false }));
  }
}

function renderMutant() {
  const s = state.serverState;
  const fusion = s?.mutantFusion;
  const active = !!fusion?.active;
  if (els.mutantModal) els.mutantModal.hidden = !active;
  if (!active) return;

  const mine = fusion.playerId === state.playerId;
  const selected = fusion.selected || [];
  if (els.mutantStatus) {
    els.mutantStatus.textContent = mine
      ? `Click your pieces on the board. Selected: ${selected.length}`
      : "Opponent is choosing pieces to fuse.";
  }
  if (els.mutantSelected) {
    els.mutantSelected.innerHTML = "";
    for (const sq of selected) {
      const p = s.board?.[sq];
      const chip = document.createElement("div");
      chip.className = "mutantChip";
      chip.textContent = `${PIECE_GLYPH_MONO[p?.type] || "?"} ${sqToAlg(sq)}`;
      els.mutantSelected.appendChild(chip);
    }
  }
  if (els.mutantConfirmBtn) {
    els.mutantConfirmBtn.disabled = !mine || selected.length === 0;
    els.mutantConfirmBtn.textContent = mine ? "Confirm fusion" : "Waiting...";
  }
}

function ruleTypeIcon(kind) {
  if (kind === "instant") return "\u26A1";
  if (kind === "delayed") return "\u23F3";
  if (kind === "permanent") return "\u221E";
  return "\u23F1";
}

function ruleArtIcon(ruleId, ruleName) {
  const id = String(ruleId || "").toLowerCase();
  const name = String(ruleName || "").toLowerCase();

  const hay = `${id} ${name}`;

  if (hay.includes("black hole")) return "\u25CF";
  if (hay.includes("plague")) return "\u2623";
  if (hay.includes("ads")) return "\u25A3";
  if (hay.includes("lawnmower")) return "\u25AC";
  if (hay.includes("backup")) return "\u2665";
  if (hay.includes("supermarket") || hay.includes("shop")) return "\u{1F6D2}";
  if (hay.includes("sticky")) return "\u25CD";
  if (hay.includes("haunted")) return "\u25D6";
  if (hay.includes("friendly fire")) return "\u26A0";
  if (hay.includes("bumper")) return "\u21A9";
  if (hay.includes("ice") || hay.includes("slippery")) return "\u2744";
  if (hay.includes("gravity")) return "\u2193";
  if (hay.includes("fog") || hay.includes("invisible")) return "\u25D0";
  if (hay.includes("lightning") || hay.includes("orbital")) return "\u26A1";
  if (hay.includes("asteroid")) return "\u25C6";
  if (hay.includes("pawn soldier")) return "\u25CE";
  if (hay.includes("suicide bomber")) return "\u{1F4A3}";
  if (hay.includes("explod") || hay.includes("bomb") || hay.includes("purge")) return "\u{1F4A5}";
  if (hay.includes("titan")) return "\u{1F4AA}";
  if (hay.includes("mutant")) return "\u2723";
  if (hay.includes("mystery") || hay.includes("box")) return "?";
  if (hay.includes("reset")) return "\u21BA";
  if (hay.includes("fan")) return "\u{1F32C}";
  if (hay.includes("lava")) return "\u{1F30B}";
  if (hay.includes("deadly") || hay.includes("death")) return "\u2620";
  if (hay.includes("shield")) return "\u{1F6E1}";
  if (hay.includes("swap") || hay.includes("mirror")) return "\u21C4";
  if (hay.includes("teleport")) return "\u{1F300}";
  if (hay.includes("shuffle") || hay.includes("random") || hay.includes("rps") || hay.includes("dice")) return "\u{1F3B2}";
  if (hay.includes("flip") || hay.includes("rotate") || hay.includes("turn")) return "\u{1F504}";
  if (hay.includes("spawn") || hay.includes("block") || hay.includes("wall")) return "\u{1F9F1}";
  if (hay.includes("extra move") || hay.includes("double")) return "\u23E9";

  if (hay.includes("queen")) return "\u265B";
  if (hay.includes("king")) return "\u265A";
  if (hay.includes("rook")) return "\u265C";
  if (hay.includes("bishop")) return "\u265D";
  if (hay.includes("knight")) return "\u265E";
  if (hay.includes("pawn")) return "\u265F";

  if (hay.includes("center")) return "\u29BF";
  if (hay.includes("column") || hay.includes("file")) return "\u25AE";
  if (hay.includes("edge") || hay.includes("perimeter")) return "\u2B1A";

  return "\u2726";
}

function buildRuleCard(r, { pickable }) {
  const div = document.createElement("div");
  div.className = `card ${pickable ? "pickable" : ""} ${r.kind} ${cardBackClass()}`.trim().replace(/\s+/g, " ");

  const turns = r.remaining != null ? `${r.remaining}t` : "";
  const typeIcon = ruleTypeIcon(r.kind);
  const artIcon = ruleArtIcon(r.id, r.name);

  div.innerHTML = `
    <div class="cardTop">
      <div class="cardTopLeft">
        <div class="cardTypeIcon" aria-hidden="true">${typeIcon}</div>
        <div class="cardTitleStack">
          <div class="name">${escapeHtml(r.name)}</div>
          <div class="typeLabel">${escapeHtml(r.typeLabel)}</div>
        </div>
      </div>
      <div class="cardTurns" ${turns ? "" : "hidden"}>${escapeHtml(turns)}</div>
    </div>
    <div class="cardArt" aria-hidden="true">
      <div class="cardArtIcon">${artIcon}</div>
    </div>
    <div class="desc">${escapeHtml(r.description)}</div>
  `;

  bindCardFX(div);
  return div;
}

function ruleCardFromEffect(effect) {
  const id = effect.ruleId || "";
  const active = (state.serverState?.activeRules || []).find((r) => r.id === id);
  const choiceLists = Object.values(state.serverState?.ruleChoicesByPlayerId || {}).flat();
  const choice = choiceLists.find((r) => r.id === id);
  const name = active?.name || choice?.name || String(effect.text || "").replace(/\s*\((active|scheduled)\)\s*$/i, "").replace(/\s+triggers!$/i, "");
  return {
    id,
    name,
    description: active?.description || choice?.description || "Rule fired.",
    kind: active?.kind || choice?.kind || effect.ruleKind || "instant",
    typeLabel: active?.typeLabel || choice?.typeLabel || effect.typeLabel || "Rule",
    remaining: active?.remaining ?? choice?.remaining ?? null,
  };
}

function showCardPopup(effect) {
  if (!els.cardPopupLayer || effect.showCard === false) return;
  const card = buildRuleCard(ruleCardFromEffect(effect), { pickable: false });
  const wrap = document.createElement("div");
  wrap.className = "cardPopup";
  wrap.style.setProperty("--card-popup-enter-ms", `${CARD_POPUP_ENTER_MS}ms`);
  wrap.style.setProperty("--card-popup-exit-ms", `${CARD_POPUP_EXIT_MS}ms`);
  wrap.appendChild(card);
  els.cardPopupLayer.appendChild(wrap);
  setTimeout(() => wrap.classList.add("leaving"), CARD_POPUP_ENTER_MS);
  setTimeout(() => wrap.remove(), CARD_POPUP_HOLD_MS + CARD_POPUP_EXIT_MS);
}

function bindCardFX(card) {
  if (!card || card.dataset.cardFx === "1") return;
  card.dataset.cardFx = "1";

  let raf = 0;
  let next = { rx: 0, ry: 0, mx: "50%", my: "50%" };

  const apply = () => {
    raf = 0;
    card.style.setProperty("--rx", `${next.rx}deg`);
    card.style.setProperty("--ry", `${next.ry}deg`);
    card.style.setProperty("--mx", next.mx);
    card.style.setProperty("--my", next.my);
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(apply);
  };

  const updateFromPointer = (ev) => {
    const rect = card.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));

    const maxTilt = card.classList.contains("pickable") ? 16 : 12;
    const ry = (px - 0.5) * maxTilt * 2;
    const rx = -(py - 0.5) * maxTilt * 2;

    next = {
      rx,
      ry,
      mx: `${Math.round(px * 100)}%`,
      my: `${Math.round(py * 100)}%`,
    };
    schedule();
  };

  card.addEventListener("pointerenter", () => {
    card.classList.add("is-tilting");
  });
  card.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "touch") return;
    updateFromPointer(ev);
  });
  card.addEventListener("pointerleave", () => {
    card.classList.remove("is-tilting");
    next = { rx: 0, ry: 0, mx: "50%", my: "50%" };
    schedule();
  });
}

function updateChoiceTimer() {
  const s = state.serverState;
  if (!s || els.choiceArea.hidden) return;
  const remainingMs = Math.max(0, (s.ruleChoiceDeadlineMs || 0) - Date.now());
  els.choiceTimer.textContent = `${Math.ceil(remainingMs / 1000)}s`;
}

function toIdxSafe(file, rank) {
  return rank * 8 + file;
}

function updateRpsTimer() {
  const s = state.serverState;
  if (!s || els.rpsModal.hidden) return;
  const remainingMs = Math.max(0, (s.rps?.deadlineMs || 0) - Date.now());
  els.rpsTimer.textContent = remainingMs ? `${Math.ceil(remainingMs / 1000)}s` : "";
}

function otherColor(c) {
  return c === "w" ? "b" : c === "b" ? "w" : null;
}

function renderRps() {
  const s = state.serverState;
  const active = !!s?.rps?.active && s?.phase === "rps";
  els.rpsModal.hidden = !active;
  if (!active) {
    if (els.rpsStatus) els.rpsStatus.textContent = "";
    if (els.rpsTimer) els.rpsTimer.textContent = "";
    return;
  }

  updateRpsTimer();

  const picked = s.rps?.pickedByColor || {};
  const you = state.color;
  const opp = otherColor(you);
  const youPicked = you ? !!picked[you] : false;
  const oppPicked = opp ? !!picked[opp] : false;

  if (els.rpsStatus) {
    els.rpsStatus.textContent = `Round ${s.rps.round || 1} | You: ${youPicked ? "picked" : "waiting"} | Opponent: ${oppPicked ? "picked" : "waiting"}`;
  }

  const disable = !state.lobby || !state.playerId || youPicked;
  if (els.rpsRockBtn) els.rpsRockBtn.disabled = disable;
  if (els.rpsPaperBtn) els.rpsPaperBtn.disabled = disable;
  if (els.rpsScissorsBtn) els.rpsScissorsBtn.disabled = disable;
}

function updateWagerTimer() {
  const s = state.serverState;
  if (!s || els.wagerModal.hidden) return;
  const w = s.wager;
  if (!w) {
    if (els.wagerTimer) els.wagerTimer.textContent = "";
    return;
  }
  if (w.stage === "flip" && els.coinSpin) {
    els.coinSpin.textContent = Math.floor(Date.now() / 220) % 2 === 0 ? "HEADS" : "TAILS";
  }
  if (w.stage !== "select") {
    if (els.wagerTimer) els.wagerTimer.textContent = "";
    return;
  }
  if (!w.deadlineMs) {
    els.wagerTimer.textContent = "";
    return;
  }
  const remainingMs = Math.max(0, w.deadlineMs - Date.now());
  els.wagerTimer.textContent = `${Math.ceil(remainingMs / 1000)}s`;
}

function renderWager() {
  const s = state.serverState;
  const active = !!s?.wager?.active && s?.phase === "wager";
  els.wagerModal.hidden = !active;
  if (!active) {
    if (els.wagerYouGrid) els.wagerYouGrid.innerHTML = "";
    if (els.wagerOppGrid) els.wagerOppGrid.innerHTML = "";
    if (els.wagerStatus) els.wagerStatus.textContent = "";
    if (els.wagerResult) els.wagerResult.textContent = "";
    if (els.coinAssign) els.coinAssign.textContent = "";
    if (els.wagerTimer) els.wagerTimer.textContent = "";
    if (els.coinArea) els.coinArea.hidden = true;
    if (els.coinSpin) els.coinSpin.classList.remove("stopped");
    return;
  }

  const w = s.wager;
  updateWagerTimer();

  const you = state.color;
  const opp = otherColor(you);
  const selections = w.selectedByColor || {};
  const confirmed = w.confirmedByColor || {};
  const youConfirmed = you ? !!confirmed[you] : false;
  const oppConfirmed = opp ? !!confirmed[opp] : false;

  if (els.wagerStatus) {
    if (w.stage === "select") {
      const youCount = you ? ((selections[you] || []).length || 0) : 0;
      const oppCount = opp ? ((selections[opp] || []).length || 0) : 0;
      els.wagerStatus.textContent = `Select any of your pieces to wager (kings can't be wagered). You: ${youCount} selected (${youConfirmed ? "confirmed" : "choosing"}) | Opponent: ${oppCount} selected (${oppConfirmed ? "confirmed" : "choosing"})`;
    } else if (w.stage === "flip") {
      els.wagerStatus.textContent = "Coin flipping...";
    } else {
      els.wagerStatus.textContent = "Result!";
    }
  }

  const selectedSet = new Set((you ? selections[you] : []) || []);

  const canPick = w.stage === "select" && !youConfirmed;

  const buildGrid = (container, items, { interactive }) => {
    if (!container) return;
    container.innerHTML = "";
    for (const item of items) {
      const btn = document.createElement("div");
      const isSelected = selectedSet.has(item.sq);
      btn.className = `wagerPiece${isSelected ? " selected" : ""}`;
      const glyph = PIECE_GLYPH_MONO[item.p.type] || "?";
      btn.innerHTML = `<div class="wagerGlyph">${glyph}</div><div class="wagerMeta">${escapeHtml(item.p.type.toUpperCase())} · ${escapeHtml(sqToAlg(item.sq))}</div>`;
      if (!interactive) btn.style.opacity = "0.78";
      if (interactive) {
        btn.addEventListener("click", () => {
          if (!canPick) return;
          if (selectedSet.has(item.sq)) selectedSet.delete(item.sq);
          else selectedSet.add(item.sq);
          const next = [...selectedSet];
          socket.emit("game:wagerSelection", { code: state.lobby, playerId: state.playerId, squares: next }, (res) => {
            if (!res?.ok) logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "wager selection failed")}`);
            socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
          });
        });
      }
      container.appendChild(btn);
    }
  };

  const yourSquares = [];
  const oppSquares = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = s.board?.[sq];
    if (!p) continue;
    if (p.color === "x") continue;
    if (p.type === "k") continue;
    if (p.color === you) yourSquares.push({ sq, p });
  }
  yourSquares.sort((a, b) => a.sq - b.sq);
  buildGrid(els.wagerYouGrid, yourSquares, { interactive: true });

  const oppSelected = new Set((opp ? selections[opp] : []) || []);
  for (const sq of oppSelected) {
    const p = s.board?.[sq];
    if (!p) continue;
    if (p.color !== opp) continue;
    if (p.color === "x" || p.type === "k") continue;
    oppSquares.push({ sq, p });
  }
  oppSquares.sort((a, b) => a.sq - b.sq);
  buildGrid(els.wagerOppGrid, oppSquares, { interactive: false });

  if (els.wagerConfirmBtn) {
    els.wagerConfirmBtn.hidden = false;
    if (w.stage === "select") {
      const enabled = !youConfirmed && state.lobby && state.playerId;
      els.wagerConfirmBtn.disabled = !enabled;
      els.wagerConfirmBtn.textContent = youConfirmed ? "Waiting for opponent..." : "Confirm wager";
    } else if (w.stage === "flip") {
      els.wagerConfirmBtn.disabled = true;
      els.wagerConfirmBtn.textContent = "Flipping coin...";
    } else {
      els.wagerConfirmBtn.disabled = true;
      els.wagerConfirmBtn.textContent = "Wager complete";
    }
  }

  if (els.coinArea) els.coinArea.hidden = w.stage === "select";
  if (w.stage !== "select") {
    const assign = w.assignedByColor?.[you] || "";
    if (els.coinAssign) els.coinAssign.textContent = assign ? `You are ${assign.toUpperCase()}` : "";
    if (els.coinSpin) {
      if (w.stage === "result") els.coinSpin.classList.add("stopped");
      else els.coinSpin.classList.remove("stopped");

      if (w.stage === "flip") {
        els.coinSpin.textContent = Math.floor(Date.now() / 220) % 2 === 0 ? "HEADS" : "TAILS";
      } else if (w.outcome) {
        els.coinSpin.textContent = String(w.outcome).toUpperCase();
      }
    }
    if (els.wagerResult) {
      if (w.stage === "flip") els.wagerResult.textContent = "";
      else if (w.winner) els.wagerResult.textContent = `${w.winner === you ? "You win!" : "You lose!"}`;
      else els.wagerResult.textContent = "";
    }
  }
}

function renderChoice() {
  const s = state.serverState;
  const choice = (s.ruleChoicesByPlayerId || {})[state.playerId];
  const needsChoice =
    (s.phase === "ruleChoice" && !!choice && !s.ruleChosenByPlayerId?.[state.playerId]) ||
    (s.phase === "bonusRuleChoice" && !!choice && choice.length > 0);

  els.choiceArea.hidden = !needsChoice;
  document.body.classList.toggle("is-choosing", needsChoice);
  document.body.classList.toggle("is-debug-choice", needsChoice && choice.length > 3);
  els.choiceCards.classList.toggle("debugChoice", needsChoice && choice.length > 3);
  if (els.choiceTitle) {
    if (!needsChoice) els.choiceTitle.textContent = "Pick a rule";
    else if (s.phase === "bonusRuleChoice") {
      const left = s.bonusRuleChoice?.remainingPicks ?? "?";
      els.choiceTitle.textContent = `Pick a bonus rule (${left} left)`;
    } else {
      els.choiceTitle.textContent = "Pick a rule";
    }
  }
  if (!needsChoice) {
    els.choiceCards.innerHTML = "";
    state.lastChoiceKey = null;
    document.body.classList.remove("is-debug-choice");
    els.choiceCards.classList.remove("debugChoice");
    return;
  }

  updateChoiceTimer();

  const choiceKey = (choice || []).map((r) => r.id).join("|");
  if (choiceKey && choiceKey === state.lastChoiceKey) return;
  state.lastChoiceKey = choiceKey;

  els.choiceCards.innerHTML = "";
  for (const r of choice) {
    const div = buildRuleCard(r, { pickable: true });
    div.addEventListener("click", () => {
      socket.emit("game:chooseRule", { code: state.lobby, playerId: state.playerId, ruleId: r.id }, (res) => {
        if (!res?.ok) logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "rule pick failed")}`);
        // If a push was missed, pull state directly.
        socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
      });
    });
    els.choiceCards.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function openRulebook() {
  if (!els.rulebookModal || !els.rulebookCards) return;
  els.rulebookModal.hidden = false;

  if (!state.cachedRulebook) {
    els.rulebookCards.innerHTML = `<div class="modalStatus">Loading…</div>`;
    try {
      const res = await fetch("/api/rules", { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok || !Array.isArray(json.rules)) throw new Error("bad response");
      state.cachedRulebook = json.rules;
    } catch {
      els.rulebookCards.innerHTML = `<div class="modalStatus">Failed to load rules.</div>`;
      return;
    }
  }

  els.rulebookCards.innerHTML = "";
  for (const r of state.cachedRulebook) {
    els.rulebookCards.appendChild(buildRuleCard(r, { pickable: false }));
  }
}

function closeRulebook() {
  if (!els.rulebookModal) return;
  els.rulebookModal.hidden = true;
}

function requestOpenServers() {
  socket.emit("lobby:listOpen", {}, (res) => {
    if (!res?.ok) {
      logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "server list failed")}`);
      return;
    }
    state.openServers = Array.isArray(res.servers) ? res.servers : [];
    renderOpenServers();
  });
}

function openCreateModal() {
  if (!ensureSignedIn()) return;
  if (!els.createModal) return;
  els.createModal.hidden = false;
}

function closeCreateModal() {
  if (!els.createModal) return;
  els.createModal.hidden = true;
}

function createLobby(visibility) {
  if (!ensureSignedIn()) return;
  socket.emit("lobby:create", { authToken: state.authToken, visibility }, (res) => {
    if (!res?.ok) return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "create failed")}`);
    closeCreateModal();
    enterLobby({ code: res.code, playerId: res.playerId, color: res.color });
    refreshAccount();
    els.code.value = "";
    const visibilityText = visibility === "public" ? "public" : "private";
    logLine(`<strong>Lobby</strong>: Created ${visibilityText} lobby <strong>${res.code}</strong>`);
  });
}

function createSingleplayer() {
  if (!ensureSignedIn()) return;
  socket.emit("lobby:singleplayer", { authToken: state.authToken }, (res) => {
    if (!res?.ok) return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "singleplayer failed")}`);
    enterLobby({ code: res.code, playerId: res.playerId, color: res.color });
    refreshAccount();
    els.code.value = "";
    logLine(`<strong>Lobby</strong>: Started singleplayer game against Chaos Bot.`);
  });
}

function openJoinModal() {
  if (!ensureSignedIn()) return;
  if (!els.joinModal) return;
  els.joinModal.hidden = false;
  requestOpenServers();
  setTimeout(() => els.code?.focus(), 0);
}

function closeJoinModal() {
  if (!els.joinModal) return;
  els.joinModal.hidden = true;
}

function joinLobbyCode(code) {
  if (!ensureSignedIn()) return;
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return logLine(`<strong>Error</strong>: Enter a lobby code.`);
  socket.emit("lobby:join", { code: normalized, authToken: state.authToken }, (res) => {
    if (!res?.ok) {
      requestOpenServers();
      return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "join failed")}`);
    }
    closeJoinModal();
    enterLobby({ code: res.code, playerId: res.playerId, color: res.color });
    refreshAccount();
    logLine(`<strong>Lobby</strong>: Joined <strong>${res.code}</strong>`);
  });
}

function renderOpenServers() {
  if (!els.openServers) return;
  const servers = state.openServers || [];
  if (!servers.length) {
    els.openServers.innerHTML = `<div class="emptyServers">No public servers are waiting.</div>`;
    return;
  }
  els.openServers.innerHTML = "";
  for (const server of servers) {
    const row = document.createElement("div");
    row.className = "serverRow";
    const meta = document.createElement("div");
    meta.className = "serverMeta";
    const host = document.createElement("strong");
    host.textContent = server.host || "Player 1";
    const count = document.createElement("span");
    count.textContent = `${server.players || 0}/${server.maxPlayers || 2} players`;
    meta.append(host, count);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Join";
    btn.addEventListener("click", () => joinLobbyCode(server.code));
    row.append(meta, btn);
    els.openServers.appendChild(row);
  }
}

function borderClass(profile) {
  const slug = cosmeticSlug(profile?.border || "None");
  return slug && slug !== "none" ? `skin-border-${slug}` : "";
}

function cardBackClass() {
  const slug = cosmeticSlug(localProfile().cardBack || "Classic Cards");
  return slug && slug !== "classic-cards" ? `cardBack-${slug}` : "";
}

function currentEmote(playerId) {
  const emote = state.activeEmotes[playerId];
  if (!emote) return "";
  if (Date.now() > emote.until) {
    delete state.activeEmotes[playerId];
    return "";
  }
  return emote.text || "";
}

function renderBoardName(player) {
  if (!player) return "";
  const profile = player.profile || {};
  const avatar = (profile.avatar || player.name || "?").slice(0, 4).toUpperCase();
  const emote = currentEmote(player.id);
  const cls = ["boardNameAvatar", borderClass(profile)].filter(Boolean).join(" ");
  return `
    <button class="boardNameButton" type="button" data-player-id="${escapeAttr(player.id || "")}" title="View ${escapeAttr(player.name || "player")} profile">
      <span class="${escapeAttr(cls)}">${escapeHtml(avatar)}</span>
      <span class="boardNameText">${escapeHtml(player.name || "Player")}</span>
    </button>
    ${emote ? `<span class="boardNameEmote">${escapeHtml(emote)}</span>` : ""}
  `;
}

function applyGameCosmetics() {
  const profile = localProfile();
  if (els.boardWrap) {
    [...els.boardWrap.classList].forEach((cls) => {
      if (cls.startsWith("skin-border-")) els.boardWrap.classList.remove(cls);
    });
    const cls = borderClass(profile);
    if (cls) els.boardWrap.classList.add(cls);
  }
  if (els.emoteBtn) els.emoteBtn.textContent = profile.emote || "Emote";
}

function syncUI() {
  const s = state.serverState;
  const connected = !!state.lobby;
  updateBodyState();
  els.lobbyPanel.hidden = connected;
  els.gamePanel.hidden = !connected;
  if (!connected) return;

  if (!s) {
    els.lobbyCode.textContent = state.lobby;
    els.youInfo.textContent = `${state.color === "w" ? "White" : "Black"} (${state.playerId})`;
    els.turnInfo.textContent = "-";
    els.plyInfo.textContent = "0";
    els.gameMsg.textContent = "Syncing...";
    els.activeCards.innerHTML = "";
    if (els.mutantModal) els.mutantModal.hidden = true;
    els.choiceArea.hidden = true;
    document.body.classList.remove("is-choosing");
    document.body.classList.remove("is-debug-choice");
    els.choiceCards.classList.remove("debugChoice");
    if (els.resultModal) els.resultModal.hidden = true;
    if (els.supermarketModal) els.supermarketModal.hidden = true;
    stopConfetti();
    if (els.sideLabelTop) els.sideLabelTop.textContent = "";
    if (els.sideLabelBottom) els.sideLabelBottom.textContent = "";
    els.canvas.style.cursor = "";
    return;
  }

  els.lobbyCode.textContent = state.lobby;
  els.youInfo.textContent = `${state.color === "w" ? "White" : "Black"} (${state.playerId})`;
  els.turnInfo.textContent = s.turn === "w" ? "White" : "Black";
  els.plyInfo.textContent = String(s.ply || 0);
  const players = s.players || [];
  const opp = players.find((p) => p.id !== state.playerId);
  const oppText = opp ? `${opp.name} (${opp.color === "w" ? "White" : "Black"})` : "Waiting for opponent...";
  els.gameMsg.textContent = s.check ? `${s.check} in check | ${oppText}` : oppText;
  if (s.pendingTargetRule) {
    els.gameMsg.textContent =
      s.pendingTargetRule.playerId === state.playerId
        ? s.pendingTargetRule.prompt || "Choose a rule target"
        : "Opponent choosing a rule target";
  }
  if (s.supermarket?.active) {
    els.gameMsg.textContent = s.supermarket.playerId === state.playerId ? "Choose your supermarket delivery" : "Opponent is shopping";
  }
  if (s.phase === "pawnSoldierShot") {
    els.gameMsg.textContent =
      s.pendingPawnSoldierShot?.playerId === state.playerId
        ? "Pawn Soldier: click a square to fire"
        : "Opponent firing Pawn Soldier";
  }
  if (s.phase === "mutantFusion") {
    els.gameMsg.textContent = s.mutantFusion?.playerId === state.playerId ? "Mutant: select pieces to fuse" : "Opponent is making a mutant";
  }

  state.flipVisual = (state.color === "b") !== !!s.visualFlip;

  const whiteName = (players.find((p) => p.color === "w")?.name || "White").trim();
  const blackName = (players.find((p) => p.color === "b")?.name || "Black").trim();
  const whitePlayer = players.find((p) => p.color === "w") || { name: whiteName, color: "w", profile: null };
  const blackPlayer = players.find((p) => p.color === "b") || { name: blackName, color: "b", profile: null };
  const topIsWhite = !!state.flipVisual;
  if (els.sideLabelTop) els.sideLabelTop.innerHTML = renderBoardName(topIsWhite ? whitePlayer : blackPlayer);
  if (els.sideLabelBottom) els.sideLabelBottom.innerHTML = renderBoardName(topIsWhite ? blackPlayer : whitePlayer);
  applyGameCosmetics();
  els.canvas.style.cursor =
    (s.phase === "pawnSoldierShot" && s.pendingPawnSoldierShot?.playerId === state.playerId) ||
    (s.phase === "mutantFusion" && s.mutantFusion?.playerId === state.playerId)
      ? "crosshair"
      : "";

  renderCards();
  renderChoice();
  renderRps();
  renderWager();
  renderSupermarket();
  renderMutant();

  // Result modal.
  const ri = s.resultInfo;
  const showResult =
    !!ri &&
    (ri.winner === "w" || ri.winner === "b") &&
    (ri.loser === "w" || ri.loser === "b") &&
    !!s.started &&
    s.phase !== "lobby";
  if (els.resultModal) els.resultModal.hidden = !showResult;
  if (showResult) {
    const youWon = ri.winner === state.color;
    if (els.resultTitle) els.resultTitle.textContent = youWon ? "You Win" : "You Lose";
    if (els.resultDetail) els.resultDetail.textContent = ri.detail || "";

    const readyBy = s.readyByPlayerId || {};
    const readyCount = Object.values(readyBy).filter(Boolean).length;
    const total = (s.players || []).length || 2;
    if (els.readyStatus) els.readyStatus.textContent = `Ready: ${readyCount}/${total}`;

    const youReady = !!readyBy[state.playerId];
    if (els.readyBtn) els.readyBtn.textContent = youReady ? "Unready" : "Ready";

    if (youWon) {
      if (!confetti.running) startConfetti();
    } else {
      stopConfetti();
    }
  } else {
    stopConfetti();
  }
}

function handleEffects() {
  const s = state.serverState;
  for (const e of s.effects || []) {
    if (state.lastEffectsSeen.has(e.id)) continue;
    state.lastEffectsSeen.add(e.id);
    if (e.type === "log") logLine(escapeHtml(e.text));
    if (e.type === "explosion") {
      playSound("explosion");
      spawnParticles(e.squares || [], "rgba(255,107,107,0.95)");
    }
    if (e.type === "move") {
      queueMoveAnimation(e);
      if (e.style === "teleport") spawnParticles([e.from, e.to].filter((sq) => sq != null), "rgba(196,141,255,0.92)");
      if (e.style === "fan") spawnParticles([e.to].filter((sq) => sq != null), "rgba(123,211,255,0.72)");
      if (e.style === "ice") spawnParticles([e.to].filter((sq) => sq != null), "rgba(220,250,255,0.84)");
    }
    if (e.type === "bullets") {
      queueBullets(e);
      spawnParticles(e.hits || [], "rgba(255,221,87,0.9)");
    }
    if (e.type === "lawnmower") {
      queueLawnmower(e);
      spawnParticles(e.squares || [], "rgba(156,255,107,0.78)");
    }
    if (e.type === "supplyDrop") {
      queueSupplyDrop(e);
      spawnParticles((e.drops || []).map((drop) => drop.sq).filter((sq) => sq != null), "rgba(255,209,102,0.88)");
      playSound("rule");
    }
    if (e.type === "rule") {
      playSound("rule");
      showCardPopup(e);
      logLine(`<strong>Rule</strong>: ${escapeHtml(e.text)}`);
    }
  }
}

function setConnectedUI() {
  els.status.textContent = state.connected ? "Connected" : "Disconnected";
  updateBodyState();
}

socket.on("connect", () => {
  state.connected = true;
  setConnectedUI();

  // Auto-resume if we were in a lobby and the socket reconnected (socket.id changes).
  if (state.lobby && state.playerId) {
    socket.emit("lobby:resume", { code: state.lobby, playerId: state.playerId }, (res) => {
      if (!res?.ok) {
        logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "resume failed")}`);
        state.lobby = null;
        state.playerId = null;
        state.color = null;
        state.serverState = null;
        state.lastRematchId = null;
        saveSession();
        syncUI();
        return;
      }
      // Server will push a fresh game:state after resume.
      logLine(`<strong>Lobby</strong>: Reconnected to <strong>${escapeHtml(state.lobby)}</strong>`);
      socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
    });
  }
});
socket.on("disconnect", () => {
  state.connected = false;
  setConnectedUI();
});

socket.on("lobby:closed", (m) => {
  resetToLobby(m?.reason || "Lobby closed.");
});

socket.on("lobby:message", (m) => {
  logLine(escapeHtml(m.text || ""));
});

socket.on("game:emote", (m) => {
  if (!m?.playerId) return;
  const text = String(m.text || "").slice(0, 40);
  state.activeEmotes[m.playerId] = { text, until: Date.now() + 3600 };
  logLine(`<strong>${escapeHtml(m.name || "Player")}</strong>: ${escapeHtml(text)}`);
  syncUI();
  setTimeout(() => syncUI(), 3700);
});

socket.on("game:state", (s) => {
  // The server can send pushes for rooms this socket is still subscribed to.
  // Only accept state for the currently active lobby.
  if (state.lobby && s?.roomCode && s.roomCode !== state.lobby) return;
  if (state.lastRematchId != null && s.rematchId != null && s.rematchId !== state.lastRematchId) {
    state.lastEffectsSeen = new Set();
    state.lastChoiceKey = null;
    state.supplyDrops = [];
    clearAds();
    stopConfetti();
  }
  state.lastRematchId = s.rematchId ?? state.lastRematchId;
  state.serverState = s;
  state.lastStateAt = Date.now();
  if (s?.resultInfo && state.authToken) {
    const resultKey = `${s.rematchId || 0}:${s.resultInfo.winner || ""}:${s.resultInfo.loser || ""}:${s.resultInfo.reason || ""}`;
    if (state.lastProfileResultKey !== resultKey) {
      state.lastProfileResultKey = resultKey;
      refreshAccount();
    }
  }
  handleEffects();
  syncUI();
});

socket.on("lobby:openServers", (payload) => {
  state.openServers = Array.isArray(payload?.servers) ? payload.servers : [];
  renderOpenServers();
});

els.rulebookBtn?.addEventListener("click", () => {
  openRulebook();
});
els.rulebookCloseBtn?.addEventListener("click", () => {
  closeRulebook();
});
els.rulebookModal?.addEventListener("mousedown", (ev) => {
  if (ev.target === els.rulebookModal) closeRulebook();
});

els.profileBtn?.addEventListener("click", () => openProfileModal());
els.accountActionBtn?.addEventListener("click", () => openProfileModal());
els.profileCloseBtn?.addEventListener("click", () => closeProfileModal());
els.profileModal?.addEventListener("mousedown", (ev) => {
  if (ev.target === els.profileModal) closeProfileModal();
});
els.profileTabs?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-tab]");
  if (!btn) return;
  state.profileTab = btn.dataset.tab || "overview";
  renderProfile();
});
els.profileContent?.addEventListener("click", (ev) => {
  const target = ev.target;
  if (target?.id === "logoutBtn") logout();
  if (target?.id === "saveProfileBtn") saveProfileSettings();
  if (target?.id === "changePasswordBtn") changePassword();
  if (target?.id === "addFriendBtn") addFriend();
  if (target?.id === "openRuleAppendixBtn") openRulebook();
  if (target?.id === "deleteAccountBtn") deleteAccount();
  if (target?.id === "adminLoadFlagsBtn") adminLoadFlags();
  if (target?.id === "adminRefreshUsersBtn") adminRefreshUsers();
  if (target?.id === "adminSaveUserBtn") adminSaveUser();
  const buyBtn = target?.closest?.(".buyCosmeticBtn");
  if (buyBtn) buyCosmetic(buyBtn.dataset.buyGroup, buyBtn.dataset.buyName);
});

els.profileContent?.addEventListener("change", (ev) => {
  const target = ev.target;
  if (target?.id === "adminUserSelect") adminSelectUser(target.value);
  if (target?.id === "adminDebugToggle") adminSetDebugMode(!!target.checked);
});

els.profileContent?.addEventListener("input", (ev) => {
  const target = ev.target;
  if (target?.id === "adminUserJson") adminUpdateDraft(target.value);
});
function handleBoardNameClick(ev) {
  const btn = ev.target?.closest?.(".boardNameButton");
  if (!btn) return;
  const player = playerForId(btn.dataset.playerId);
  if (player) openPlayerProfile(player);
}
els.sideLabelTop?.addEventListener("click", handleBoardNameClick);
els.sideLabelBottom?.addEventListener("click", handleBoardNameClick);
els.shopOffers?.addEventListener("click", (ev) => {
  const buyBtn = ev.target?.closest?.(".buyCosmeticBtn");
  if (buyBtn) buyCosmetic(buyBtn.dataset.buyGroup, buyBtn.dataset.buyName);
});

els.authCloseBtn?.addEventListener("click", () => closeAuthModal());
els.authModal?.addEventListener("mousedown", (ev) => {
  if (ev.target === els.authModal) closeAuthModal();
});
els.loginTabBtn?.addEventListener("click", () => {
  state.authMode = "login";
  renderAuthMode();
});
els.signupTabBtn?.addEventListener("click", () => {
  state.authMode = "signup";
  renderAuthMode();
});
els.authSubmitBtn?.addEventListener("click", () => submitAuth());
els.authUsername?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") submitAuth();
});
els.authPassword?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") submitAuth();
});

els.createBtn.addEventListener("click", () => {
  openCreateModal();
});

els.singleplayerBtn?.addEventListener("click", () => {
  createSingleplayer();
});

els.createPublicBtn?.addEventListener("click", () => createLobby("public"));
els.createPrivateBtn?.addEventListener("click", () => createLobby("private"));
els.createCloseBtn?.addEventListener("click", () => closeCreateModal());
els.createModal?.addEventListener("mousedown", (ev) => {
  if (ev.target === els.createModal) closeCreateModal();
});
els.shopBtn?.addEventListener("click", () => openShopModal());
els.shopCloseBtn?.addEventListener("click", () => closeShopModal());
els.shopModal?.addEventListener("mousedown", (ev) => {
  if (ev.target === els.shopModal) closeShopModal();
});

els.joinBtn.addEventListener("click", () => {
  openJoinModal();
});

els.joinCodeBtn?.addEventListener("click", () => joinLobbyCode(els.code.value));
els.refreshServersBtn?.addEventListener("click", () => requestOpenServers());
els.joinCloseBtn?.addEventListener("click", () => closeJoinModal());
els.joinModal?.addEventListener("mousedown", (ev) => {
  if (ev.target === els.joinModal) closeJoinModal();
});
els.code?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !els.joinModal?.hidden) joinLobbyCode(els.code.value);
});

els.leaveBtn?.addEventListener("click", () => {
  if (!state.lobby || !state.playerId) return resetToLobby();
  socket.emit("lobby:leave", { code: state.lobby, playerId: state.playerId }, (res) => {
    if (!res?.ok) logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "leave failed")}`);
    resetToLobby("Left lobby.");
    window.location.reload();
  });
});

els.readyBtn?.addEventListener("click", () => {
  if (!state.lobby || !state.playerId) return;
  socket.emit("game:ready", { code: state.lobby, playerId: state.playerId }, (res) => {
    if (!res?.ok) logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "ready failed")}`);
    socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
  });
});

function sendRpsChoice(choice) {
  if (!state.lobby || !state.playerId) return;
  socket.emit("game:rpsChoice", { code: state.lobby, playerId: state.playerId, choice }, (res) => {
    if (!res?.ok) logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "RPS pick failed")}`);
    socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
  });
}

function sendEmote() {
  if (!state.lobby || !state.playerId) return;
  socket.emit("game:emote", { code: state.lobby, playerId: state.playerId }, (res) => {
    if (!res?.ok) logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "emote failed")}`);
  });
}

els.rpsRockBtn?.addEventListener("click", () => sendRpsChoice("rock"));
els.rpsPaperBtn?.addEventListener("click", () => sendRpsChoice("paper"));
els.rpsScissorsBtn?.addEventListener("click", () => sendRpsChoice("scissors"));
els.emoteBtn?.addEventListener("click", () => sendEmote());

els.wagerConfirmBtn?.addEventListener("click", () => {
  if (!state.lobby || !state.playerId) return;
  socket.emit("game:wagerConfirm", { code: state.lobby, playerId: state.playerId }, (res) => {
    if (!res?.ok) logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "wager confirm failed")}`);
    socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
  });
});

els.supermarketCheckoutBtn?.addEventListener("click", () => {
  if (!state.lobby || !state.playerId) return;
  socket.emit("game:supermarketPurchase", { code: state.lobby, playerId: state.playerId, items: state.supermarketItems }, (res) => {
    if (!res?.ok) logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "checkout failed")}`);
    socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
  });
});

els.mutantConfirmBtn?.addEventListener("click", () => {
  if (!state.lobby || !state.playerId) return;
  socket.emit("game:mutantConfirm", { code: state.lobby, playerId: state.playerId }, (res) => {
    if (!res?.ok) logLine(`<strong>Mutant</strong>: ${escapeHtml(res?.error || "fusion failed")}`);
    socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
  });
});

els.canvas.addEventListener("mousedown", (ev) => {
  if (!state.serverState || !state.lobby) return;
  const s = state.serverState;
  if (s.phase === "targetRule") {
    const pending = s.pendingTargetRule;
    if (!pending || pending.playerId !== state.playerId) return;
    const square = canvasToSquare(ev.clientX, ev.clientY);
    socket.emit("game:ruleTarget", { code: state.lobby, playerId: state.playerId, square }, (res) => {
      if (!res?.ok) logLine(`<strong>Target</strong>: ${escapeHtml(res?.error || "target rejected")}`);
      socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
    });
    return;
  }
  if (s.phase === "mutantFusion") {
    const fusion = s.mutantFusion;
    if (!fusion || fusion.playerId !== state.playerId) return;
    const square = canvasToSquare(ev.clientX, ev.clientY);
    const piece = s.board[square];
    if (!piece || piece.color !== state.color || piece.color === "x") return;
    const current = fusion.selected || [];
    const next = current.includes(square) ? current.filter((sq) => sq !== square) : [...current, square];
    socket.emit("game:mutantSelection", { code: state.lobby, playerId: state.playerId, squares: next }, (res) => {
      if (!res?.ok) logLine(`<strong>Mutant</strong>: ${escapeHtml(res?.error || "selection rejected")}`);
      socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
    });
    return;
  }
  if (s.phase === "pawnSoldierShot") {
    const pending = s.pendingPawnSoldierShot;
    if (!pending || pending.playerId !== state.playerId) return;
    const target = canvasToSquare(ev.clientX, ev.clientY);
    socket.emit("game:pawnSoldierShot", { code: state.lobby, playerId: state.playerId, target }, (res) => {
      if (!res?.ok) logLine(`<strong>Pawn Soldier</strong>: ${escapeHtml(res?.error || "shot rejected")}`);
      socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
    });
    return;
  }
  if (s.phase !== "play") return;
  if (s.turn !== state.color) return;
  if (s.result) return;

  const selectedPiece = state.selected != null ? s.board[state.selected] : null;
  const titanMoveTarget =
    selectedPiece?.tags?.includes("titan") && state.legalTo?.length
      ? titanAnchorFromCanvasPoint(state.legalTo, ev.clientX, ev.clientY)
      : null;
  const rawSq = canvasToSquare(ev.clientX, ev.clientY);
  const titanAnchor = titanAnchorAtSquare(s.board, rawSq);
  const sq = titanMoveTarget ?? titanAnchor ?? rawSq;
  const piece = s.board[sq];

  if (state.selected == null) {
    if (!piece || piece.color !== state.color) return;
    state.selected = sq;
    state.legalTo = null;
    socket.emit("game:requestMoves", { code: state.lobby, playerId: state.playerId, from: sq }, (res) => {
      if (res?.ok && state.selected === sq) state.legalTo = res.to;
    });
    return;
  }

  // If clicking own piece, reselect.
  if (piece && piece.color === state.color) {
    if (isFriendlyFireActive(s) && state.legalTo?.includes(sq)) {
      const from = state.selected;
      const to = sq;
      state.selected = null;
      state.legalTo = null;
      socket.emit("game:move", { code: state.lobby, playerId: state.playerId, from, to, promotion: "q" }, (res) => {
        if (!res?.ok) logLine(`<strong>Illegal</strong>: ${escapeHtml(res?.error || "move rejected")}`);
      });
      return;
    }
    state.selected = sq;
    state.legalTo = null;
    socket.emit("game:requestMoves", { code: state.lobby, playerId: state.playerId, from: sq }, (res) => {
      if (res?.ok && state.selected === sq) state.legalTo = res.to;
    });
    return;
  }

  const from = state.selected;
  const to = sq;
  state.selected = null;
  state.legalTo = null;
  socket.emit("game:move", { code: state.lobby, playerId: state.playerId, from, to, promotion: "q" }, (res) => {
    if (!res?.ok) logLine(`<strong>Illegal</strong>: ${escapeHtml(res?.error || "move rejected")}`);
  });
});

draw();

setInterval(() => {
  updateShopTimer();
  if (state.serverState) {
    updateChoiceTimer();
    updateRpsTimer();
    updateWagerTimer();
    tickAds();
  }
}, 250);

// Fallback sync: if we haven't seen a state update recently, request one.
setInterval(() => {
  if (!state.connected || !state.lobby || !state.playerId) return;
  const now = Date.now();
  if (now - state.lastStateAt < 1500) return;
  if (now - state.lastSyncAt < 1500) return;
  state.lastSyncAt = now;
  socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
}, 500);
