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
};

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
  saveSession();
  syncUI();
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
      const c = squareToCanvasCenter(to);
      ctx.fillStyle = "rgba(123,211,255,0.25)";
      ctx.beginPath();
      ctx.arc(c.x, c.y, size * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Pieces.
  for (let sq = 0; sq < 64; sq++) {
    const p = s.board[sq];
    if (!p) continue;
    if (s.invisiblePieces && !(s.visibleSquares || []).includes(sq) && p.type !== "k") continue;
    if (p.color === "x") {
      drawBlock(sq);
      continue;
    }
    drawPiece(sq, p);
  }

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
      : s.result
        ? s.result
        : yourTurn
          ? "Your move"
          : "Waiting…";
  setOverlay(msg);
}

function drawPiece(sq, p) {
  const { x, y } = squareToCanvasCenter(sq);
  const size = els.canvas.width / 8;
  const map = {
    p: { w: "♙", b: "♟" },
    n: { w: "♘", b: "♞" },
    b: { w: "♗", b: "♝" },
    r: { w: "♖", b: "♜" },
    q: { w: "♕", b: "♛" },
    k: { w: "♔", b: "♚" },
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
  ctx.fillStyle = p.color === "w" ? "#fbfbff" : "#101422";
  ctx.strokeStyle = p.color === "w" ? "rgba(10,12,18,0.28)" : "rgba(255,255,255,0.18)";
  ctx.lineWidth = 4;
  const glyph = map[p.type]?.[p.color] || "?";
  ctx.strokeText(glyph, x, y + 2);
  ctx.fillText(glyph, x, y);

  // Rule icon (tiny dot).
  if (p.tags?.includes("tempQueen")) {
    ctx.fillStyle = "rgba(255,229,143,0.9)";
    ctx.beginPath();
    ctx.arc(x + size * 0.28, y - size * 0.28, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
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
  if (kind === "instant") return "⚡";
  if (kind === "delayed") return "⏳";
  if (kind === "permanent") return "∞";
  return "⏱";
}

function ruleArtIcon(ruleId, ruleName) {
  const id = String(ruleId || "").toLowerCase();
  const name = String(ruleName || "").toLowerCase();

  const hay = `${id} ${name}`;

  if (hay.includes("explod") || hay.includes("bomb") || hay.includes("purge")) return "💥";
  if (hay.includes("lava")) return "🌋";
  if (hay.includes("deadly") || hay.includes("death")) return "☠";
  if (hay.includes("shield")) return "🛡";
  if (hay.includes("swap") || hay.includes("mirror")) return "⇄";
  if (hay.includes("teleport")) return "🌀";
  if (hay.includes("shuffle") || hay.includes("random") || hay.includes("rps") || hay.includes("dice")) return "🎲";
  if (hay.includes("flip") || hay.includes("rotate") || hay.includes("turn")) return "🔄";
  if (hay.includes("spawn") || hay.includes("block") || hay.includes("wall")) return "🧱";
  if (hay.includes("extra move") || hay.includes("double")) return "⏩";

  if (hay.includes("queen")) return "♛";
  if (hay.includes("king")) return "♚";
  if (hay.includes("rook")) return "♜";
  if (hay.includes("bishop")) return "♝";
  if (hay.includes("knight")) return "♞";
  if (hay.includes("pawn")) return "♟";

  if (hay.includes("center")) return "⦿";
  if (hay.includes("column") || hay.includes("file")) return "▮";
  if (hay.includes("edge") || hay.includes("perimeter")) return "⬚";

  return "✦";
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

function renderChoice() {
  const s = state.serverState;
  const choice = (s.ruleChoicesByPlayerId || {})[state.playerId];
  const needsChoice = s.phase === "ruleChoice" && !!choice && !s.ruleChosenByPlayerId?.[state.playerId];

  els.choiceArea.hidden = !needsChoice;
  if (!needsChoice) {
    els.choiceCards.innerHTML = "";
    state.lastChoiceKey = null;
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
  els.lobbyPanel.hidden = connected;
  els.gamePanel.hidden = !connected;
  if (!connected) return;

  els.lobbyCode.textContent = state.lobby;
  els.youInfo.textContent = `${state.color === "w" ? "White" : "Black"} (${state.playerId})`;
  els.turnInfo.textContent = s.turn === "w" ? "White" : "Black";
  els.plyInfo.textContent = String(s.ply || 0);
  const players = s.players || [];
  const opp = players.find((p) => p.id !== state.playerId);
  const oppText = opp ? `${opp.name} (${opp.color === "w" ? "White" : "Black"})` : "Waiting for opponent…";
  els.gameMsg.textContent = s.check ? `${s.check} in check · ${oppText}` : oppText;

  state.flipVisual = (state.color === "b") !== !!s.visualFlip;
  renderCards();
  renderChoice();
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
        saveSession();
        syncUI();
        return;
      }
      // Server will push a fresh game:state after resume.
      logLine(`<strong>Lobby</strong>: Reconnected to <strong>${escapeHtml(state.lobby)}</strong>`);
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
  state.serverState = s;
  state.lastStateAt = Date.now();
  handleEffects();
  syncUI();
});

els.createBtn.addEventListener("click", () => {
  socket.emit("lobby:create", { name: els.name.value.trim() }, (res) => {
    if (!res?.ok) return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "create failed")}`);
    state.lobby = res.code;
    state.playerId = res.playerId;
    state.color = res.color;
    saveSession();
    els.code.value = "";
    logLine(`<strong>Lobby</strong>: Created <strong>${res.code}</strong>`);
  });
});

els.joinBtn.addEventListener("click", () => {
  const code = els.code.value.trim().toUpperCase();
  socket.emit("lobby:join", { code, name: els.name.value.trim() }, (res) => {
    if (!res?.ok) return logLine(`<strong>Error</strong>: ${escapeHtml(res?.error || "join failed")}`);
    state.lobby = res.code;
    state.playerId = res.playerId;
    state.color = res.color;
    saveSession();
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

els.canvas.addEventListener("mousedown", (ev) => {
  if (!state.serverState || !state.lobby) return;
  const s = state.serverState;
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
