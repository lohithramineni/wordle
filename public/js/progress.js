// Live player-progress strip for coded rooms. Renders the server's
// progressSnapshot — status plus per-row color counts, never letters.
// Nicknames are user-controlled and rendered with textContent only —
// never innerHTML (same rule as Lobby.render).
export class ProgressPanel {
  constructor() {
    this.el = document.getElementById("progressStrip");
  }

  show() { this.el.hidden = false; }

  hide() {
    this.el.hidden = true;
    this.el.replaceChildren();
  }

  render(progress, myId) {
    if (!progress) return;
    this.el.replaceChildren();
    for (const p of progress) {
      const chip = document.createElement("div");
      chip.className = "p-chip " + p.status;
      if (p.id === myId) chip.classList.add("me");

      const dot = document.createElement("span");
      dot.className = "p-dot";
      chip.appendChild(dot);

      const name = document.createElement("span");
      name.className = "p-name";
      name.textContent = p.nickname;
      chip.appendChild(name);

      if (p.status !== "disconnected") {
        const row = document.createElement("span");
        row.className = "p-rownum";
        row.textContent = "R" + Math.min(p.row + 1, 6);
        chip.appendChild(row);
      }

      const info = document.createElement("span");
      info.className = "p-info";
      const last = p.rows[p.rows.length - 1];
      if (p.status === "disconnected") {
        info.textContent = "left";
      } else if (last === "burned") {
        info.textContent = "burned";
      } else if (last) {
        for (const key of ["g", "y", "x"]) {
          const badge = document.createElement("span");
          badge.className = "cnt " + key;
          badge.textContent = last[key];
          info.appendChild(badge);
        }
      } else {
        info.textContent = "…";
      }
      chip.appendChild(info);
      this.el.appendChild(chip);
    }
  }
}
