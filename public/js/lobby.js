// Menu-view switching and lobby rendering. Owns only lobby/menu DOM;
// backdrop open/close stays with Game's openOverlay/closeOverlay so there
// is exactly one overlay implementation in the app.
export class Lobby {
  constructor() {
    this.views = new Map();
    for (const el of document.querySelectorAll(".menu-view")) {
      this.views.set(el.id, el);
    }
    this.codeEl = document.getElementById("lobbyCode");
    this.modeEl = document.getElementById("lobbyMode");
    this.playersEl = document.getElementById("lobbyPlayers");
    this.statusEl = document.getElementById("lobbyStatus");
    this.startBtn = document.getElementById("lobbyStart");
  }

  showMenuView(name) {
    for (const [id, el] of this.views) {
      el.classList.toggle("active", id === name);
    }
    const view = this.views.get(name);
    if (view) {
      const first = view.querySelector("input, button");
      if (first) first.focus();
    }
  }

  // Renders the canonical roomState. Nicknames are user-controlled and
  // rendered with textContent only — never innerHTML.
  render(roomState, myId) {
    this.codeEl.textContent = roomState.code;
    this.modeEl.textContent =
      roomState.mode === "sudden" ? "Sudden Death" : "Classic";

    this.playersEl.replaceChildren();
    for (const p of roomState.players) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = p.nickname;
      li.appendChild(name);
      if (p.isHost) {
        const b = document.createElement("span");
        b.className = "badge host";
        b.textContent = "host";
        li.appendChild(b);
      }
      if (p.id === myId) {
        const b = document.createElement("span");
        b.className = "badge you";
        b.textContent = "you";
        li.appendChild(b);
      }
      this.playersEl.appendChild(li);
    }

    const isHost = roomState.players.some((p) => p.id === myId && p.isHost);
    this.startBtn.style.display = isHost ? "" : "none";
    const count = `${roomState.players.length}/${roomState.maxPlayers} players`;
    this.statusEl.textContent = isHost
      ? `${count} — start when ready, or wait for more.`
      : `${count} — waiting for the host to start…`;
  }
}
