// Pure DOM/rendering layer, ported from the original single-file Game class.
// It never computes tile colors or knows the solution — it only renders
// whatever the server sends. ui.js drives it in response to net.js events.
export class Game {
  constructor() {
    this.ROWS = 6; this.COLS = 5;

    this.boardEl    = document.getElementById("board");
    this.keyboardEl = document.getElementById("keyboard");
    this.toastWrap  = document.getElementById("toastWrap");
    this.liveEl     = document.getElementById("live");
    this.backdrop   = document.getElementById("modalBackdrop");
    this.modalTitle = document.getElementById("modalTitle");
    this.modalText  = document.getElementById("modalText");
    this.modalScore = document.getElementById("modalScore");
    this.playAgain  = document.getElementById("playAgain");
    this.changeModeBtn = document.getElementById("changeMode");
    this.clockEl    = document.getElementById("clock");
    this.scoreEl    = document.getElementById("score");
    this.multEl     = document.getElementById("mult");
    this.ringEl     = document.getElementById("ringProgress");
    this.stageEl    = document.getElementById("stage");
    this.vignetteEl = document.getElementById("vignette");
    this.modeLabel  = document.getElementById("modeLabel");
    this.startBackdrop   = document.getElementById("startBackdrop");
    this.startClassicBtn = document.getElementById("startClassic");
    this.startSuddenBtn  = document.getElementById("startSudden");
    this.lobbyBackdrop   = document.getElementById("lobbyBackdrop");

    this.ringLen = this.ringEl.getTotalLength();
    this.ringEl.style.strokeDasharray = this.ringLen;

    this.tiles = [];
    this.keyEls = new Map();
    this.keyState = new Map();
    this.mode = "classic";
    this.score = 0;
    this.row = 0; this.col = 0;
    this.current = new Array(this.COLS).fill("");
    this.locked = true;
    this.gameOver = true;
    this.lastWrongTaunt = null;
    this.lastIdleTaunt  = null;
    this._lowOn = false;

    this.buildBoard();
    this.buildKeyboard();

    this.tauntEl = document.createElement("div");
    this.tauntEl.className = "taunt";
    this.tauntEl.setAttribute("role", "status");
    this.toastWrap.appendChild(this.tauntEl);
    this._tauntHideT = null;
    this._tauntSwapT = null;
  }

  /* ============================================================
     STATIC DOM
     ============================================================ */
  buildBoard() {
    const frag = document.createDocumentFragment();
    for (let r = 0; r < this.ROWS; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "row"; rowEl.setAttribute("role", "row");
      const rowTiles = [];
      for (let c = 0; c < this.COLS; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.setAttribute("role", "gridcell");
        tile.setAttribute("aria-label", "empty");
        rowEl.appendChild(tile); rowTiles.push(tile);
      }
      frag.appendChild(rowEl); this.tiles.push(rowTiles);
    }
    this.boardEl.appendChild(frag);
    this.rowEls = Array.from(this.boardEl.children);
  }

  buildKeyboard() {
    const layout = [
      ["q","w","e","r","t","y","u","i","o","p"],
      ["a","s","d","f","g","h","j","k","l"],
      ["enter","z","x","c","v","b","n","m","back"]
    ];
    const backIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z"/></svg>';
    const frag = document.createDocumentFragment();
    for (const row of layout) {
      const rowEl = document.createElement("div");
      rowEl.className = "kb-row";
      for (const key of row) {
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "key"; btn.dataset.key = key;
        if (key === "enter" || key === "back") {
          btn.classList.add("wide");
          btn.innerHTML = key === "enter" ? "Enter" : backIcon;
          btn.setAttribute("aria-label", key === "enter" ? "Enter" : "Backspace");
        } else {
          btn.textContent = key; btn.setAttribute("aria-label", key);
          this.keyEls.set(key, btn);
        }
        rowEl.appendChild(btn);
      }
      frag.appendChild(rowEl);
    }
    this.keyboardEl.appendChild(frag);
  }

  overlayOpen() {
    return this.startBackdrop.classList.contains("open") ||
           this.backdrop.classList.contains("open") ||
           this.lobbyBackdrop.classList.contains("open");
  }

  /* ============================================================
     LETTER ENTRY (purely local — nothing is sent until Enter)
     ============================================================ */
  addLetter(letter) {
    if (this.col >= this.COLS) return;
    const tile = this.tiles[this.row][this.col];
    tile.textContent = letter;
    tile.classList.add("filled", "pop");
    tile.setAttribute("aria-label", letter);
    tile.addEventListener("animationend", () => tile.classList.remove("pop"), { once: true });
    this.current[this.col] = letter;
    this.col++;
  }

  deleteLetter() {
    if (this.col <= 0) return;
    this.col--;
    const tile = this.tiles[this.row][this.col];
    tile.textContent = "";
    tile.classList.remove("filled");
    tile.setAttribute("aria-label", "empty");
    this.current[this.col] = "";
  }

  currentGuess() { return this.current.join(""); }

  /* ============================================================
     REVEAL — driven by server-provided states, never computed here
     ============================================================ */
  reveal(states, onDone) {
    this.locked = true;
    const rowTiles = this.tiles[this.row];
    const FLIP = 650, STEP = 340;

    rowTiles.forEach((tile, i) => {
      setTimeout(() => {
        tile.classList.remove("pop");
        tile.classList.add("reveal");
        setTimeout(() => tile.classList.add(states[i]), FLIP / 2);
        setTimeout(() => { tile.className = "tile filled " + states[i]; }, FLIP + 20);
      }, i * STEP);
    });

    const total = (this.COLS - 1) * STEP + FLIP;
    setTimeout(() => {
      this.updateKeyboard(this.currentGuess(), states);
      if (onDone) onDone();
    }, total + 40);
  }

  updateKeyboard(guess, states) {
    const rank = { absent: 1, present: 2, correct: 3 };
    for (let i = 0; i < this.COLS; i++) {
      const ch = guess[i];
      const prev = this.keyState.get(ch) || 0;
      if (rank[states[i]] > prev) {
        this.keyState.set(ch, rank[states[i]]);
        const el = this.keyEls.get(ch);
        if (el) { el.classList.remove("correct","present","absent"); el.classList.add(states[i]); }
      }
    }
  }

  advanceRow(nextRow) {
    this.row = nextRow;
    this.col = 0;
    this.current = new Array(this.COLS).fill("");
  }

  awardPoints(score) {
    const gained = score - this.score;
    this.score = score;
    this.scoreEl.textContent = this.score;
    if (gained > 0) this.floatScore("+" + gained);
  }

  /* ============================================================
     TIMER — rendered from server-pushed timeLeft/mult, never
     computed locally
     ============================================================ */
  renderTimer(timeLeft, mult, durationMs) {
    const frac = Math.max(0, timeLeft / durationMs);

    this.ringEl.style.strokeDashoffset = this.ringLen * (1 - frac);
    let color = "var(--ring-ok)";
    if (frac <= 0.2) color = "var(--ring-danger)";
    else if (frac <= 0.5) color = "var(--ring-warn)";
    this.ringEl.style.stroke = color;

    const secs = Math.ceil(timeLeft / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
    this.clockEl.textContent = m + ":" + String(s).padStart(2, "0");
    this.clockEl.classList.toggle("warn",   frac <= 0.5 && frac > 0.2);
    this.clockEl.classList.toggle("danger", frac <= 0.2);

    this.multEl.textContent = "×" + mult.toFixed(1);

    const lowThresh = this.mode === "sudden" ? 30000 : 5000;
    this.setLowFX(timeLeft <= lowThresh && timeLeft > 0);
  }

  setLowFX(on) {
    if (on === this._lowOn) return;
    this._lowOn = on;
    this.vignetteEl.classList.toggle("on", on);
    this.stageEl.classList.toggle("lowshake", on);
  }

  /* ============================================================
     ROW ANIMATIONS
     ============================================================ */
  burnRow() {
    for (const tile of this.tiles[this.row]) tile.classList.add("burned");
    this.shakeRow();
  }
  shakeRow() {
    const rowEl = this.rowEls[this.row];
    rowEl.classList.add("shake");
    rowEl.addEventListener("animationend", () => rowEl.classList.remove("shake"), { once: true });
  }
  bounceRow() {
    this.tiles[this.row].forEach((tile, i) => {
      tile.style.animationDelay = (i * 90) + "ms";
      tile.classList.add("bounce");
      tile.addEventListener("animationend", () => {
        tile.classList.remove("bounce");
        tile.style.animationDelay = "";
      }, { once: true });
    });
  }

  /* ============================================================
     TOAST / TAUNT / FLOAT
     ============================================================ */
  toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    this.toastWrap.appendChild(t);
    setTimeout(() => {
      t.classList.add("out");
      t.addEventListener("animationend", () => t.remove(), { once: true });
    }, 1000);
  }

  taunt(msg, kind) {
    if (kind === "wrong") this.lastWrongTaunt = msg;
    if (kind === "idle")  this.lastIdleTaunt  = msg;
    const el = this.tauntEl;
    clearTimeout(this._tauntHideT);
    clearTimeout(this._tauntSwapT);
    const reveal = () => {
      el.textContent = msg;
      void el.offsetWidth;
      el.classList.add("show");
      this._tauntHideT = setTimeout(() => el.classList.remove("show"), 3600);
    };
    if (el.classList.contains("show")) {
      el.classList.remove("show");
      this._tauntSwapT = setTimeout(reveal, 360);
    } else {
      reveal();
    }
  }

  floatScore(txt) {
    const el = document.createElement("div");
    el.className = "float-score"; el.textContent = txt;
    document.body.appendChild(el);
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }

  announce(msg) { this.liveEl.textContent = msg; }

  /* ============================================================
     OVERLAYS
     ============================================================ */
  openOverlay(bd) {
    bd.classList.add("open");
    void bd.offsetWidth;
    bd.classList.add("show");
  }
  closeOverlay(bd, done) {
    bd.classList.remove("show");
    setTimeout(() => {
      bd.classList.remove("open");
      if (done) done();
    }, 420);
  }

  showWin(tries, score) {
    this.modalTitle.textContent = "Congratulations!";
    this.modalText.textContent = "You guessed it in " + tries + (tries === 1 ? " try." : " tries.");
    this.modalScore.innerHTML = "Score: <b>" + score + "</b>";
    this.openOverlay(this.backdrop);
    this.playAgain.focus();
  }

  showLose(answer, reason, score) {
    this.modalTitle.textContent = "The word was:";
    this.modalText.innerHTML = '<span class="answer">' + answer + "</span>";
    this.modalScore.innerHTML = (reason ? reason + "<br>" : "") + "Score: <b>" + score + "</b>";
    this.openOverlay(this.backdrop);
    this.playAgain.focus();
  }

  hideModal(done) { this.closeOverlay(this.backdrop, done); }

  showStart() {
    this.gameOver = true;
    this.locked = true;
    clearTimeout(this._tauntHideT); clearTimeout(this._tauntSwapT);
    this.tauntEl.classList.remove("show"); this.tauntEl.textContent = "";
    this.clearBoard();
    this.score = 0; this.scoreEl.textContent = "0";
    this.openOverlay(this.startBackdrop);
    this.startClassicBtn.focus();
  }

  clearBoard() {
    for (let r = 0; r < this.ROWS; r++)
      for (let c = 0; c < this.COLS; c++) {
        const tile = this.tiles[r][c];
        tile.textContent = "";
        tile.className = "tile";
        tile.style.animationDelay = "";
        tile.setAttribute("aria-label", "empty");
      }
    this.keyState.clear();
    for (const el of this.keyEls.values())
      el.classList.remove("correct","present","absent");
  }

  startRound(mode, row) {
    this.mode = mode;
    this.modeLabel.textContent = mode === "sudden" ? "Sudden Death" : "Classic";
    this.row = row; this.col = 0;
    this.current = new Array(this.COLS).fill("");
    this.gameOver = false;
    this.locked = false;
    this.score = 0; this.scoreEl.textContent = "0";
    this.lastWrongTaunt = null; this.lastIdleTaunt = null;
    clearTimeout(this._tauntHideT); clearTimeout(this._tauntSwapT);
    this.tauntEl.classList.remove("show"); this.tauntEl.textContent = "";
    this.clearBoard();
    this.announce("New game. " +
      (mode === "sudden" ? "Sudden death: five minutes total." : "Classic: 90 seconds per guess."));
  }
}
