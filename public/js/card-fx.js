(function () {
  function bind(card) {
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
      next = {
        rx: -(py - 0.5) * maxTilt * 2,
        ry: (px - 0.5) * maxTilt * 2,
        mx: `${Math.round(px * 100)}%`,
        my: `${Math.round(py * 100)}%`,
      };
      schedule();
    };

    card.addEventListener("pointerenter", () => {
      card.classList.add("is-tilting");
    });
    card.addEventListener("pointermove", (ev) => {
      if (ev.pointerType !== "touch") updateFromPointer(ev);
    });
    card.addEventListener("pointerleave", () => {
      card.classList.remove("is-tilting");
      next = { rx: 0, ry: 0, mx: "50%", my: "50%" };
      schedule();
    });
  }

  window.ChaosChessCardFx = { bind };
})();
