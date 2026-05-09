/* global io */

const socket = window.ChaosChessRealtime.createSocket(io);

const els = window.ChaosChessDom.getElements();

const ctx = els.canvas.getContext("2d");

const state = {
  connected: false,
  view: "lobby",
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
  fruitMachineKey: null,
  fruitMachineSpinning: false,
  fruitMachineAnimateUntil: 0,
  fruitMachineSettle: null,
  fruitMachineCollecting: false,
  fruitMachineLeverStartY: null,
  fruitMachineLeverPull: 0,
  ads: [],
  nextAdAt: 0,
  authToken: null,
  account: null,
  authMode: "login",
  profileTab: "overview",
  profileRulesTab: "multiplayer",
  viewedProfile: null,
  viewedProfileReadOnly: false,
  lastProfileResultKey: null,
  lastCampaignResultKey: null,
  adminUsers: null,
  adminFlags: null,
  adminSelectedUserId: null,
  adminUserDraft: "",
  activeEmotes: {},
  dailyShop: null,
  shopClockOffset: 0,
  campaign: null,
  campaignRuleCatalog: null,
  campaignLayout: null,
  campaignPan: null,
  campaignPanBound: false,
  campaignSuppressClickUntil: 0,
  campaignPanLayoutKey: "",
  campaignChestModal: null,
  activeCampaignLevel: null,
};

const boardGeometry = window.ChaosChessBoardGeometry.create({ els, state });
const {
  algebraic,
  boardSize,
  canvasPoint,
  canvasToSquare,
  sqToAlg,
  squareToCanvasCenter,
  titanAnchorAtSquare,
  titanAnchorFromCanvasPoint,
  titanBounds,
  titanFootprint,
  toIdxSafe,
} = boardGeometry;

const confetti = {
  running: false,
  parts: [],
  raf: 0,
};

const CLIENT_CONSTANTS = window.ChaosChessConstants;
const CARD_POPUP_HOLD_MS = CLIENT_CONSTANTS.cardPopup.holdMs;
const CARD_POPUP_EXIT_MS = CLIENT_CONSTANTS.cardPopup.exitMs;
const CARD_POPUP_ENTER_MS = CLIENT_CONSTANTS.cardPopup.enterMs;
const CAMPAIGN_CONFIG = CLIENT_CONSTANTS.campaign.config;
const CAMPAIGN_MAP_MIN_ZOOM = CLIENT_CONSTANTS.campaign.mapMinZoom;
const CAMPAIGN_MAP_MAX_ZOOM = CLIENT_CONSTANTS.campaign.mapMaxZoom;
const CAMPAIGN_MAP_ZOOM_STEP = CLIENT_CONSTANTS.campaign.mapZoomStep;
const CAMPAIGN_BIOMES = CLIENT_CONSTANTS.campaign.biomes;
const PIECE_GLYPH_MONO = CLIENT_CONSTANTS.pieceGlyphMono;

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
  state.view = "lobby";
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
  state.activeCampaignLevel = null;
  state.supplyDrops = [];
  state.activeEmotes = {};
  clearAds();
  stopConfetti();
  saveSession();
  syncUI();
}

function enterLobby({ code, playerId, color }) {
  state.view = "game";
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
  const saved = window.ChaosChessStorage.loadGameSession();
  if (saved.lobby) state.lobby = saved.lobby;
  if (saved.playerId) state.playerId = saved.playerId;
  if (saved.color) state.color = saved.color;
}

function saveSession() {
  window.ChaosChessStorage.saveGameSession({
    lobby: state.lobby,
    playerId: state.playerId,
    color: state.color,
  });
}

function campaignChestMilestones() {
  const out = [];
  for (let level = CAMPAIGN_CONFIG.chestEvery; level < CAMPAIGN_CONFIG.totalLevels; level += CAMPAIGN_CONFIG.chestEvery) {
    out.push(level);
  }
  return out;
}

function uniqueStrings(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter((id) => typeof id === "string"))];
}

function uniqueNumbers(arr, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  return [...new Set((Array.isArray(arr) ? arr : []).map((value) => Number(value)).filter((n) => Number.isFinite(n) && n >= min && n <= max))];
}

async function ensureCampaignRuleCatalog() {
  if (Array.isArray(state.campaignRuleCatalog) && state.campaignRuleCatalog.length) return state.campaignRuleCatalog;
  const res = await fetch("/api/rules", { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json?.ok || !Array.isArray(json.rules)) throw new Error("Failed to load rules.");
  state.campaignRuleCatalog = json.rules;
  return state.campaignRuleCatalog;
}

function buildCampaignRulePlan(ruleCatalog) {
  const allRuleIds = uniqueStrings((ruleCatalog || []).map((rule) => rule.id));
  const fallbackBasics = allRuleIds.slice(0, Math.min(6, allRuleIds.length));
  const startingRuleIds = uniqueStrings(CAMPAIGN_CONFIG.basicRuleIds).filter((id) => allRuleIds.includes(id));
  const basicRules = startingRuleIds.length ? startingRuleIds : fallbackBasics;
  const excluded = new Set(uniqueStrings(CAMPAIGN_CONFIG.excludedFromCampaignPool));
  const unlockableRuleIds = allRuleIds.filter((id) => !basicRules.includes(id) && !excluded.has(id));
  const chestLevels = campaignChestMilestones();
  return {
    allRuleIds,
    basicRules,
    unlockableRuleIds,
    chestLevels,
  };
}

function createDefaultCampaignProgress(plan) {
  return {
    highestUnlockedLevel: 1,
    completedLevels: [],
    openedChests: [],
    unlockedRuleIds: uniqueStrings(plan?.basicRules || []),
  };
}

function normalizeCampaignProgress(raw, plan) {
  const parsed = raw && typeof raw === "object" ? raw : {};
  const completed = uniqueNumbers(parsed.completedLevels, { min: 1, max: CAMPAIGN_CONFIG.totalLevels });
  const openedChests = uniqueNumbers(parsed.openedChests, { min: 0, max: campaignChestMilestones().length - 1 });
  const unlockedRuleIds = uniqueStrings(parsed.unlockedRuleIds).filter((id) => plan.allRuleIds.includes(id));
  const highestCompleted = completed.length ? Math.max(...completed) : 0;
  const highestUnlockedLevel = Math.max(
    1,
    Math.min(
      CAMPAIGN_CONFIG.totalLevels,
      Math.max(Number(parsed.highestUnlockedLevel) || 1, Math.min(CAMPAIGN_CONFIG.totalLevels, highestCompleted + 1))
    )
  );
  const mergedUnlocked = uniqueStrings([...(plan.basicRules || []), ...unlockedRuleIds]);
  return {
    highestUnlockedLevel,
    completedLevels: completed,
    openedChests,
    unlockedRuleIds: mergedUnlocked,
  };
}

function saveCampaignProgress() {
  if (state.account && state.campaign) state.account.campaign = state.campaign;
}

function loadCampaignProgress(plan) {
  state.campaign = normalizeCampaignProgress(state.account?.campaign, plan);
  saveCampaignProgress();
}

function ruleNameById(ruleId) {
  return state.campaignRuleCatalog?.find((rule) => rule.id === ruleId)?.name || ruleId;
}

function createSvg(tag) {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function campaignWorldTemplate(worldIndex) {
  const templates = [
    {
      x: 160,
      y: 2880,
      w: 620,
      h: 410,
      biome: "grass",
      elevation: "low",
      shape: "chunk-a",
      setpiece: "tower",
      setpieceAt: [0.16, 0.28],
      labelAt: [0.08, 0.12],
      path: [
        [0.14, 0.77],
        [0.27, 0.66],
        [0.39, 0.76],
        [0.54, 0.63],
        [0.69, 0.70],
        [0.82, 0.55],
        [0.70, 0.38],
        [0.55, 0.30],
        [0.36, 0.39],
        [0.22, 0.28],
      ],
      decorations: [
        ["hill", 0.08, 0.55, 74],
        ["hill small", 0.19, 0.51, 46],
        ["pipe", 0.68, 0.50, 40],
        ["trees", 0.43, 0.42, 72],
        ["flower", 0.77, 0.28, 28],
      ],
    },
    {
      x: 150,
      y: 2260,
      w: 700,
      h: 430,
      biome: "hills",
      elevation: "mid",
      shape: "chunk-b",
      setpiece: "bridge",
      setpieceAt: [0.83, 0.48],
      labelAt: [0.08, 0.14],
      path: [
        [0.12, 0.72],
        [0.22, 0.56],
        [0.22, 0.34],
        [0.39, 0.27],
        [0.57, 0.34],
        [0.72, 0.44],
        [0.61, 0.63],
        [0.43, 0.74],
        [0.28, 0.72],
        [0.13, 0.84],
      ],
      decorations: [
        ["hill", 0.08, 0.22, 70],
        ["hill small", 0.21, 0.18, 42],
        ["pipe", 0.55, 0.55, 42],
        ["ladder", 0.24, 0.70, 48],
        ["rocks", 0.44, 0.50, 66],
      ],
    },
    {
      x: 790,
      y: 2100,
      w: 760,
      h: 450,
      biome: "forest",
      elevation: "mid",
      shape: "chunk-c",
      setpiece: "fort",
      setpieceAt: [0.66, 0.50],
      labelAt: [0.08, 0.13],
      path: [
        [0.11, 0.65],
        [0.26, 0.72],
        [0.38, 0.56],
        [0.28, 0.38],
        [0.42, 0.25],
        [0.57, 0.35],
        [0.70, 0.25],
        [0.84, 0.39],
        [0.72, 0.58],
        [0.86, 0.73],
      ],
      decorations: [
        ["trees", 0.18, 0.28, 84],
        ["trees", 0.60, 0.62, 92],
        ["pipe", 0.48, 0.48, 38],
        ["flower", 0.77, 0.18, 30],
        ["bridge", 0.03, 0.76, 80],
      ],
    },
    {
      x: 760,
      y: 1520,
      w: 810,
      h: 470,
      biome: "cliff",
      elevation: "high",
      shape: "chunk-d",
      setpiece: "waterfall",
      setpieceAt: [0.63, 0.20],
      labelAt: [0.08, 0.13],
      path: [
        [0.10, 0.70],
        [0.21, 0.52],
        [0.35, 0.58],
        [0.48, 0.43],
        [0.61, 0.53],
        [0.76, 0.42],
        [0.88, 0.56],
        [0.73, 0.73],
        [0.55, 0.75],
        [0.41, 0.84],
      ],
      decorations: [
        ["water", 0.55, 0.25, 112],
        ["pipe", 0.77, 0.55, 42],
        ["rocks", 0.34, 0.68, 76],
        ["ladder", 0.23, 0.68, 54],
        ["hill small", 0.14, 0.28, 46],
      ],
    },
    {
      x: 1600,
      y: 1760,
      w: 700,
      h: 520,
      biome: "forest",
      elevation: "high",
      shape: "chunk-e",
      setpiece: "castle",
      setpieceAt: [0.31, 0.69],
      labelAt: [0.08, 0.11],
      path: [
        [0.16, 0.76],
        [0.31, 0.67],
        [0.47, 0.76],
        [0.63, 0.68],
        [0.79, 0.76],
        [0.82, 0.54],
        [0.65, 0.45],
        [0.48, 0.50],
        [0.34, 0.35],
        [0.52, 0.23],
      ],
      decorations: [
        ["forest", 0.14, 0.24, 150],
        ["forest", 0.62, 0.24, 130],
        ["trees", 0.55, 0.66, 92],
        ["pipe", 0.78, 0.41, 38],
        ["flower", 0.24, 0.55, 26],
      ],
    },
    {
      x: 1500,
      y: 2810,
      w: 840,
      h: 470,
      biome: "desert",
      elevation: "mid",
      shape: "chunk-f",
      setpiece: "ruin",
      setpieceAt: [0.64, 0.58],
      labelAt: [0.08, 0.13],
      path: [
        [0.13, 0.36],
        [0.28, 0.28],
        [0.43, 0.36],
        [0.58, 0.28],
        [0.74, 0.39],
        [0.87, 0.56],
        [0.72, 0.72],
        [0.53, 0.64],
        [0.35, 0.75],
        [0.19, 0.62],
      ],
      decorations: [
        ["rocks", 0.20, 0.46, 110],
        ["rocks", 0.55, 0.42, 94],
        ["pipe", 0.13, 0.68, 40],
        ["bones", 0.72, 0.65, 62],
        ["ladder", 0.02, 0.45, 48],
      ],
    },
    {
      x: 1010,
      y: 2500,
      w: 520,
      h: 300,
      biome: "volcano",
      elevation: "high",
      shape: "chunk-g",
      setpiece: "castle",
      setpieceAt: [0.52, 0.28],
      labelAt: [0.08, 0.17],
      path: [
        [0.15, 0.72],
        [0.30, 0.62],
        [0.44, 0.70],
        [0.61, 0.60],
        [0.79, 0.70],
        [0.81, 0.42],
        [0.63, 0.35],
        [0.48, 0.48],
        [0.32, 0.38],
        [0.17, 0.48],
      ],
      decorations: [
        ["rocks", 0.17, 0.18, 82],
        ["water", 0.68, 0.18, 74],
        ["bridge", 0.31, 0.80, 78],
        ["pipe", 0.06, 0.62, 38],
      ],
    },
    {
      x: 1680,
      y: 1110,
      w: 700,
      h: 480,
      biome: "grass",
      elevation: "high",
      shape: "chunk-h",
      setpiece: "tower",
      setpieceAt: [0.74, 0.24],
      labelAt: [0.08, 0.14],
      path: [
        [0.13, 0.74],
        [0.27, 0.60],
        [0.42, 0.70],
        [0.56, 0.55],
        [0.70, 0.64],
        [0.84, 0.48],
        [0.72, 0.31],
        [0.54, 0.27],
        [0.39, 0.37],
        [0.21, 0.30],
      ],
      decorations: [
        ["hill", 0.71, 0.12, 76],
        ["hill small", 0.84, 0.18, 48],
        ["forest", 0.13, 0.38, 128],
        ["pipe", 0.45, 0.47, 40],
        ["ladder", 0.89, 0.58, 58],
      ],
    },
    {
      x: 1090,
      y: 820,
      w: 620,
      h: 360,
      biome: "ice",
      elevation: "mid",
      shape: "chunk-i",
      setpiece: "observatory",
      setpieceAt: [0.68, 0.30],
      labelAt: [0.08, 0.15],
      path: [
        [0.12, 0.72],
        [0.24, 0.54],
        [0.39, 0.63],
        [0.53, 0.47],
        [0.70, 0.57],
        [0.86, 0.43],
        [0.72, 0.26],
        [0.55, 0.30],
        [0.38, 0.24],
        [0.22, 0.35],
      ],
      decorations: [
        ["iceberg", 0.09, 0.20, 58],
        ["iceberg", 0.77, 0.68, 64],
        ["water", 0.42, 0.40, 86],
        ["pipe", 0.18, 0.60, 36],
      ],
    },
    {
      x: 300,
      y: 360,
      w: 820,
      h: 430,
      biome: "sky",
      elevation: "high",
      shape: "star",
      setpiece: "gate",
      setpieceAt: [0.53, 0.45],
      labelAt: [0.10, 0.16],
      path: [
        [0.11, 0.52],
        [0.24, 0.33],
        [0.38, 0.47],
        [0.50, 0.22],
        [0.62, 0.47],
        [0.78, 0.33],
        [0.90, 0.52],
        [0.71, 0.64],
        [0.59, 0.83],
        [0.50, 0.61],
      ],
      decorations: [
        ["cloud", 0.05, -0.08, 108],
        ["cloud", 0.78, -0.10, 118],
        ["flower", 0.24, 0.42, 30],
        ["flower", 0.75, 0.43, 30],
        ["water", 0.46, 0.42, 72],
      ],
    },
  ];
  return templates[worldIndex % templates.length];
}

function clampCampaignPointToWorld(point, worldIndex) {
  const template = campaignWorldTemplate(worldIndex);
  const rowOffset = Math.floor(worldIndex / 10) * 420;
  const margin = 54;
  point.x = clamp(point.x, template.x + margin, template.x + template.w - margin);
  point.y = clamp(point.y, template.y + rowOffset + margin, template.y + rowOffset + template.h - margin);
}

function relaxCampaignLevelPositions(levels, worlds) {
  const minGap = 86;
  for (let pass = 0; pass < 4; pass++) {
    for (let worldIndex = 0; worldIndex < worlds; worldIndex++) {
      const worldLevels = levels.filter((level) => level.worldIndex === worldIndex);
      for (let i = 0; i < worldLevels.length; i++) {
        for (let j = i + 1; j < worldLevels.length; j++) {
          const a = worldLevels[i];
          const b = worldLevels[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 1;
          if (distance >= minGap) continue;
          const push = (minGap - distance) / 2;
          const ux = dx / distance;
          const uy = dy / distance;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
          clampCampaignPointToWorld(a, worldIndex);
          clampCampaignPointToWorld(b, worldIndex);
        }
      }
    }
  }
}

function campaignChestCandidateScore(candidate, nearbyLevels, existingChests) {
  const nearestLevel = nearbyLevels.reduce((nearest, level) => Math.min(nearest, Math.hypot(candidate.x - level.x, candidate.y - level.y)), Infinity);
  const nearestChest = existingChests.reduce((nearest, chest) => Math.min(nearest, Math.hypot(candidate.x - chest.x, candidate.y - chest.y)), Infinity);
  const levelScore = Math.min(nearestLevel, 150);
  const chestScore = Math.min(nearestChest, 170);
  return levelScore + chestScore * 0.8;
}

function placeCampaignChest({ from, to, milestone, index, levels, existingChests }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const nx = -uy;
  const ny = ux;
  const sameWorld = from.worldIndex === to.worldIndex;
  const nearbyLevels = levels.filter(
    (level) => Math.abs(level.level - milestone) <= 5 || level.worldIndex === from.worldIndex || level.worldIndex === to.worldIndex
  );
  const signs = index % 2 === 0 ? [1, -1] : [-1, 1];
  const offsets = sameWorld ? [82, 104, 62, 126] : [64, 86, 44, 108];
  const alongs = [0.5, 0.42, 0.58, 0.34, 0.66];
  let best = null;

  for (const sign of signs) {
    for (const offset of offsets) {
      for (const along of alongs) {
        const candidate = {
          x: from.x + dx * along + nx * offset * sign,
          y: from.y + dy * along + ny * offset * sign,
        };
        if (sameWorld) clampCampaignPointToWorld(candidate, from.worldIndex);
        const score = campaignChestCandidateScore(candidate, nearbyLevels, existingChests);
        if (!best || score > best.score) best = { ...candidate, score };
      }
    }
  }

  return {
    chestIndex: index,
    milestone,
    worldIndex: from.worldIndex,
    x: best?.x ?? (from.x + to.x) / 2,
    y: best?.y ?? (from.y + to.y) / 2,
  };
}

function buildCampaignLayout(plan) {
  const totalLevels = CAMPAIGN_CONFIG.totalLevels;
  const worlds = Math.ceil(totalLevels / CAMPAIGN_CONFIG.levelsPerWorld);
  const sceneWidth = 2520;
  const sceneHeight = Math.max(3460, worlds > 10 ? 3460 + (worlds - 10) * 420 : 3460);
  const levels = [];

  for (let level = 1; level <= totalLevels; level++) {
    const worldIndex = Math.floor((level - 1) / CAMPAIGN_CONFIG.levelsPerWorld);
    const inWorldIndex = (level - 1) % CAMPAIGN_CONFIG.levelsPerWorld;
    const template = campaignWorldTemplate(worldIndex);
    const rowOffset = Math.floor(worldIndex / 10) * 420;
    const pathPoint = template.path[inWorldIndex] || template.path[template.path.length - 1];
    const x = template.x + pathPoint[0] * template.w;
    const y = template.y + rowOffset + pathPoint[1] * template.h;
    levels.push({
      level,
      worldIndex,
      biome: template.biome || CAMPAIGN_BIOMES[worldIndex % CAMPAIGN_BIOMES.length],
      x,
      y,
    });
  }
  relaxCampaignLevelPositions(levels, worlds);

  const chests = [];
  plan.chestLevels.forEach((milestone, index) => {
    const from = levels[Math.max(0, milestone - 1)] || levels[levels.length - 1];
    const to = levels[Math.min(levels.length - 1, milestone)] || from;
    chests.push(placeCampaignChest({ from, to, milestone, index, levels, existingChests: chests }));
  });

  const islands = [];
  const setpieces = [];
  const decorations = [];
  const worldLabels = [];

  for (let worldIndex = 0; worldIndex < worlds; worldIndex++) {
    const template = campaignWorldTemplate(worldIndex);
    const rowOffset = Math.floor(worldIndex / 10) * 420;
    const worldLevels = levels.filter((l) => l.worldIndex === worldIndex);
    if (!worldLevels.length) continue;
    islands.push({
      x: template.x,
      y: template.y + rowOffset,
      w: template.w,
      h: template.h,
      biome: worldLevels[0].biome,
      elevation: template.elevation || (worldIndex % 3 === 0 ? "low" : worldIndex % 3 === 1 ? "mid" : "high"),
      shape: template.shape || "chunk-a",
    });

    setpieces.push({
      type: template.setpiece || "castle",
      biome: worldLevels[0].biome,
      x: template.x + (template.setpieceAt?.[0] ?? 0.72) * template.w,
      y: template.y + rowOffset + (template.setpieceAt?.[1] ?? 0.36) * template.h,
    });

    if (worldIndex > 0) {
      const start = worldLevels[0];
      setpieces.push({
        type: "gate",
        biome: worldLevels[0].biome,
        x: start.x - 26,
        y: start.y + 26,
      });
    }

    for (const decoration of template.decorations || []) {
      const [type, rx, ry, size] = decoration;
      decorations.push({
        type,
        biome: worldLevels[0].biome,
        size,
        x: template.x + rx * template.w,
        y: template.y + rowOffset + ry * template.h,
      });
    }

    worldLabels.push({
      x: template.x + (template.labelAt?.[0] ?? 0.08) * template.w,
      y: template.y + rowOffset + (template.labelAt?.[1] ?? 0.12) * template.h,
      text: `World ${worldIndex + 1}`,
      biome: worldLevels[0].biome,
    });
  }

  return {
    key: `${totalLevels}:${plan.chestLevels.join(",")}`,
    width: sceneWidth,
    height: sceneHeight,
    levels,
    chests,
    islands,
    setpieces,
    decorations,
    worldLabels,
  };
}

function ensureCampaignLayout(plan) {
  const nextKey = `${CAMPAIGN_CONFIG.totalLevels}:${plan.chestLevels.join(",")}`;
  if (!state.campaignLayout || state.campaignLayout.key !== nextKey) {
    state.campaignLayout = buildCampaignLayout(plan);
    state.campaignPan = null;
    state.campaignPanLayoutKey = "";
  }
  return state.campaignLayout;
}

function campaignPanBounds(layout) {
  const zoom = clamp(Number(state.campaignPan?.zoom) || 1, CAMPAIGN_MAP_MIN_ZOOM, CAMPAIGN_MAP_MAX_ZOOM);
  const scaledWidth = layout.width * zoom;
  const scaledHeight = layout.height * zoom;
  const viewportW = Math.max(1, els.campaignMap?.clientWidth || 1);
  const viewportH = Math.max(1, els.campaignMap?.clientHeight || 1);
  return {
    minX: Math.min(0, viewportW - scaledWidth - 40),
    maxX: 20,
    minY: Math.min(0, viewportH - scaledHeight - 40),
    maxY: 20,
    viewportW,
    viewportH,
  };
}

function applyCampaignPan() {
  if (!state.campaignPan || !els.campaignMap) return;
  const scene = els.campaignMap.querySelector(".overworldScene");
  if (!scene) return;
  const zoom = clamp(Number(state.campaignPan.zoom) || 1, CAMPAIGN_MAP_MIN_ZOOM, CAMPAIGN_MAP_MAX_ZOOM);
  scene.style.transform = `translate(${Math.round(state.campaignPan.x)}px, ${Math.round(state.campaignPan.y)}px) scale(${zoom})`;
}

function ensureCampaignPan(layout) {
  if (!els.campaignMap) return;
  const bounds = campaignPanBounds(layout);
  const startLevel = layout.levels[0] || { x: 120, y: layout.height - 120 };
  const defaultX = 80 - startLevel.x;
  const defaultY = bounds.viewportH - 150 - startLevel.y;
  if (!state.campaignPan || state.campaignPanLayoutKey !== layout.key) {
    state.campaignPan = {
      x: clamp(defaultX, bounds.minX, bounds.maxX),
      y: clamp(defaultY, bounds.minY, bounds.maxY),
      zoom: 1,
      dragging: false,
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      startPanX: 0,
      startPanY: 0,
      moved: false,
    };
    state.campaignPanLayoutKey = layout.key;
  } else {
    state.campaignPan.zoom = clamp(Number(state.campaignPan.zoom) || 1, CAMPAIGN_MAP_MIN_ZOOM, CAMPAIGN_MAP_MAX_ZOOM);
    state.campaignPan.x = clamp(state.campaignPan.x, bounds.minX, bounds.maxX);
    state.campaignPan.y = clamp(state.campaignPan.y, bounds.minY, bounds.maxY);
  }
  applyCampaignPan();
}

function campaignClickAllowed() {
  return Date.now() >= (state.campaignSuppressClickUntil || 0);
}

function bindCampaignPanHandlers() {
  if (!els.campaignMap || state.campaignPanBound) return;
  const map = els.campaignMap;
  map.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (!state.campaignPan || !state.campaignLayout) return;
    state.campaignPan.dragging = true;
    state.campaignPan.pointerId = ev.pointerId;
    state.campaignPan.startClientX = ev.clientX;
    state.campaignPan.startClientY = ev.clientY;
    state.campaignPan.startPanX = state.campaignPan.x;
    state.campaignPan.startPanY = state.campaignPan.y;
    state.campaignPan.moved = false;
    map.classList.add("is-grabbing");
    map.setPointerCapture?.(ev.pointerId);
  });
  map.addEventListener("pointermove", (ev) => {
    if (!state.campaignPan?.dragging || state.campaignPan.pointerId !== ev.pointerId) return;
    const bounds = campaignPanBounds(state.campaignLayout);
    const dx = ev.clientX - state.campaignPan.startClientX;
    const dy = ev.clientY - state.campaignPan.startClientY;
    state.campaignPan.moved = state.campaignPan.moved || Math.abs(dx) + Math.abs(dy) > 6;
    state.campaignPan.x = clamp(state.campaignPan.startPanX + dx, bounds.minX, bounds.maxX);
    state.campaignPan.y = clamp(state.campaignPan.startPanY + dy, bounds.minY, bounds.maxY);
    applyCampaignPan();
  });
  const endDrag = (ev) => {
    if (!state.campaignPan?.dragging) return;
    if (state.campaignPan.pointerId != null && ev && state.campaignPan.pointerId !== ev.pointerId) return;
    const moved = state.campaignPan.moved;
    state.campaignPan.dragging = false;
    state.campaignPan.pointerId = null;
    state.campaignPan.moved = false;
    map.classList.remove("is-grabbing");
    if (moved) state.campaignSuppressClickUntil = Date.now() + 140;
  };
  map.addEventListener("pointerup", endDrag);
  map.addEventListener("pointercancel", endDrag);
  map.addEventListener("pointerleave", endDrag);
  map.addEventListener("wheel", (ev) => {
    if (!state.campaignPan || !state.campaignLayout) return;
    ev.preventDefault();
    const oldZoom = clamp(Number(state.campaignPan.zoom) || 1, CAMPAIGN_MAP_MIN_ZOOM, CAMPAIGN_MAP_MAX_ZOOM);
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? map.clientHeight : 1;
    const wheelDelta = ev.deltaY * unit;
    const nextZoom = clamp(oldZoom * Math.exp(-wheelDelta * CAMPAIGN_MAP_ZOOM_STEP), CAMPAIGN_MAP_MIN_ZOOM, CAMPAIGN_MAP_MAX_ZOOM);
    if (Math.abs(nextZoom - oldZoom) < 0.0001) return;
    const rect = map.getBoundingClientRect();
    const focusX = ev.clientX - rect.left;
    const focusY = ev.clientY - rect.top;
    state.campaignPan.zoom = nextZoom;
    state.campaignPan.x = focusX - ((focusX - state.campaignPan.x) / oldZoom) * nextZoom;
    state.campaignPan.y = focusY - ((focusY - state.campaignPan.y) / oldZoom) * nextZoom;
    const bounds = campaignPanBounds(state.campaignLayout);
    state.campaignPan.x = clamp(state.campaignPan.x, bounds.minX, bounds.maxX);
    state.campaignPan.y = clamp(state.campaignPan.y, bounds.minY, bounds.maxY);
    applyCampaignPan();
  }, { passive: false });
  state.campaignPanBound = true;
}

function campaignRulePoolForSingleplayer() {
  const catalog = state.campaignRuleCatalog || [];
  const plan = buildCampaignRulePlan(catalog);
  if (!state.campaign) loadCampaignProgress(plan);
  const unlocked = uniqueStrings(state.campaign?.unlockedRuleIds || []).filter((id) => plan.allRuleIds.includes(id));
  return unlocked.length ? unlocked : plan.basicRules;
}

function campaignRuleCardForId(ruleId) {
  const rule = state.campaignRuleCatalog?.find((r) => r.id === ruleId);
  if (!rule) {
    return {
      id: ruleId,
      name: ruleNameById(ruleId),
      description: "New rule unlocked.",
      kind: "instant",
      typeLabel: "Rule",
      remaining: null,
    };
  }
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    kind: rule.kind,
    typeLabel: rule.typeLabel || (rule.kind === "instant" ? "Instant" : rule.kind === "delayed" ? `In ${rule.delayTurns || "?"} Turns` : `For ${rule.durationTurns || "?"} Turns`),
    remaining: rule.kind === "duration" ? rule.durationTurns : rule.kind === "delayed" ? rule.delayTurns : null,
  };
}

function renderCampaignChestRewards(ruleIds) {
  if (!els.campaignChestRewards) return;
  els.campaignChestRewards.innerHTML = "";
  const rewards = uniqueStrings(ruleIds);
  if (!rewards.length) {
    const empty = document.createElement("div");
    empty.className = "campaignChestEmptyReward";
    empty.textContent = "Bonus chest";
    els.campaignChestRewards.appendChild(empty);
    return;
  }
  rewards.forEach((ruleId, index) => {
    const reward = document.createElement("div");
    reward.className = "campaignChestReward";
    reward.style.setProperty("--i", String(index));
    reward.appendChild(buildRuleCard(campaignRuleCardForId(ruleId), { pickable: false }));
    els.campaignChestRewards.appendChild(reward);
  });
}

function closeCampaignChestModal({ refresh = true } = {}) {
  if (els.campaignChestModal) els.campaignChestModal.hidden = true;
  if (els.campaignChestStage) {
    els.campaignChestStage.classList.remove("is-opening", "is-opened", "is-error");
    els.campaignChestStage.style.removeProperty("--handle-lift");
  }
  if (els.campaignChestRewards) els.campaignChestRewards.innerHTML = "";
  if (els.campaignChestOkBtn) els.campaignChestOkBtn.hidden = true;
  state.campaignChestModal = null;
  if (refresh) renderCampaignMap();
}

function showCampaignChestModal(chestIndex) {
  const catalog = state.campaignRuleCatalog || [];
  const plan = buildCampaignRulePlan(catalog);
  if (!state.campaign) loadCampaignProgress(plan);
  const chestLevel = plan.chestLevels[chestIndex];
  if (chestLevel == null || state.campaign.highestUnlockedLevel <= chestLevel || state.campaign.openedChests.includes(chestIndex)) return;
  state.campaignChestModal = {
    chestIndex,
    opening: false,
    opened: false,
    startClientY: 0,
    lift: 0,
  };
  if (els.campaignChestModal) els.campaignChestModal.hidden = false;
  if (els.campaignChestStage) {
    els.campaignChestStage.classList.remove("is-opening", "is-opened", "is-error");
    els.campaignChestStage.style.setProperty("--handle-lift", "0px");
  }
  if (els.campaignChestRewards) els.campaignChestRewards.innerHTML = "";
  if (els.campaignChestStatus) els.campaignChestStatus.textContent = `Chest ${chestIndex + 1}`;
  if (els.campaignChestOkBtn) els.campaignChestOkBtn.hidden = true;
}

async function openCampaignChest(chestIndex, { auto = false } = {}) {
  const catalog = state.campaignRuleCatalog || [];
  const plan = buildCampaignRulePlan(catalog);
  if (!state.campaign) loadCampaignProgress(plan);
  const chestLevel = plan.chestLevels[chestIndex];
  if (chestLevel == null) return;
  if (state.campaign.highestUnlockedLevel <= chestLevel) return;
  if (state.campaign.openedChests.includes(chestIndex)) return;
  const res = await fetch("/api/me/campaign", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "openChest", chestIndex }),
  });
  const json = await res.json();
  if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to open chest.");
  state.campaign = normalizeCampaignProgress(json.campaign, plan);
  if (json.user) {
    state.account = json.user;
    saveAccountSession();
    renderAccountUI();
  } else {
    saveCampaignProgress();
  }

  if (els.campaignNotice) {
    const rewards = Array.isArray(json.rewards) ? json.rewards : [];
    if (rewards.length) {
      const rewardNames = rewards.slice(0, 3).map((id) => ruleNameById(id));
      const suffix = rewards.length > 3 ? ` +${rewards.length - 3} more` : "";
      els.campaignNotice.textContent = `${auto ? "Auto-opened chest" : "Opened chest"}: ${rewardNames.join(", ")}${suffix}`;
    } else {
      els.campaignNotice.textContent = `${auto ? "Auto-opened chest" : "Opened chest"}: bonus chest (no new rules).`;
    }
  }
  return Array.isArray(json.rewards) ? json.rewards : [];
}

async function revealCampaignChest() {
  const modalState = state.campaignChestModal;
  if (!modalState || modalState.opening || modalState.opened) return;
  modalState.opening = true;
  if (els.campaignChestStage) els.campaignChestStage.classList.add("is-opening");
  if (els.campaignChestStatus) els.campaignChestStatus.textContent = "Opening...";
  try {
    const rewards = await openCampaignChest(modalState.chestIndex);
    modalState.opened = true;
    modalState.rewards = rewards;
    if (els.campaignChestStage) {
      els.campaignChestStage.classList.remove("is-opening");
      els.campaignChestStage.classList.add("is-opened");
      els.campaignChestStage.style.setProperty("--handle-lift", "-44px");
    }
    renderCampaignChestRewards(rewards);
    if (els.campaignChestStatus) {
      els.campaignChestStatus.textContent = rewards?.length ? "Unlocked rules" : "Opened";
    }
    if (els.campaignChestOkBtn) els.campaignChestOkBtn.hidden = false;
    if (els.profileModal && !els.profileModal.hidden) renderProfile();
  } catch (err) {
    modalState.opening = false;
    if (els.campaignChestStage) {
      els.campaignChestStage.classList.remove("is-opening");
      els.campaignChestStage.classList.add("is-error");
    }
    if (els.campaignChestStatus) els.campaignChestStatus.textContent = err.message || "Failed to open chest.";
    if (els.campaignChestOkBtn) els.campaignChestOkBtn.hidden = false;
  }
}

function renderCampaignMap() {
  if (!els.campaignMap || !els.campaignSummary || !els.campaignNotice || !state.campaignRuleCatalog) return;
  const plan = buildCampaignRulePlan(state.campaignRuleCatalog);
  const layout = ensureCampaignLayout(plan);
  if (!state.campaign) loadCampaignProgress(plan);
  const completed = new Set(state.campaign.completedLevels || []);
  const openedChests = new Set(state.campaign.openedChests || []);
  const highestUnlocked = state.campaign.highestUnlockedLevel || 1;
  const unlockedRuleCount = uniqueStrings(state.campaign.unlockedRuleIds || []).length;
  const totalRuleCount = plan.allRuleIds.length;
  els.campaignSummary.textContent = `Level ${highestUnlocked}/${CAMPAIGN_CONFIG.totalLevels} unlocked | ${unlockedRuleCount}/${totalRuleCount} rules unlocked`;
  els.campaignNotice.textContent = els.campaignNotice.textContent || "Open chest nodes when they become available.";
  els.campaignMap.innerHTML = "";

  const scene = document.createElement("div");
  scene.className = "overworldScene";
  scene.style.width = `${layout.width}px`;
  scene.style.height = `${layout.height}px`;
  els.campaignMap.appendChild(scene);

  for (const island of layout.islands) {
    const piece = document.createElement("div");
    piece.className = `mapIsland ${island.biome} ${island.elevation} ${island.shape || ""}`.trim();
    piece.style.left = `${island.x}px`;
    piece.style.top = `${island.y}px`;
    piece.style.width = `${island.w}px`;
    piece.style.height = `${island.h}px`;
    scene.appendChild(piece);
  }

  for (const label of layout.worldLabels || []) {
    const worldLabel = document.createElement("div");
    worldLabel.className = `mapWorldLabel ${label.biome}`;
    worldLabel.style.left = `${label.x}px`;
    worldLabel.style.top = `${label.y}px`;
    worldLabel.textContent = label.text;
    scene.appendChild(worldLabel);
  }

  for (const setpiece of layout.setpieces || []) {
    const landmark = document.createElement("div");
    landmark.className = `mapSetpiece ${setpiece.type} ${setpiece.biome}`;
    landmark.style.left = `${setpiece.x}px`;
    landmark.style.top = `${setpiece.y}px`;
    scene.appendChild(landmark);
  }

  for (const decoration of layout.decorations || []) {
    const prop = document.createElement("div");
    prop.className = `mapDecor ${decoration.type} ${decoration.biome}`.trim();
    prop.style.left = `${decoration.x}px`;
    prop.style.top = `${decoration.y}px`;
    if (decoration.size) prop.style.setProperty("--s", `${decoration.size}px`);
    scene.appendChild(prop);
  }

  const routeStops = [];
  for (const levelPoint of layout.levels) {
    routeStops.push({ kind: "level", level: levelPoint.level, worldIndex: levelPoint.worldIndex, x: levelPoint.x, y: levelPoint.y });
    const chestIndex = plan.chestLevels.indexOf(levelPoint.level);
    if (chestIndex >= 0) {
      const chest = layout.chests[chestIndex];
      if (chest) routeStops.push({ kind: "chest", chestIndex, worldIndex: chest.worldIndex, x: chest.x, y: chest.y });
    }
  }

  const routeSvg = createSvg("svg");
  routeSvg.setAttribute("class", "overworldRoutes");
  routeSvg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  routeSvg.setAttribute("preserveAspectRatio", "none");
  scene.appendChild(routeSvg);

  for (let i = 0; i < routeStops.length - 1; i++) {
    const from = routeStops[i];
    const to = routeStops[i + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;
    const curve = Math.min(88, distance * 0.16) * (i % 2 === 0 ? 1 : -1);
    const cx = (from.x + to.x) / 2 + (-dy / distance) * curve;
    const cy = (from.y + to.y) / 2 + (dx / distance) * curve;
    const path = createSvg("path");
    path.setAttribute("d", `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`);
    const className = from.worldIndex !== to.worldIndex ? "routeLine routeLineInterworld" : "routeLine";
    path.setAttribute("class", className);
    routeSvg.appendChild(path);
  }

  for (const stop of routeStops) {
    const point = createSvg("circle");
    point.setAttribute("cx", String(stop.x));
    point.setAttribute("cy", String(stop.y));
    point.setAttribute("r", stop.kind === "chest" ? "6" : "4");
    point.setAttribute("class", `routeDot ${stop.kind === "chest" ? "chestDot" : ""}`.trim());
    routeSvg.appendChild(point);
  }

  for (const levelData of layout.levels) {
    const level = levelData.level;
    const isCompleted = completed.has(level);
    const isUnlocked = level <= highestUnlocked;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `worldNode${isCompleted ? " completed" : ""}${isUnlocked && !isCompleted ? " current" : ""}${!isUnlocked ? " locked" : ""}`;
    btn.style.left = `${levelData.x}px`;
    btn.style.top = `${levelData.y}px`;
    btn.disabled = !isUnlocked;
    btn.innerHTML = `<span class="worldDot"></span><span class="worldLabel">${level}</span>`;
    btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    btn.addEventListener("click", () => {
      if (!campaignClickAllowed()) return;
      startCampaignLevel(level);
    });
    scene.appendChild(btn);
  }

  for (let chestIndex = 0; chestIndex < plan.chestLevels.length; chestIndex++) {
    const pos = layout.chests[chestIndex];
    if (!pos) continue;
    const milestone = plan.chestLevels[chestIndex];
    const chestUnlocked = highestUnlocked > milestone;
    const chestOpened = openedChests.has(chestIndex);
    const chest = document.createElement("button");
    chest.type = "button";
    chest.className = `worldChest${chestOpened ? " opened" : chestUnlocked ? " ready" : " locked"}`;
    chest.style.left = `${pos.x}px`;
    chest.style.top = `${pos.y}px`;
    chest.disabled = !chestUnlocked || chestOpened;
    chest.innerHTML = `<span class="chestIcon"></span><span class="worldLabel">${chestIndex + 1}</span>`;
    chest.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    chest.addEventListener("click", async () => {
      if (!campaignClickAllowed()) return;
      showCampaignChestModal(chestIndex);
    });
    scene.appendChild(chest);
  }

  ensureCampaignPan(layout);
  bindCampaignPanHandlers();
  applyCampaignPan();
}

async function openCampaignMap() {
  if (!ensureSignedIn()) return;
  try {
    await refreshAccount();
    const catalog = await ensureCampaignRuleCatalog();
    const plan = buildCampaignRulePlan(catalog);
    loadCampaignProgress(plan);
    state.view = "campaign";
    syncUI();
    renderCampaignMap();
  } catch (err) {
    logLine(`<strong>Campaign</strong>: ${escapeHtml(err.message || "Failed to open campaign map.")}`);
  }
}

function closeCampaignMap() {
  state.view = "lobby";
  if (els.campaignNotice) els.campaignNotice.textContent = "";
  syncUI();
}

async function resetCampaignProgress() {
  if (!confirm("Reset singleplayer campaign progress?")) return;
  try {
    const catalog = await ensureCampaignRuleCatalog();
    const plan = buildCampaignRulePlan(catalog);
    const res = await fetch("/api/me/campaign", {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to reset campaign.");
    state.campaign = normalizeCampaignProgress(json.campaign, plan);
    if (json.user) {
      state.account = json.user;
      saveAccountSession();
      renderAccountUI();
    } else {
      saveCampaignProgress();
    }
    if (els.campaignNotice) els.campaignNotice.textContent = "Campaign progress reset.";
    renderCampaignMap();
    if (els.profileModal && !els.profileModal.hidden) renderProfile();
  } catch (err) {
    logLine(`<strong>Campaign</strong>: ${escapeHtml(err.message || "Failed to reset campaign.")}`);
  }
}

function loadAccountSession() {
  const saved = window.ChaosChessStorage.loadAccountSession();
  if (saved.token) state.authToken = saved.token;
  if (saved.user) state.account = saved.user;
}

function saveAccountSession() {
  window.ChaosChessStorage.saveAccountSession({
    token: state.authToken,
    user: state.account,
  });
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
  const avatar = avatarMarkup(profile, user.username, "Profile avatar");
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

function avatarUrl(profile, fallbackSeed = "player") {
  if (profile?.avatarUrl) return profile.avatarUrl;
  const style = String(profile?.avatar || "lorelei").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "lorelei";
  const seed = String(profile?.avatarSeed || fallbackSeed || "player").slice(0, 128);
  return `/api/avatar/${encodeURIComponent(style)}.svg?seed=${encodeURIComponent(seed)}`;
}

function avatarMarkup(profile, fallbackSeed = "player", alt = "") {
  return `<img src="${escapeAttr(avatarUrl(profile, fallbackSeed))}" alt="${escapeAttr(alt)}" loading="lazy" draggable="false" />`;
}

function n(value) {
  return Number(value || 0).toLocaleString();
}

function coinsText(user) {
  return user?.isAdmin ? "\u221E" : n(user?.stats?.coins);
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
  const mode = state.profileRulesTab === "singleplayer" ? "singleplayer" : "multiplayer";
  const subtabs = `
    <div class="profileSubtabs" role="tablist" aria-label="Rule collection mode">
      <button class="profileRulesTabBtn ${mode === "multiplayer" ? "active" : ""}" data-rules-tab="multiplayer" type="button">Multiplayer</button>
      <button class="profileRulesTabBtn ${mode === "singleplayer" ? "active" : ""}" data-rules-tab="singleplayer" type="button">Singleplayer</button>
    </div>
  `;
  if (mode === "singleplayer") return renderSingleplayerRulesTab(user, subtabs);

  const rules = user.ruleCollection || [];
  return `
    <section class="profileSection wide">
      <div class="shopHeader">
        <h3>Rule Collection</h3>
        <button id="openRuleAppendixBtn" type="button">View rule appendix</button>
      </div>
      ${subtabs}
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

function renderSingleplayerRulesTab(user, subtabs) {
  if (!Array.isArray(state.campaignRuleCatalog) || !state.campaignRuleCatalog.length) {
    ensureCampaignRuleCatalog()
      .then(() => {
        if (els.profileModal && !els.profileModal.hidden && state.profileTab === "rules") renderProfile();
      })
      .catch(() => {});
  }

  const catalog = state.campaignRuleCatalog || [];
  const plan = buildCampaignRulePlan(catalog);
  const campaign = normalizeCampaignProgress(user.campaign, plan);
  const unlocked = new Set(campaign.unlockedRuleIds || []);
  const unlockedRules = catalog.filter((rule) => unlocked.has(rule.id));

  return `
    <section class="profileSection wide">
      <div class="shopHeader">
        <h3>Rule Collection</h3>
        <button id="openRuleAppendixBtn" type="button">View rule appendix</button>
      </div>
      ${subtabs}
      <div class="profileStats">
        ${statTile("campaign level", `${n(campaign.highestUnlockedLevel)}/${n(CAMPAIGN_CONFIG.totalLevels)}`)}
        ${statTile("rules unlocked", `${n(unlockedRules.length)}/${n(plan.allRuleIds.length)}`)}
        ${statTile("chests opened", `${n((campaign.openedChests || []).length)}/${n(plan.chestLevels.length)}`)}
      </div>
      <div class="ruleMasteryGrid">
        ${
          catalog.length
            ? unlockedRules
                .map(
                  (r) => `
                    <div class="ruleMasteryCard">
                      <strong>${escapeHtml(r.name)}</strong>
                      <span>${escapeHtml(r.typeLabel || "Rule")}</span>
                      <span>${escapeHtml(r.description || "")}</span>
                    </div>
                  `
                )
                .join("") || `<div class="emptyServers">No singleplayer rules unlocked yet.</div>`
            : `<div class="emptyServers">Loading singleplayer rules...</div>`
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

function pieceSkinPreviewStyle(name) {
  const whiteStyle = pieceSkinStyle({ color: "w" }, false, name);
  const blackStyle = pieceSkinStyle({ color: "b" }, false, name);
  return [
    `--piece-preview-fill-w:${whiteStyle.fill}`,
    `--piece-preview-stroke-w:${whiteStyle.stroke}`,
    `--piece-preview-accent-w:${whiteStyle.accent || whiteStyle.stroke || "#dbe2ff"}`,
    `--piece-preview-glow-w:${whiteStyle.glow || "transparent"}`,
    `--piece-preview-fill-b:${blackStyle.fill}`,
    `--piece-preview-stroke-b:${blackStyle.stroke}`,
    `--piece-preview-accent-b:${blackStyle.accent || blackStyle.stroke || "#3c4b83"}`,
    `--piece-preview-glow-b:${blackStyle.glow || "transparent"}`,
    `--piece-preview-accent:${whiteStyle.accent || blackStyle.accent || "#dbe2ff"}`,
  ].join(";");
}
function cosmeticPreview(item) {
  const group = item.group;
  const slug = cosmeticSlug(item.name);
  const label = escapeHtml(item.label || item.name);
  if (group === "avatars") {
    const previewSeed = state.account?.profile?.avatarSeed || state.account?.id || state.account?.username || item.name;
    return `<div class="shopPreview avatarPreview">${avatarMarkup({ avatar: item.name, avatarSeed: previewSeed }, previewSeed, item.label || item.name)}</div>`;
  }
  if (group === "borders") {
    const cls = borderClass({ border: item.name });
    return `<div class="shopPreview borderPreview ${escapeAttr(cls)}"><span>${label.slice(0, 2)}</span></div>`;
  }
  if (group === "boardSkins") {
    return `<div class="shopPreview boardPreview" style="${escapeAttr(previewBoardStyle(item.name))}">${Array.from({ length: 16 }, (_, i) => `<span class="${(Math.floor(i / 4) + i) % 2 ? "dark" : "light"}"></span>`).join("")}</div>`;
  }
  if (group === "pieceSkins") {
    return `<div class="shopPreview piecePreview piecePreview-${escapeAttr(slug)}" style="${escapeAttr(pieceSkinPreviewStyle(item.name))}">
      <div class="piecePreviewChip piecePreviewChipW">
        <span class="piecePreviewGlyph piecePreviewGlyphW">${pieceGlyph("q", "w")}</span>
      </div>
      <div class="piecePreviewChip piecePreviewChipB">
        <span class="piecePreviewGlyph piecePreviewGlyphB">${pieceGlyph("q", "b")}</span>
      </div>
    </div>`;
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

function shopRarityForItem(item) {
  const explicit = String(item?.rarity || "").toLowerCase();
  if (["legendary", "epic", "rare", "common"].includes(explicit)) return explicit;
  const price = Number(item?.price || 0);
  if (price >= 1200) return "legendary";
  if (price >= 850) return "epic";
  if (price >= 500) return "rare";
  return "common";
}

function rarityLabel(rarity) {
  if (rarity === "legendary") return "Legendary";
  if (rarity === "epic") return "Epic";
  if (rarity === "rare") return "Rare";
  return "Common";
}

function shopRarityRank(rarity) {
  if (rarity === "legendary") return 4;
  if (rarity === "epic") return 3;
  if (rarity === "rare") return 2;
  return 1;
}

function featuredShopIndex(offers) {
  if (!Array.isArray(offers) || !offers.length) return -1;
  return offers.reduce((bestIndex, item, index) => {
    if (bestIndex < 0) return index;
    const rarity = shopRarityRank(shopRarityForItem(item));
    const best = offers[bestIndex];
    const bestRarity = shopRarityRank(shopRarityForItem(best));
    if (rarity !== bestRarity) return rarity > bestRarity ? index : bestIndex;
    const price = Number(item?.price || 0);
    const bestPrice = Number(best?.price || 0);
    if (price !== bestPrice) return price > bestPrice ? index : bestIndex;
    return bestIndex;
  }, -1);
}

function shopItemDescription(item) {
  const name = item?.label || item?.name || "this cosmetic";
  const group = String(item?.group || "");
  if (group === "avatars") return `Profile avatar skin: ${name}.`;
  if (group === "borders") return `Animated board border effect: ${name}.`;
  if (group === "boardSkins") return `Chessboard theme with a fresh palette: ${name}.`;
  if (group === "pieceSkins") return `Piece style pack for your full set: ${name}.`;
  if (group === "emotes") return `Quick in-match emote line: ${name}.`;
  if (group === "banners") return `Profile banner gradient style: ${name}.`;
  if (group === "cardBacks") return `Rule card back design: ${name}.`;
  return `Cosmetic unlock: ${name}.`;
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
  const featureIndex = featuredShopIndex(shop.offers);
  const orderedOffers =
    featureIndex >= 0
      ? [shop.offers[featureIndex], ...shop.offers.filter((_, index) => index !== featureIndex)]
      : shop.offers;
  els.shopOffers.innerHTML = orderedOffers
    .map((item, index) => {
      const owned = !!item.owned;
      const affordable = !!item.affordable;
      const rarity = shopRarityForItem(item);
      const description = shopItemDescription(item);
      const disabled = owned || !affordable ? "disabled" : "";
      const status = owned ? "Owned" : affordable ? "Ready to unlock" : "Need more coins";
      const layoutClass = index === 0 ? "shopFeatureTall" : "shopFeatureCompact";
      return `
        <div class="dailyShopItem ${owned ? "owned" : ""} rarity-${escapeAttr(rarity)} ${layoutClass}">
          <div class="shopRarityBadge">${rarityLabel(rarity)}</div>
          ${cosmeticPreview(item)}
          <div class="dailyShopMeta">
            <strong>${escapeHtml(item.label || item.name)}</strong>
            <div class="shopInfoGrid">
              <span><b>Type</b>${escapeHtml(cosmeticGroupLabel(item.group))}</span>
              <span><b>Rarity</b>${rarityLabel(rarity)}</span>
            </div>
            <p class="shopItemDesc">${escapeHtml(description)}</p>
            <small>${escapeHtml(status)}</small>
          </div>
          <div class="shopPriceRow">
            <span class="shopPrice">${n(item.price)} coins</span>
          </div>
          <button class="buyCosmeticBtn" type="button" data-buy-group="${escapeAttr(item.group)}" data-buy-name="${escapeAttr(item.name)}" ${disabled}>
            ${owned ? "Owned" : affordable ? "Unlock" : "Insufficient"}
          </button>
        </div>
      `;
    })
    .join("");
  if (els.shopStatus) {
    els.shopStatus.innerHTML = `<span class="shopBalancePill">Balance: ${coinsText(user)} coins</span><span class="shopSubtle">Shop Resets Daily</span>`;
  }
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
      <h3>Singleplayer Campaign</h3>
      <div class="profileList">
        <div><span>Campaign progress is stored on this browser.</span><strong>Local save</strong></div>
      </div>
      <div class="modalActions"><button id="campaignResetProfileBtn" class="dangerBtn" type="button">Reset campaign progress</button></div>
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
    const savedId = json.user?.id || user.id;
    if (state.account?.id === savedId) await refreshAccount();
    await adminRefreshUsers();
    adminSelectUser(savedId);
    setAdminStatus("Saved.");
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
  document.body.classList.toggle("is-campaign-view", !state.lobby && state.view === "campaign");
  if (!state.lobby) {
    document.body.classList.remove("is-choosing");
    document.body.classList.remove("is-debug-choice");
  }
}

loadAccountSession();
loadSession();
if (state.lobby) state.view = "game";
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

const initDraggableModals = window.ChaosChessDraggableModals.init;

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
  const size = els.canvas.width / boardSize();
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
  const size = els.canvas.width / boardSize();
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
  const size = els.canvas.width / boardSize();
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
  const size = els.canvas.width / boardSize();

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
    for (let file = 0; file < boardSize(); file++) {
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
  for (const machine of s.fruitMachines || []) drawFruitMachineTile(machine.square, t);
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

function drawFruitMachineTile(sq, t) {
  drawTileGlyph(sq, (x, y, size) => {
    const pulse = 0.5 + 0.5 * Math.sin(t / 220 + sq);
    ctx.save();
    ctx.fillStyle = `rgba(255, 79, 139, ${0.12 + pulse * 0.07})`;
    ctx.beginPath();
    ctx.arc(x, y, size * (0.45 + pulse * 0.04), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#b51d43";
    ctx.strokeStyle = "rgba(255, 247, 232, 0.82)";
    ctx.lineWidth = Math.max(2, size * 0.026);
    ctx.beginPath();
    ctx.roundRect(x - size * 0.31, y - size * 0.34, size * 0.62, size * 0.68, size * 0.06);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#fff7e8";
    ctx.fillRect(x - size * 0.22, y - size * 0.12, size * 0.44, size * 0.2);
    ctx.fillStyle = "#111827";
    ctx.font = `${Math.floor(size * 0.15)}px "Segoe UI Symbol", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u265F \u265E \u265B", x, y - size * 0.02);

    ctx.fillStyle = "#ffd166";
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6 + t / 700;
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * size * 0.35, y + Math.sin(angle) * size * 0.38, size * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#24d6c8";
    ctx.fillRect(x + size * 0.31, y - size * 0.16, size * 0.07, size * 0.26);
    ctx.beginPath();
    ctx.arc(x + size * 0.345, y - size * 0.22, size * 0.055, 0, Math.PI * 2);
    ctx.fill();
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

function fruitMachineResultLabel(result) {
  if (!result) return "Pull the lever to test your luck.";
  const glyph = result.winType ? PIECE_GLYPH_MONO[result.winType] || result.winType.toUpperCase() : "";
  if (result.prizeCount === 2) return `Jackpot: 3 of a kind. You won 2 ${glyph} pieces.`;
  if (result.prizeCount === 1) return `Nice: 2 of a kind. You won 1 ${glyph} piece.`;
  return "No match this spin.";
}

function fruitMachineCycleType(index, t = nowMs()) {
  const types = ["p", "n", "b", "r", "q", "k"];
  return types[Math.floor(t / 78 + index * 2) % types.length];
}

function fruitMachineVisibleType(index, finalType, t = nowMs()) {
  const settle = state.fruitMachineSettle;
  if (!settle || settle.key !== state.fruitMachineKey) {
    return state.fruitMachineSpinning ? fruitMachineCycleType(index, t) : finalType;
  }
  return t >= settle.ends[index] ? finalType : fruitMachineCycleType(index, t);
}

function isFruitMachineAnimating(t = nowMs()) {
  const settle = state.fruitMachineSettle;
  return state.fruitMachineSpinning || !!(settle && settle.key === state.fruitMachineKey && t < settle.doneAt);
}

function scheduleFruitMachineRerender() {
  if (!isFruitMachineAnimating()) return;
  setTimeout(() => {
    renderFruitMachine();
  }, 70);
}

function collectFruitMachinePrizes() {
  if (!state.lobby || !state.playerId || state.fruitMachineCollecting) return;
  const machine = state.serverState?.fruitMachine;
  if (!machine?.complete || machine.playerId !== state.playerId) return;
  if (isFruitMachineAnimating()) return;
  state.fruitMachineCollecting = true;
  socket.emit("game:fruitMachineCollect", { code: state.lobby, playerId: state.playerId }, (res) => {
    if (!res?.ok) {
      state.fruitMachineCollecting = false;
      logLine(`<strong>Fruit Machine</strong>: ${escapeHtml(res?.error || "payout failed")}`);
    }
    socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
  });
}

function renderFruitMachine() {
  const s = state.serverState;
  const machine = s?.fruitMachine;
  const active = !!machine?.active && s?.phase === "fruitMachine";
  if (!els.fruitMachineModal) return;
  els.fruitMachineModal.hidden = !active;
  if (!active) {
    state.fruitMachineKey = null;
    state.fruitMachineSpinning = false;
    state.fruitMachineAnimateUntil = 0;
    state.fruitMachineSettle = null;
    state.fruitMachineCollecting = false;
    return;
  }

  const yourMachine = machine.playerId === state.playerId;
  const last = (machine.results || [])[machine.results.length - 1] || null;
  const key = `${machine.playerId}|${machine.spinsUsed}|${(last?.wheels || []).join("")}`;
  if (state.fruitMachineKey !== key) {
    const now = nowMs();
    if (state.fruitMachineKey != null && last) {
      state.fruitMachineAnimateUntil = now + 2100;
      state.fruitMachineSettle = {
        key,
        ends: [now + 900, now + 1350, now + 1800],
        doneAt: now + 2050,
      };
    }
    state.fruitMachineKey = key;
    state.fruitMachineSpinning = false;
    if (last?.prizeCount) {
      setTimeout(() => {
        if (state.fruitMachineKey === key) {
          els.fruitMachineCabinet?.classList.add("is-winning");
          setTimeout(() => els.fruitMachineCabinet?.classList.remove("is-winning"), 1300);
        }
      }, 1850);
    }
  }

  if (els.fruitMachineSpins) els.fruitMachineSpins.textContent = `${machine.spinsRemaining || 0} spins`;
  if (els.fruitMachineStatus) {
    els.fruitMachineStatus.textContent = yourMachine
      ? isFruitMachineAnimating()
        ? "Reels spinning..."
        : fruitMachineResultLabel(last)
      : `${machine.color === "w" ? "White" : "Black"} is spinning.`;
  }
  if (els.fruitMachineReels) {
    const wheels = last?.wheels?.length ? last.wheels : ["p", "n", "q"];
    const t = nowMs();
    els.fruitMachineReels.innerHTML = "";
    wheels.forEach((type, index) => {
      const visibleType = fruitMachineVisibleType(index, type, t);
      const settled = !state.fruitMachineSettle || state.fruitMachineSettle.key !== state.fruitMachineKey || t >= state.fruitMachineSettle.ends[index];
      const reel = document.createElement("div");
      reel.className = `fruitReel ${settled && !state.fruitMachineSpinning ? "settled" : "spinning"}`;
      reel.style.setProperty("--delay", `${index * 120}ms`);
      reel.innerHTML = `<span>${escapeHtml(PIECE_GLYPH_MONO[visibleType] || visibleType.toUpperCase())}</span>`;
      els.fruitMachineReels.appendChild(reel);
    });
  }
  if (els.fruitMachinePrize) {
    const prizes = machine.prizes || {};
    const entries = Object.entries(prizes).filter(([, count]) => count > 0);
    els.fruitMachinePrize.innerHTML = entries.length
      ? entries.map(([type, count]) => `<span>${escapeHtml(PIECE_GLYPH_MONO[type] || type.toUpperCase())} x${Number(count)}</span>`).join("")
      : "<span>No prizes banked yet</span>";
  }
  if (els.fruitMachineLever) {
    els.fruitMachineLever.disabled = !yourMachine || isFruitMachineAnimating() || machine.complete || (machine.spinsRemaining || 0) <= 0;
    els.fruitMachineLever.classList.toggle("pulled", state.fruitMachineLeverPull > 0);
    els.fruitMachineLever.style.setProperty("--pull", `${state.fruitMachineLeverPull || 0}px`);
  }
  scheduleFruitMachineRerender();
  if (machine.complete && yourMachine && !isFruitMachineAnimating()) collectFruitMachinePrizes();
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
  const boardN = boardSize();
  const size = els.canvas.width / boardN;
  const t = nowMs();
  const fogVisible =
    s.fogOfWar && s.fogOfWarSquares && state.color ? new Set(s.fogOfWarSquares[state.color] || []) : null;
  const palette = boardPalette(localProfile().boardSkin);

  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

  // Board.
  for (let rank = 0; rank < boardN; rank++) {
    for (let file = 0; file < boardN; file++) {
      const light = (rank + file) % 2 === 0;
      const sq = rank * boardN + file;
      if ((s.missingSquares || []).includes(sq)) continue;
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
  for (let sq = 0; sq < (s.board || []).length; sq++) {
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
      : s.phase === "fruitMachine"
        ? s.fruitMachine?.playerId === state.playerId
          ? "Pull the lever"
          : "Opponent spinning"
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
      ctx.lineWidth = Math.max(3, els.canvas.width / boardSize() * 0.045);
      ctx.beginPath();
      ctx.arc(x, y, els.canvas.width / boardSize() * (0.2 + Math.sin(p * Math.PI) * 0.34), 0, Math.PI * 2);
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
  const tile = els.canvas.width / boardSize();
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
  const size = els.canvas.width / boardSize();
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
  const size = els.canvas.width / boardSize();
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

function pieceSkinStyle(p, colourBlind = false, forceSkinName = null) {
  const skin = cosmeticSlug(forceSkinName || pieceSkinFor(p));
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
  const size = els.canvas.width / boardSize();
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
  const size = els.canvas.width / boardSize();
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
  const size = els.canvas.width / boardSize();
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
  if (hay.includes("fruit machine")) return "\u265B";
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

  window.ChaosChessCardFx.bind(div);
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

function updateChoiceTimer() {
  const s = state.serverState;
  if (!s || els.choiceArea.hidden) return;
  const remainingMs = Math.max(0, (s.ruleChoiceDeadlineMs || 0) - Date.now());
  els.choiceTimer.textContent = `${Math.ceil(remainingMs / 1000)}s`;
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
      btn.innerHTML = `<div class="wagerGlyph">${glyph}</div><div class="wagerMeta">${escapeHtml(item.p.type.toUpperCase())} &middot; ${escapeHtml(sqToAlg(item.sq))}</div>`;
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
  for (let sq = 0; sq < (s.board || []).length; sq++) {
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
    els.rulebookCards.innerHTML = `<div class="modalStatus">Loading...</div>`;
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

function createSingleplayer({ campaignLevel = null, rulePoolIds = null } = {}) {
  if (!ensureSignedIn()) return;
  socket.emit("lobby:singleplayer", { authToken: state.authToken, campaignLevel, rulePoolIds }, (res) => {
    if (!res?.ok) return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "singleplayer failed")}`);
    state.activeCampaignLevel = Number.isFinite(Number(campaignLevel)) ? Math.floor(Number(campaignLevel)) : null;
    enterLobby({ code: res.code, playerId: res.playerId, color: res.color });
    refreshAccount();
    els.code.value = "";
    logLine(`<strong>Lobby</strong>: Started singleplayer game against Chaos Bot.`);
  });
}

async function startCampaignLevel(level) {
  if (!ensureSignedIn()) return;
  try {
    const catalog = await ensureCampaignRuleCatalog();
    const plan = buildCampaignRulePlan(catalog);
    if (!state.campaign) loadCampaignProgress(plan);
    if (level > (state.campaign.highestUnlockedLevel || 1)) return;
    const rulePoolIds = campaignRulePoolForSingleplayer();
    if (els.campaignNotice) els.campaignNotice.textContent = "";
    createSingleplayer({ campaignLevel: level, rulePoolIds });
  } catch (err) {
    logLine(`<strong>Campaign</strong>: ${escapeHtml(err.message || "Failed to start level.")}`);
  }
}

function returnToCampaignMap(reason) {
  if (reason) logLine(`<strong>Campaign</strong>: ${escapeHtml(reason)}`);
  if (!state.lobby || !state.playerId) {
    state.view = "campaign";
    syncUI();
    renderCampaignMap();
    return;
  }
  const code = state.lobby;
  const playerId = state.playerId;
  socket.emit("lobby:leave", { code, playerId }, () => {
    resetToLobby();
    state.view = "campaign";
    syncUI();
    renderCampaignMap();
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
  const avatar = avatarMarkup(profile, player.name || player.id || "player", `${player.name || "Player"} avatar`);
  const emote = currentEmote(player.id);
  const cls = ["boardNameAvatar", borderClass(profile)].filter(Boolean).join(" ");
  return `
    <button class="boardNameButton" type="button" data-player-id="${escapeAttr(player.id || "")}" title="View ${escapeAttr(player.name || "player")} profile">
      <span class="${escapeAttr(cls)}">${avatar}</span>
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
  const showCampaign = !connected && state.view === "campaign";
  updateBodyState();
  els.lobbyPanel.hidden = connected || showCampaign;
  if (els.campaignPanel) els.campaignPanel.hidden = !showCampaign;
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
    if (els.fruitMachineModal) els.fruitMachineModal.hidden = true;
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
  if (s.fruitMachine?.active) {
    els.gameMsg.textContent = s.fruitMachine.playerId === state.playerId ? "Pull the fruit machine lever" : "Opponent is spinning the fruit machine";
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
  renderFruitMachine();
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

function handleCampaignGameResult(s) {
  if (!s?.resultInfo) return;
  if (s.mode !== "singleplayer") return;
  if (s.campaign) {
    state.campaign = Array.isArray(state.campaignRuleCatalog) && state.campaignRuleCatalog.length
      ? normalizeCampaignProgress(s.campaign, buildCampaignRulePlan(state.campaignRuleCatalog))
      : s.campaign;
    saveCampaignProgress();
  }
  const winner = s.resultInfo.winner;
  const loser = s.resultInfo.loser;
  if (!winner || !loser) return;

  const resultKey = `${s.roomCode || ""}:${s.rematchId || 0}:${winner}:${loser}:${s.resultInfo.reason || ""}`;
  if (!Array.isArray(state.campaignRuleCatalog) || !state.campaignRuleCatalog.length) {
    ensureCampaignRuleCatalog()
      .then(() => handleCampaignGameResult(s))
      .catch(() => {});
    return;
  }
  if (state.lastCampaignResultKey === resultKey) return;
  state.lastCampaignResultKey = resultKey;
  const plan = buildCampaignRulePlan(state.campaignRuleCatalog);
  if (!state.campaign) loadCampaignProgress(plan);

  const level = Number.isFinite(Number(s.campaignLevel))
    ? Math.floor(Number(s.campaignLevel))
    : Number.isFinite(Number(state.activeCampaignLevel))
      ? Math.floor(Number(state.activeCampaignLevel))
      : null;
  if (!level || level < 1) return;

  const youWon = winner === state.color;
  const message = youWon ? `Level ${level} cleared. Returning to world map...` : `Level ${level} failed. Returning to world map...`;
  setTimeout(async () => {
    try {
      await refreshAccount();
      loadCampaignProgress(plan);
    } catch {
      // The server is the source of truth; keep the current in-memory campaign if refresh fails.
    }
    returnToCampaignMap(message);
  }, 1400);
}

socket.on("connect", () => {
  state.connected = true;
  setConnectedUI();

  // Auto-resume if we were in a lobby and the socket reconnected (socket.id changes).
  if (state.lobby && state.playerId) {
    socket.emit("lobby:resume", { code: state.lobby, playerId: state.playerId }, (res) => {
      if (!res?.ok) {
        logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "resume failed")}`);
        state.view = "lobby";
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
  handleCampaignGameResult(s);
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
  if (target?.id === "campaignResetProfileBtn") resetCampaignProgress();
  if (target?.id === "addFriendBtn") addFriend();
  if (target?.id === "openRuleAppendixBtn") openRulebook();
  if (target?.id === "deleteAccountBtn") deleteAccount();
  if (target?.id === "adminLoadFlagsBtn") adminLoadFlags();
  if (target?.id === "adminRefreshUsersBtn") adminRefreshUsers();
  if (target?.id === "adminSaveUserBtn") adminSaveUser();
  const rulesTabBtn = target?.closest?.(".profileRulesTabBtn");
  if (rulesTabBtn) {
    state.profileRulesTab = rulesTabBtn.dataset.rulesTab === "singleplayer" ? "singleplayer" : "multiplayer";
    renderProfile();
  }
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
  openCampaignMap();
});
els.campaignBackBtn?.addEventListener("click", () => closeCampaignMap());
els.campaignChestHandle?.addEventListener("pointerdown", (ev) => {
  if (!state.campaignChestModal || state.campaignChestModal.opened || state.campaignChestModal.opening) return;
  state.campaignChestModal.startClientY = ev.clientY;
  state.campaignChestModal.lift = 0;
  els.campaignChestHandle.setPointerCapture?.(ev.pointerId);
});
els.campaignChestHandle?.addEventListener("pointermove", (ev) => {
  if (!state.campaignChestModal || state.campaignChestModal.opened || state.campaignChestModal.opening) return;
  const lift = clamp(state.campaignChestModal.startClientY - ev.clientY, 0, 48);
  state.campaignChestModal.lift = lift;
  els.campaignChestStage?.style.setProperty("--handle-lift", `${-lift}px`);
});
els.campaignChestHandle?.addEventListener("pointerup", () => {
  if (!state.campaignChestModal || state.campaignChestModal.opened || state.campaignChestModal.opening) return;
  if ((state.campaignChestModal.lift || 0) >= 24) revealCampaignChest();
  else els.campaignChestStage?.style.setProperty("--handle-lift", "0px");
});
els.campaignChestHandle?.addEventListener("click", () => {
  if (!state.campaignChestModal || state.campaignChestModal.opened || state.campaignChestModal.opening) return;
  revealCampaignChest();
});
els.campaignChestOkBtn?.addEventListener("click", () => closeCampaignChestModal({ refresh: true }));
els.campaignChestModal?.addEventListener("mousedown", (ev) => {
  if (ev.target === els.campaignChestModal && state.campaignChestModal?.opened) closeCampaignChestModal({ refresh: true });
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

function spinFruitMachine() {
  if (!state.lobby || !state.playerId || state.fruitMachineSpinning) return;
  const machine = state.serverState?.fruitMachine;
  if (isFruitMachineAnimating()) return;
  if (!machine?.active || machine.playerId !== state.playerId || (machine.spinsRemaining || 0) <= 0) return;
  state.fruitMachineSpinning = true;
  state.fruitMachineSettle = null;
  state.fruitMachineLeverPull = 42;
  renderFruitMachine();
  socket.emit("game:fruitMachineSpin", { code: state.lobby, playerId: state.playerId }, (res) => {
    if (!res?.ok) {
      state.fruitMachineSpinning = false;
      logLine(`<strong>Fruit Machine</strong>: ${escapeHtml(res?.error || "spin failed")}`);
    }
    state.fruitMachineLeverPull = 0;
    socket.emit("game:sync", { code: state.lobby, playerId: state.playerId });
  });
}

els.fruitMachineLever?.addEventListener("pointerdown", (ev) => {
  if (els.fruitMachineLever.disabled) return;
  state.fruitMachineLeverStartY = ev.clientY;
  state.fruitMachineLeverPull = 0;
  els.fruitMachineLever.setPointerCapture?.(ev.pointerId);
  renderFruitMachine();
});

els.fruitMachineLever?.addEventListener("pointermove", (ev) => {
  if (state.fruitMachineLeverStartY == null) return;
  state.fruitMachineLeverPull = Math.max(0, Math.min(58, ev.clientY - state.fruitMachineLeverStartY));
  renderFruitMachine();
});

els.fruitMachineLever?.addEventListener("pointerup", () => {
  const pulled = state.fruitMachineLeverPull >= 28;
  state.fruitMachineLeverStartY = null;
  if (pulled) spinFruitMachine();
  else {
    state.fruitMachineLeverPull = 0;
    renderFruitMachine();
  }
});

els.fruitMachineLever?.addEventListener("click", () => {
  if (state.fruitMachineLeverStartY == null) spinFruitMachine();
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

initDraggableModals();
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
