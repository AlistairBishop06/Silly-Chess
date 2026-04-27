/* global io */

const socket = io();

const els = {
  status: document.getElementById("status"),
  name: document.getElementById("nameInput"),
  createBtn: document.getElementById("createBtn"),
  code: document.getElementById("codeInput"),
  joinBtn: document.getElementById("joinBtn"),
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
  activeCards: document.getElementById("activeCards"),
  choiceArea: document.getElementById("choiceArea"),
  choiceCards: document.getElementById("choiceCards"),
  choiceTimer: document.getElementById("choiceTimer"),
  rpsModal: document.getElementById("rpsModal"),
  rpsTimer: document.getElementById("rpsTimer"),
  rpsStatus: document.getElementById("rpsStatus"),
  rpsRockBtn: document.getElementById("rpsRockBtn"),
  rpsPaperBtn: document.getElementById("rpsPaperBtn"),
  rpsScissorsBtn: document.getElementById("rpsScissorsBtn"),
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
  lastEffectsSeen: new Set(),
  lastChoiceKey: null,
  lastStateAt: 0,
  lastSyncAt: 0,
  lastRematchId: null,
  pendingTargetKey: null,
};

const confetti = {
  running: false,
  parts: [],
  raf: 0,
};

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

function draw() {
  requestAnimationFrame(draw);
  if (!state.serverState) return;

  const s = state.serverState;
  const size = els.canvas.width / 8;
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

  // Fans.
  for (const fan of s.fans || []) {
    const rank = fan.rank;
    if (rank == null) continue;
    const y = squareToCanvasCenter(toIdxSafe(0, rank)).y;
    const fromX = fan.side === "right" ? els.canvas.width - size * 0.32 : size * 0.32;
    const toX = fan.side === "right" ? size * 0.32 : els.canvas.width - size * 0.32;
    ctx.strokeStyle = "rgba(36,214,200,0.52)";
    ctx.lineWidth = 5;
    ctx.setLineDash([16, 12]);
    ctx.beginPath();
    ctx.moveTo(fromX, y);
    ctx.lineTo(toX, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Pieces.
  const titans = [];
  for (let sq = 0; sq < 64; sq++) {
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

  // Particles.
  const t = nowMs();
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
      : s.phase === "targetRule"
        ? s.pendingTargetRule?.playerId === state.playerId
          ? (s.pendingTargetRule.prompt || "Choose a target")
          : "Opponent choosing a rule target"
      : s.phase === "rps"
        ? "RPS Duel!"
      : s.result
        ? s.result
        : yourTurn
          ? "Your move"
          : "Waiting...";
  setOverlay(msg);
}

function drawPiece(sq, p) {
  const { x, y } = squareToCanvasCenter(sq);
  const size = els.canvas.width / 8;
  const colourBlind = !!(state.serverState && state.serverState.colourBlind);
  const map = {
    p: { w: "\u2659", b: "\u265F" },
    n: { w: "\u2658", b: "\u265E" },
    b: { w: "\u2657", b: "\u265D" },
    r: { w: "\u2656", b: "\u265C" },
    q: { w: "\u2655", b: "\u265B" },
    k: { w: "\u2654", b: "\u265A" },
  };

  // Subtle glow for last move.
  if ((state.serverState.lastMoveSquares || []).includes(sq)) {
    ctx.fillStyle = "rgba(125,255,179,0.18)";
    ctx.beginPath();
    ctx.arc(x, y, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
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

function renderChoice() {
  const s = state.serverState;
  const choice = (s.ruleChoicesByPlayerId || {})[state.playerId];
  const needsChoice = s.phase === "ruleChoice" && !!choice && !s.ruleChosenByPlayerId?.[state.playerId];

  els.choiceArea.hidden = !needsChoice;
  document.body.classList.toggle("is-choosing", needsChoice);
  document.body.classList.toggle("is-debug-choice", needsChoice && choice.length > 3);
  els.choiceCards.classList.toggle("debugChoice", needsChoice && choice.length > 3);
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
  renderCards();
  renderChoice();
  renderRps();

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

els.createBtn.addEventListener("click", () => {
  socket.emit("lobby:create", { name: els.name.value.trim() }, (res) => {
    if (!res?.ok) return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "create failed")}`);
    enterLobby({ code: res.code, playerId: res.playerId, color: res.color });
    els.code.value = "";
    logLine(`<strong>Lobby</strong>: Created <strong>${res.code}</strong>`);
  });
});

els.joinBtn.addEventListener("click", () => {
  const code = els.code.value.trim().toUpperCase();
  socket.emit("lobby:join", { code, name: els.name.value.trim() }, (res) => {
    if (!res?.ok) return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "join failed")}`);
    enterLobby({ code: res.code, playerId: res.playerId, color: res.color });
    logLine(`<strong>Lobby</strong>: Joined <strong>${res.code}</strong>`);
  });
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
