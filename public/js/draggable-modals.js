(function () {
  const draggableModalState = new WeakMap();
  let draggableModalRaf = 0;
  
  function getModalState(card) {
    let s = draggableModalState.get(card);
    if (s) return s;
    s = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      dragging: false,
      pointerId: null,
      lastPx: 0,
      lastPy: 0,
      lastTs: 0,
    };
    draggableModalState.set(card, s);
    return s;
  }
  
  function applyModalTransform(card, s) {
    card.style.transform = `translate3d(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px, 0) rotate(${s.angle.toFixed(2)}deg)`;
  }
  
  function modalBounds(card, s) {
    const rect = card.getBoundingClientRect();
    const baseLeft = rect.left - s.x;
    const baseTop = rect.top - s.y;
    return {
      minX: -baseLeft,
      maxX: window.innerWidth - rect.width - baseLeft,
      minY: -baseTop,
      maxY: window.innerHeight - rect.height - baseTop,
    };
  }
  
  function keepModalInBounds(card) {
    const s = getModalState(card);
    const b = modalBounds(card, s);
    s.x = Math.max(b.minX, Math.min(b.maxX, s.x));
    s.y = Math.max(b.minY, Math.min(b.maxY, s.y));
    applyModalTransform(card, s);
  }
  
  function tickDraggableModals(ts) {
    draggableModalRaf = 0;
    let stillMoving = false;
    document.querySelectorAll(".modal:not([hidden]) .modalCard").forEach((card) => {
      const s = getModalState(card);
      if (s.dragging) return;
      if (Math.abs(s.vx) < 0.012 && Math.abs(s.vy) < 0.012 && Math.abs(s.angle) < 0.05) {
        s.vx = 0;
        s.vy = 0;
        s.angle *= 0.88;
        applyModalTransform(card, s);
        return;
      }
  
      const dtMs = Math.min(32, Math.max(8, ts - (s.lastTs || ts)));
      const dt = dtMs / 16.6667;
      const dtPx = dtMs;
      s.lastTs = ts;
      s.x += s.vx * dtPx;
      s.y += s.vy * dtPx;
      s.angle += (s.vx * 3.6 - s.angle) * 0.08;
  
      const b = modalBounds(card, s);
      if (s.x < b.minX) {
        s.x = b.minX;
        s.vx = Math.abs(s.vx) * 0.82;
      } else if (s.x > b.maxX) {
        s.x = b.maxX;
        s.vx = -Math.abs(s.vx) * 0.82;
      }
      if (s.y < b.minY) {
        s.y = b.minY;
        s.vy = Math.abs(s.vy) * 0.82;
      } else if (s.y > b.maxY) {
        s.y = b.maxY;
        s.vy = -Math.abs(s.vy) * 0.82;
      }
  
      s.vx *= 0.972;
      s.vy *= 0.972;
      s.angle *= 0.95;
      applyModalTransform(card, s);
      stillMoving = true;
    });
  
    if (stillMoving) draggableModalRaf = requestAnimationFrame(tickDraggableModals);
  }
  
  function ensureDraggableTick() {
    if (draggableModalRaf) return;
    draggableModalRaf = requestAnimationFrame(tickDraggableModals);
  }
  
  function bindDraggableModalCard(card) {
    if (!card || card.dataset.draggableModal === "1") return;
    card.dataset.draggableModal = "1";
    const dragHandle = card.querySelector(".cardsHeader, .modalTitle") || card;
    const s = getModalState(card);
  
    dragHandle.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target?.closest("button, input, textarea, select, a, label")) return;
      s.dragging = true;
      s.pointerId = ev.pointerId;
      s.lastPx = ev.clientX;
      s.lastPy = ev.clientY;
      s.lastTs = nowMs();
      s.vx = 0;
      s.vy = 0;
      card.classList.add("is-dragging");
      dragHandle.setPointerCapture?.(ev.pointerId);
      ev.preventDefault();
    });
  
    dragHandle.addEventListener("pointermove", (ev) => {
      if (!s.dragging || s.pointerId !== ev.pointerId) return;
      const now = nowMs();
      const dx = ev.clientX - s.lastPx;
      const dy = ev.clientY - s.lastPy;
      const dt = Math.max(8, now - s.lastTs);
      s.lastPx = ev.clientX;
      s.lastPy = ev.clientY;
      s.lastTs = now;
      s.x += dx;
      s.y += dy;
      const instVx = dx / dt;
      const instVy = dy / dt;
      s.vx = s.vx * 0.56 + instVx * 0.44;
      s.vy = s.vy * 0.56 + instVy * 0.44;
      s.angle = Math.max(-2.2, Math.min(2.2, s.vx * 8));
      keepModalInBounds(card);
      ev.preventDefault();
    });
  
    const release = (ev) => {
      if (!s.dragging || (ev && s.pointerId !== ev.pointerId)) return;
      s.dragging = false;
      s.pointerId = null;
      card.classList.remove("is-dragging");
      ensureDraggableTick();
    };
    dragHandle.addEventListener("pointerup", release);
    dragHandle.addEventListener("pointercancel", release);
    dragHandle.addEventListener("lostpointercapture", release);
  }
  
  function initDraggableModals() {
    document.querySelectorAll(".modal .modalCard").forEach(bindDraggableModalCard);
    window.addEventListener("resize", () => {
      document.querySelectorAll(".modal .modalCard").forEach((card) => keepModalInBounds(card));
    }, { passive: true });
  }

  window.ChaosChessDraggableModals = {
    init: initDraggableModals,
  };
})();
