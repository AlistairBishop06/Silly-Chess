(function () {
  function createClubUi(deps) {
    const {
      state,
      authHeaders,
      avatarMarkup,
      escapeAttr,
      escapeHtml,
      n,
      renderProfile,
      saveAccountSession,
      statTile,
    } = deps;

    function roleLabel(role) {
      if (role === "owner") return "Owner";
      if (role === "admin") return "Admin";
      if (role === "member") return "Member";
      return "Visitor";
    }

    function renderTab(user, readOnly = false) {
      if (readOnly) return renderReadonlyTab(user);
      if (state.activeClub) return renderDashboard(state.activeClub);

      const clubs = state.clubs || [];
      const myClubIds = new Set((state.account?.social?.clubs || []).map((club) => club.id));
      return `<section class="profileSection wide">
        <div class="clubsHeader">
          <div>
            <h3>Clubs</h3>
            <span>Create a club for 2000 coins, review requests, and challenge clubmates.</span>
          </div>
          <button id="refreshClubsBtn" type="button">Refresh</button>
        </div>
        <div class="createClubBox">
          <input id="clubNameInput" placeholder="Club name" maxlength="32" autocomplete="off" />
          <input id="clubDescriptionInput" placeholder="Description" maxlength="180" autocomplete="off" />
          <button id="createClubBtn" class="primaryBtn" type="button">Create club &middot; 2000 coins</button>
        </div>
        <div id="clubStatus" class="modalStatus">${escapeHtml(state.clubStatus || "")}</div>
        <div class="clubGrid">
          ${
            clubs.length
              ? clubs.map((club) => renderClubCard(club, myClubIds)).join("")
              : `<div class="emptyServers">No clubs yet. Be expensive and start one.</div>`
          }
        </div>
      </section>`;
    }

    function renderReadonlyTab(user) {
      const clubs = user.social?.clubs || [];
      return `<section class="profileSection wide">
        <h3>Clubs</h3>
        <div class="clubGrid">
          ${
            clubs.length
              ? clubs.map((club) => `<div class="clubCard"><strong>${escapeHtml(club.name)}</strong><span>${escapeHtml(roleLabel(club.role))} &middot; ${n(club.memberCount)} members</span></div>`).join("")
              : `<div class="emptyServers">This player is not in any clubs.</div>`
          }
        </div>
      </section>`;
    }

    function renderClubCard(club, myClubIds) {
      const mine = myClubIds.has(club.id) || club.isMember;
      const action = mine
        ? `<button class="openClubBtn primaryBtn" data-club-id="${escapeAttr(club.id)}" type="button">Open</button>`
        : `<button class="requestClubBtn" data-club-id="${escapeAttr(club.id)}" type="button" ${club.hasRequested ? "disabled" : ""}>${club.hasRequested ? "Requested" : "Request join"}</button>`;
      return `<div class="clubCard">
        <strong>${escapeHtml(club.name)}</strong>
        <span>${escapeHtml(club.description || "No description yet.")}</span>
        <div class="clubMeta">${escapeHtml(club.ownerUsername || "Unknown")} &middot; ${n(club.memberCount)} members</div>
        ${action}
      </div>`;
    }

    function renderDashboard(club) {
      const canManage = !!club.canManage;
      const members = club.members || [];
      return `<section class="profileSection wide clubDashboard">
        <div class="clubsHeader">
          <div>
            <h3>${escapeHtml(club.name)}</h3>
            <span>${escapeHtml(club.description || "No description yet.")}</span>
          </div>
          <button id="backToClubsBtn" type="button">Back</button>
        </div>
        <div class="profileStats">
          ${statTile("members", n(club.stats?.totalMembers || members.length))}
          ${statTile("member games", n(club.stats?.totalGamesPlayed || 0))}
          ${statTile("your role", roleLabel(club.role))}
        </div>
        ${canManage ? renderAnnouncementForm(club) : ""}
        ${canManage ? renderRequests(club) : ""}
        ${renderMembers(club, members, canManage)}
        ${renderFeedPanel("Announcements", club.announcements || [], (a) => `<strong>${escapeHtml(a.author || "Club")}</strong><span>${escapeHtml(a.text)}</span>`)}
        ${renderFeedPanel("Activity", club.activity || [], (a) => `<span>${escapeHtml(a.text)}</span>`)}
        <div class="modalActions">
          ${club.role === "owner" ? `<button id="deleteClubBtn" data-club-id="${escapeAttr(club.id)}" type="button">Delete club</button>` : `<button id="leaveClubBtn" data-club-id="${escapeAttr(club.id)}" type="button">Leave club</button>`}
        </div>
      </section>`;
    }

    function renderAnnouncementForm(club) {
      return `<div class="createClubBox">
        <input id="clubAnnouncementInput" placeholder="Announcement" maxlength="180" autocomplete="off" />
        <button id="postClubAnnouncementBtn" class="primaryBtn" data-club-id="${escapeAttr(club.id)}" type="button">Post</button>
      </div>`;
    }

    function renderRequests(club) {
      return `<div class="clubPanel">
        <h3>Join Requests</h3>
        <div class="clubRequestList">
          ${
            (club.joinRequests || []).length
              ? club.joinRequests.map((r) => `<div><span>${escapeHtml(r.username)}</span><span><button class="acceptClubRequestBtn primaryBtn" data-club-id="${escapeAttr(club.id)}" data-user-id="${escapeAttr(r.userId)}" type="button">Accept</button><button class="denyClubRequestBtn" data-club-id="${escapeAttr(club.id)}" data-user-id="${escapeAttr(r.userId)}" type="button">Deny</button></span></div>`).join("")
              : `<div class="emptyServers">No pending requests.</div>`
          }
        </div>
      </div>`;
    }

    function renderMembers(club, members, canManage) {
      return `<div class="clubPanel">
        <h3>Members</h3>
        <div class="friendList">
          ${members.map((member) => renderMember(club, member, canManage)).join("")}
        </div>
      </div>`;
    }

    function renderMember(club, member, canManage) {
      const avatar = member.profile ? avatarMarkup(member.profile, member.username, `${member.username} avatar`) : escapeHtml(String(member.username || "?").slice(0, 2).toUpperCase());
      const manageable = canManage && member.role !== "owner" && member.userId !== state.account?.id;
      return `<div class="friendItem">
        <button class="friendProfileBtn" data-username="${escapeAttr(member.username)}" type="button">
          <span class="miniAvatar">${avatar}</span>
          <span class="friendName">${escapeHtml(member.username)} &middot; ${escapeHtml(roleLabel(member.role))}</span>
        </button>
        <div class="friendActions">
          ${member.userId !== state.account?.id ? `<button class="challengeUserBtn primaryBtn" data-username="${escapeAttr(member.username)}" type="button">Challenge</button>` : ""}
          ${manageable && member.role === "member" ? `<button class="promoteClubMemberBtn" data-club-id="${escapeAttr(club.id)}" data-user-id="${escapeAttr(member.userId)}" type="button">Promote</button>` : ""}
          ${manageable && member.role === "admin" ? `<button class="demoteClubMemberBtn" data-club-id="${escapeAttr(club.id)}" data-user-id="${escapeAttr(member.userId)}" type="button">Demote</button>` : ""}
          ${manageable ? `<button class="removeClubMemberBtn" data-club-id="${escapeAttr(club.id)}" data-user-id="${escapeAttr(member.userId)}" type="button">Remove</button>` : ""}
        </div>
      </div>`;
    }

    function renderFeedPanel(title, items, renderItem) {
      return `<div class="clubPanel">
        <h3>${escapeHtml(title)}</h3>
        <div class="clubFeed">${items.map((item) => `<div>${renderItem(item)}</div>`).join("") || `<div class="emptyServers">No ${title.toLowerCase()}.</div>`}</div>
      </div>`;
    }

    async function load() {
      const res = await fetch("/api/clubs", { headers: authHeaders(), cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Could not load clubs.");
      state.clubs = json.clubs || [];
      state.clubStatus = "";
    }

    async function createClub() {
      const name = document.getElementById("clubNameInput")?.value || "";
      const description = document.getElementById("clubDescriptionInput")?.value || "";
      try {
        const json = await requestJson("/api/clubs", { method: "POST", body: { name, description } });
        state.account = json.user || state.account;
        state.activeClub = json.club || null;
        await load();
        saveAccountSession();
        renderProfile();
      } catch (err) {
        state.clubStatus = err.message || "Could not create club.";
        renderProfile();
      }
    }

    async function open(clubId) {
      const json = await requestJson(`/api/clubs/${encodeURIComponent(clubId)}`, { method: "GET", cache: "no-store" });
      state.activeClub = json.club;
      renderProfile();
    }

    async function requestJoin(clubId) {
      await requestJson(`/api/clubs/${encodeURIComponent(clubId)}/request`, { method: "POST" });
      state.clubStatus = "Join request sent.";
      await load();
      renderProfile();
    }

    async function action(path, options = {}) {
      const json = await requestJson(path, options);
      if (json.user) {
        state.account = json.user;
        saveAccountSession();
      }
      state.activeClub = json.club || null;
      await load().catch(() => {});
      renderProfile();
    }

    async function requestJson(path, options = {}) {
      const init = { method: options.method || "POST", headers: { ...authHeaders() } };
      if (options.cache) init.cache = options.cache;
      if (options.body) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(options.body);
      }
      const res = await fetch(path, init);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Club action failed.");
      return json;
    }

    function bindProfileTabLoad() {
      state.activeClub = null;
      return load()
        .then(() => renderProfile())
        .catch((err) => {
          state.clubStatus = err.message || "Could not load clubs.";
          renderProfile();
        });
    }

    return {
      action,
      bindProfileTabLoad,
      createClub,
      load,
      open,
      renderTab,
      requestJoin,
    };
  }

  window.ChaosChessClubsUi = { create: createClubUi };
})();
