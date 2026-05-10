(function () {
  function createNotificationsUi(deps) {
    const {
      state,
      els,
      authHeaders,
      escapeAttr,
      escapeHtml,
      logLine,
      openProfileModal,
      renderAccountUI,
      renderProfile,
      saveAccountSession,
    } = deps;

    function renderBadge() {
      const count = (state.notifications || state.account?.social?.notifications || []).length;
      if (!els.notificationsBtn) return;
      els.notificationsBtn.hidden = !state.account;
      if (els.notificationsBadge) {
        els.notificationsBadge.hidden = count <= 0;
        els.notificationsBadge.textContent = count > 99 ? "99+" : String(count);
      }
      els.notificationsBtn.classList.toggle("hasNotifications", count > 0);
    }

    async function load() {
      if (!state.authToken) return;
      const json = await requestJson("/api/me/notifications", { method: "GET", cache: "no-store" });
      state.notifications = json.notifications || [];
      if (json.user) state.account = json.user;
      saveAccountSession();
      renderAccountUI();
    }

    function renderList() {
      const list = els.notificationsList;
      if (!list) return;
      const notes = state.notifications || [];
      list.innerHTML = notes.length
        ? notes.map(renderItem).join("")
        : `<div class="emptyServers">No notifications.</div>`;
    }

    function renderItem(note) {
      const actions =
        note.type === "friendRequest"
          ? `<button class="acceptNotificationBtn primaryBtn" data-note-id="${escapeAttr(note.id)}" type="button">Accept</button>
             <button class="dismissNotificationBtn" data-note-id="${escapeAttr(note.id)}" type="button">Dismiss</button>`
          : `<button class="dismissNotificationBtn" data-note-id="${escapeAttr(note.id)}" type="button">Dismiss</button>`;
      return `<div class="notificationItem">
        <div>
          <strong>${escapeHtml(note.fromUsername || "Player")}</strong>
          <span>${escapeHtml(note.message || "Notification")}</span>
        </div>
        <div class="notificationActions">${actions}</div>
      </div>`;
    }

    async function open() {
      if (!state.account) return openProfileModal();
      if (!els.notificationsModal) return;
      els.notificationsModal.hidden = false;
      try {
        await load();
      } catch (err) {
        logLine(`<strong>Notifications</strong>: ${escapeHtml(err.message || "Could not load notifications.")}`);
      }
      renderList();
    }

    function close() {
      if (els.notificationsModal) els.notificationsModal.hidden = true;
    }

    async function accept(id) {
      const json = await requestJson(`/api/me/notifications/${encodeURIComponent(id)}/accept`, { method: "POST" });
      applyNotificationResult(json);
      renderList();
      if (els.profileModal && !els.profileModal.hidden) renderProfile();
    }

    async function dismiss(id) {
      const json = await requestJson(`/api/me/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
      applyNotificationResult(json);
      renderList();
    }

    function applyNotificationResult(json) {
      state.notifications = json.notifications || [];
      if (json.user) state.account = json.user;
      saveAccountSession();
      renderAccountUI();
    }

    async function requestJson(path, options = {}) {
      const init = { method: options.method || "GET", headers: authHeaders() };
      if (options.cache) init.cache = options.cache;
      const res = await fetch(path, init);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Notification action failed.");
      return json;
    }

    return {
      accept,
      close,
      dismiss,
      load,
      open,
      renderBadge,
      renderList,
    };
  }

  window.ChaosChessNotificationsUi = { create: createNotificationsUi };
})();
