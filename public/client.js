/* global io */

const socket = io();

const els = {
  status: document.getElementById("status"),
  name: document.getElementById("nameInput"),
  singleplayerBtn: document.getElementById("singleplayerBtn"),
  createBtn: document.getElementById("createBtn"),
  createModal: document.getElementById("createModal"),
  createCloseBtn: document.getElementById("createCloseBtn"),
  createPublicBtn: document.getElementById("createPublicBtn"),
  createPrivateBtn: document.getElementById("createPrivateBtn"),
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
  canvas: document.getElementById("board"),
  overlayText: document.getElementById("overlayText"),
  sideLabelTop: document.getElementById("sideLabelTop"),
  sideLabelBottom: document.getElementById("sideLabelBottom"),
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
  lawnmowers: [],
  lastEffectsSeen: new Set(),
  lastChoiceKey: null,
  lastStateAt: 0,
  lastSyncAt: 0,
  lastRematchId: null,
  pendingTargetKey: null,
  cachedRulebook: null,
  openServers: [],
};

const confetti = {
  running: false,
  parts: [],
  raf: 0,
};

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

function updateBodyState() {
  document.body.classList.toggle("is-connected", state.connected);
  document.body.classList.toggle("is-in-game", !!state.lobby);
  if (!state.lobby) {
    document.body.classList.remove("is-choosing");
    document.body.classList.remove("is-debug-choice");
  }
}

loadSession();

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
  const rect = els.canvas.getBoundingClientRect();
  const x = ((px - rect.left) / rect.width) * els.canvas.width;
  const y = ((py - rect.top) / rect.height) * els.canvas.height;

  const size = els.canvas.width / 8;
  let file = Math.floor(x / size);
  let rank = 7 - Math.floor(y / size);

  if (state.flipVisual) {
    file = 7 - file;
    rank = 7 - rank;
  }
  return rank * 8 + file;
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

function draw() {
  requestAnimationFrame(draw);
  if (!state.serverState) return;

  const s = state.serverState;
  const size = els.canvas.width / 8;
  const t = nowMs();
  const fogVisible =
    s.fogOfWar && s.fogOfWarSquares && state.color ? new Set(s.fogOfWarSquares[state.color] || []) : null;

  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

  // Board.
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const light = (rank + file) % 2 === 0;
      const sq = rank * 8 + file;
      let { x, y } = squareToCanvasCenter(sq);
      x -= size / 2;
      y -= size / 2;

      let fill = light ? "#dbe2ff" : "#3c4b83";
      if (s.hazards?.lava?.includes(sq)) fill = light ? "#ffb4b4" : "#c24848";
      if (s.hazards?.deadly?.includes(sq)) fill = light ? "#ffd7a8" : "#9a5520";
      if (s.marks?.lightning?.includes(sq)) fill = light ? "#fff1a8" : "#b88d1c";
      if (s.missingSquares?.includes(sq)) fill = "rgba(10,12,18,0.65)";

      ctx.fillStyle = fill;
      ctx.fillRect(x, y, size, size);

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
    const c = squareToCanvasCenter(state.selected);
    ctx.strokeStyle = "rgba(123,211,255,0.9)";
    ctx.lineWidth = 6;
    ctx.strokeRect(c.x - size / 2 + 3, c.y - size / 2 + 3, size - 6, size - 6);
  }
  if (state.legalTo && state.selected != null) {
    for (const to of state.legalTo) {
      if (fogVisible && !fogVisible.has(to)) continue;
      const c = squareToCanvasCenter(to);
      ctx.fillStyle = "rgba(123,211,255,0.25)";
      ctx.beginPath();
      ctx.arc(c.x, c.y, size * 0.14, 0, Math.PI * 2);
      ctx.fill();
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
  const map = {
    p: { w: "\u2659", b: "\u265F" },
    n: { w: "\u2658", b: "\u265E" },
    b: { w: "\u2657", b: "\u265D" },
    r: { w: "\u2656", b: "\u265C" },
    q: { w: "\u2655", b: "\u265B" },
    k: { w: "\u2654", b: "\u265A" },
  };

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

  ctx.font = `${Math.floor(size * 0.62)}px "Segoe UI Symbol", "Noto Sans Symbols2", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (colourBlind) {
    ctx.fillStyle = "rgba(210,215,226,0.92)";
    ctx.strokeStyle = "rgba(10,12,18,0.42)";
  } else {
    ctx.fillStyle = p.color === "w" ? "#fbfbff" : "#101422";
    ctx.strokeStyle = p.color === "w" ? "rgba(10,12,18,0.28)" : "rgba(255,255,255,0.18)";
  }
  ctx.lineWidth = 4;
  const glyph = (colourBlind ? map[p.type]?.w : map[p.type]?.[p.color]) || "?";
  ctx.strokeText(glyph, x, y + 2);
  ctx.fillText(glyph, x, y);

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
  if (sq != null && state.serverState?.backupVitalSquare === sq) {
    ctx.font = `${Math.floor(size * 0.2)}px "Segoe UI Symbol", "Noto Color Emoji", sans-serif`;
    ctx.fillStyle = "#ff4f8b";
    ctx.strokeStyle = "rgba(0,0,0,0.42)";
    ctx.lineWidth = 2;
    ctx.strokeText("\u2665", x - size * 0.26, y - size * 0.27);
    ctx.fillText("\u2665", x - size * 0.26, y - size * 0.27);
  }
}

function drawTitanPiece(sq, p) {
  const size = els.canvas.width / 8;
  const file = sq % 8;
  const rank = Math.floor(sq / 8);
  const anchor = squareToCanvasCenter(sq);
  const right = file < 7 ? squareToCanvasCenter(sq + 1) : anchor;
  const up = rank < 7 ? squareToCanvasCenter(sq + 8) : anchor;
  const centerX = (anchor.x + right.x) / 2;
  const centerY = (anchor.y + up.y) / 2;

  ctx.save();
  ctx.fillStyle = "rgba(255, 209, 102, 0.22)";
  ctx.strokeStyle = "rgba(255, 209, 102, 0.72)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(centerX - size, centerY - size, size * 2, size * 2, size * 0.12);
  ctx.fill();
  ctx.stroke();

  const map = {
    p: { w: "\u2659", b: "\u265F" },
    n: { w: "\u2658", b: "\u265E" },
    b: { w: "\u2657", b: "\u265D" },
    r: { w: "\u2656", b: "\u265C" },
    q: { w: "\u2655", b: "\u265B" },
    k: { w: "\u2654", b: "\u265A" },
  };
  ctx.font = `${Math.floor(size * 1.05)}px "Segoe UI Symbol", "Noto Sans Symbols2", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = p.color === "w" ? "#fffdf7" : "#101422";
  ctx.strokeStyle = p.color === "w" ? "rgba(10,12,18,0.42)" : "rgba(255,255,255,0.28)";
  ctx.lineWidth = 7;
  const glyph = map[p.type]?.[p.color] || "?";
  ctx.strokeText(glyph, centerX, centerY + 4);
  ctx.fillText(glyph, centerX, centerY);
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
  if (hay.includes("lawnmower")) return "\u25AC";
  if (hay.includes("backup")) return "\u2665";
  if (hay.includes("sticky")) return "\u25CD";
  if (hay.includes("haunted")) return "\u25D6";
  if (hay.includes("friendly fire")) return "\u26A0";
  if (hay.includes("bumper")) return "\u21A9";
  if (hay.includes("ice") || hay.includes("slippery")) return "\u2744";
  if (hay.includes("gravity")) return "\u2193";
  if (hay.includes("fog") || hay.includes("invisible")) return "\u25D0";
  if (hay.includes("lightning") || hay.includes("orbital")) return "\u26A1";
  if (hay.includes("asteroid")) return "\u25C6";
  if (hay.includes("suicide bomber")) return "\u{1F4A3}";
  if (hay.includes("explod") || hay.includes("bomb") || hay.includes("purge")) return "\u{1F4A5}";
  if (hay.includes("titan")) return "\u{1F4AA}";
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
  div.className = `card ${pickable ? "pickable" : ""} ${r.kind}`.trim().replace(/\s+/g, " ");

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
  if (!els.createModal) return;
  els.createModal.hidden = false;
}

function closeCreateModal() {
  if (!els.createModal) return;
  els.createModal.hidden = true;
}

function createLobby(visibility) {
  socket.emit("lobby:create", { name: els.name.value.trim(), visibility }, (res) => {
    if (!res?.ok) return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "create failed")}`);
    closeCreateModal();
    enterLobby({ code: res.code, playerId: res.playerId, color: res.color });
    els.code.value = "";
    const visibilityText = visibility === "public" ? "public" : "private";
    logLine(`<strong>Lobby</strong>: Created ${visibilityText} lobby <strong>${res.code}</strong>`);
  });
}

function createSingleplayer() {
  socket.emit("lobby:singleplayer", { name: els.name.value.trim() }, (res) => {
    if (!res?.ok) return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "singleplayer failed")}`);
    enterLobby({ code: res.code, playerId: res.playerId, color: res.color });
    els.code.value = "";
    logLine(`<strong>Lobby</strong>: Started singleplayer game against Chaos Bot.`);
  });
}

function openJoinModal() {
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
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return logLine(`<strong>Error</strong>: Enter a lobby code.`);
  socket.emit("lobby:join", { code: normalized, name: els.name.value.trim() }, (res) => {
    if (!res?.ok) {
      requestOpenServers();
      return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "join failed")}`);
    }
    closeJoinModal();
    enterLobby({ code: res.code, playerId: res.playerId, color: res.color });
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
    els.choiceArea.hidden = true;
    document.body.classList.remove("is-choosing");
    document.body.classList.remove("is-debug-choice");
    els.choiceCards.classList.remove("debugChoice");
    if (els.resultModal) els.resultModal.hidden = true;
    stopConfetti();
    if (els.sideLabelTop) els.sideLabelTop.textContent = "";
    if (els.sideLabelBottom) els.sideLabelBottom.textContent = "";
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

  state.flipVisual = (state.color === "b") !== !!s.visualFlip;

  const whiteName = (players.find((p) => p.color === "w")?.name || "White").trim();
  const blackName = (players.find((p) => p.color === "b")?.name || "Black").trim();
  const topIsWhite = !!state.flipVisual;
  if (els.sideLabelTop) els.sideLabelTop.textContent = topIsWhite ? whiteName : blackName;
  if (els.sideLabelBottom) els.sideLabelBottom.textContent = topIsWhite ? blackName : whiteName;

  renderCards();
  renderChoice();
  renderRps();
  renderWager();

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
    if (e.type === "lawnmower") {
      queueLawnmower(e);
      spawnParticles(e.squares || [], "rgba(156,255,107,0.78)");
    }
    if (e.type === "rule") {
      playSound("rule");
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

socket.on("game:state", (s) => {
  // The server can send pushes for rooms this socket is still subscribed to.
  // Only accept state for the currently active lobby.
  if (state.lobby && s?.roomCode && s.roomCode !== state.lobby) return;
  if (state.lastRematchId != null && s.rematchId != null && s.rematchId !== state.lastRematchId) {
    state.lastEffectsSeen = new Set();
    state.lastChoiceKey = null;
    stopConfetti();
  }
  state.lastRematchId = s.rematchId ?? state.lastRematchId;
  state.serverState = s;
  state.lastStateAt = Date.now();
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

els.rpsRockBtn?.addEventListener("click", () => sendRpsChoice("rock"));
els.rpsPaperBtn?.addEventListener("click", () => sendRpsChoice("paper"));
els.rpsScissorsBtn?.addEventListener("click", () => sendRpsChoice("scissors"));

els.wagerConfirmBtn?.addEventListener("click", () => {
  if (!state.lobby || !state.playerId) return;
  socket.emit("game:wagerConfirm", { code: state.lobby, playerId: state.playerId }, (res) => {
    if (!res?.ok) logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "wager confirm failed")}`);
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
  if (s.phase !== "play") return;
  if (s.turn !== state.color) return;
  if (s.result) return;

  const sq = canvasToSquare(ev.clientX, ev.clientY);
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
  if (!state.serverState) return;
  updateChoiceTimer();
  updateRpsTimer();
  updateWagerTimer();
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
