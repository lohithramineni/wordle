import { Game } from "./game.js";
import { Net } from "./net.js";
import { Lobby } from "./lobby.js";
import { ProgressPanel } from "./progress.js";
import { WRONG_TAUNTS, IDLE_TAUNTS, pick } from "./taunts.js";

const CLASSIC_ROUND_MS = 90000;
const SUDDEN_GAME_MS = 300000;
const TAUNT_MS = 10000;

const game = new Game();
const net = new Net();
const lobby = new Lobby();
const progressPanel = new ProgressPanel();

let starting = false;
let pendingSubmit = false;
let latestTick = null; // { timeLeft, mult, receivedAt }
let idleAccum = 0;
let lastFrame = null;
let inMultiplayer = false;

// Synced-room state. In synced classic, input unlocks on roomAdvance, not
// on your own reveal: syncRow tracks the room's shared row so a reveal
// that finishes after the room already advanced can unlock immediately.
// waitingForOthers = my game ended but the room's hasn't (keep the clock
// live, no modal until roomGameOver). pendingRoomOver stashes a
// roomGameOver that lands mid-reveal.
let waitingForOthers = false;
let syncRow = 0;
let pendingRoomOver = null;

function currentDuration() {
  return game.mode === "sudden" ? SUDDEN_GAME_MS : CLASSIC_ROUND_MS;
}

function backToMenu() {
  inMultiplayer = false;
  waitingForOthers = false;
  syncRow = 0;
  pendingRoomOver = null;
  progressPanel.hide();
  game.hideWaiting();
  game.playAgain.style.display = "";
  game.changeModeBtn.textContent = "Change Mode";
  game.showStart();
  lobby.showMenuView("menuHome");
}

/* ============================================================
   INPUT
   ============================================================ */
game.keyboardEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".key");
  if (!btn) return;
  btn.blur();
  handleKey(btn.dataset.key);
});

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (game.overlayOpen()) return;

  const k = e.key;
  if (k === "Enter") {
    e.preventDefault();
    const ae = document.activeElement;
    if (ae && typeof ae.blur === "function" && ae.tagName === "BUTTON") ae.blur();
    handleKey("enter");
  } else if (k === "Backspace") {
    handleKey("back");
  } else if (/^[a-zA-Z]$/.test(k)) {
    handleKey(k.toLowerCase());
  }
});

function handleKey(key) {
  if (game.locked || game.gameOver) return;
  if (key === "enter") submit();
  else if (key === "back") game.deleteLetter();
  else game.addLetter(key);
}

function submit() {
  if (game.col < game.COLS) {
    game.toast("Not enough letters");
    game.shakeRow();
    return;
  }
  game.locked = true;
  pendingSubmit = true;
  net.submitGuess(game.currentGuess());
}

/* ============================================================
   MENU NAVIGATION
   ============================================================ */
document.getElementById("menuSoloBtn").addEventListener("click", () => lobby.showMenuView("menuSolo"));
document.getElementById("menuMultiBtn").addEventListener("click", () => lobby.showMenuView("menuMulti"));
document.getElementById("menuCreateBtn").addEventListener("click", () => lobby.showMenuView("menuCreate"));
document.getElementById("menuJoinBtn").addEventListener("click", () => lobby.showMenuView("menuJoin"));
for (const btn of document.querySelectorAll(".menu-back")) {
  btn.addEventListener("click", () => lobby.showMenuView(btn.dataset.back));
}

const createNick = document.getElementById("createNick");
const createError = document.getElementById("createError");
const joinNick = document.getElementById("joinNick");
const joinCode = document.getElementById("joinCode");
const joinError = document.getElementById("joinError");
const joinBtn = document.getElementById("joinBtn");

function showFormError(el, msg) {
  el.textContent = msg;
  el.hidden = !msg;
}

const ERROR_TEXT = {
  "room-not-found": "No room with that code.",
  "room-full": "That room is full.",
  "game-in-progress": "That game has already started.",
  "invalid-nickname": "Enter a nickname first.",
  "invalid-mode": "Pick a mode.",
  "not-host": "Only the host can start the game.",
  "already-started": "The game has already started.",
  "not-in-room": "You're not in a room.",
};

function createRoom(mode) {
  const nickname = createNick.value.trim();
  if (!nickname) {
    showFormError(createError, "Enter a nickname first.");
    createNick.focus();
    return;
  }
  showFormError(createError, "");
  net.createRoom(nickname, mode);
}

document.getElementById("createClassic").addEventListener("click", () => createRoom("classic"));
document.getElementById("createSudden").addEventListener("click", () => createRoom("sudden"));

function joinRoom() {
  const nickname = joinNick.value.trim();
  const code = joinCode.value.trim().toUpperCase();
  if (!nickname) {
    showFormError(joinError, "Enter a nickname first.");
    joinNick.focus();
    return;
  }
  if (code.length !== 6) {
    showFormError(joinError, "Room codes are 6 characters.");
    joinCode.focus();
    return;
  }
  showFormError(joinError, "");
  net.joinRoom(code, nickname);
}

joinBtn.addEventListener("click", joinRoom);
joinCode.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
joinNick.addEventListener("keydown", (e) => { if (e.key === "Enter") joinCode.focus(); });
createNick.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("createClassic").focus();
});

/* ============================================================
   LOBBY
   ============================================================ */
document.getElementById("lobbyStart").addEventListener("click", () => {
  if (!game.lobbyBackdrop.classList.contains("open")) return;
  net.startGame();
});
document.getElementById("lobbyLeave").addEventListener("click", () => {
  if (!game.lobbyBackdrop.classList.contains("open")) return;
  net.leaveRoom();
});

function enterLobby(roomState) {
  inMultiplayer = true;
  lobby.render(roomState, net.id);
  game.closeOverlay(game.startBackdrop, () => {
    game.openOverlay(game.lobbyBackdrop);
  });
}

net.on("roomCreated", ({ roomState }) => enterLobby(roomState));
net.on("joinedRoom", ({ roomState }) => enterLobby(roomState));

net.on("roomState", ({ roomState }) => {
  if (game.lobbyBackdrop.classList.contains("open")) {
    lobby.render(roomState, net.id);
  }
});

net.on("roomError", ({ error }) => {
  const msg = ERROR_TEXT[error] || "Something went wrong.";
  if (game.startBackdrop.classList.contains("open")) {
    showFormError(createError, msg);
  } else {
    game.toast(msg);
  }
});

net.on("joinError", ({ error }) => {
  showFormError(joinError, ERROR_TEXT[error] || "Couldn't join that room.");
});

net.on("roomClosed", () => {
  if (!inMultiplayer) return;
  game.toast("Room closed (inactive)");
  const closeLobby = (done) =>
    game.lobbyBackdrop.classList.contains("open")
      ? game.closeOverlay(game.lobbyBackdrop, done)
      : done();
  closeLobby(() => backToMenu());
});

net.on("leftRoom", () => {
  const closeLobby = (done) =>
    game.lobbyBackdrop.classList.contains("open")
      ? game.closeOverlay(game.lobbyBackdrop, done)
      : done();
  closeLobby(() => backToMenu());
});

/* ============================================================
   START / MODE SELECT (solo)
   ============================================================ */
game.startClassicBtn.addEventListener("click", () => chooseMode("classic"));
game.startSuddenBtn.addEventListener("click", () => chooseMode("sudden"));
game.playAgain.addEventListener("click", () => {
  if (!game.backdrop.classList.contains("open")) return;
  game.playAgain.blur();
  game.hideModal(() => net.startSolo(game.mode));
});
game.changeModeBtn.addEventListener("click", () => {
  if (!game.backdrop.classList.contains("open")) return;
  game.changeModeBtn.blur();
  if (inMultiplayer) {
    net.leaveRoom();
    game.hideModal(() => {});
    return;
  }
  game.hideModal(() => backToMenu());
});

function chooseMode(mode) {
  if (starting || !game.startBackdrop.classList.contains("open")) return;
  starting = true;
  inMultiplayer = false;

  const chosen = mode === "sudden" ? game.startSuddenBtn : game.startClassicBtn;
  const other  = mode === "sudden" ? game.startClassicBtn : game.startSuddenBtn;
  chosen.blur(); other.blur();
  chosen.classList.add("chosen");
  other.classList.add("dim");

  setTimeout(() => {
    game.closeOverlay(game.startBackdrop, () => {
      chosen.classList.remove("chosen");
      other.classList.remove("dim");
      starting = false;
      net.startSolo(mode);
    });
  }, 420);
}

/* ============================================================
   SERVER EVENTS (game protocol — shared by solo and multiplayer)
   ============================================================ */
net.on("roundStarted", ({ mode, row, progress }) => {
  const begin = () => {
    game.startRound(mode, row);
    latestTick = null;
    idleAccum = 0;
    lastFrame = null;
    waitingForOthers = false;
    syncRow = 0;
    pendingRoomOver = null;
    // A progress snapshot in the payload is what marks a synced room.
    if (progress) {
      progressPanel.render(progress, net.id);
      progressPanel.show();
    } else {
      progressPanel.hide();
    }
  };
  if (game.lobbyBackdrop.classList.contains("open")) {
    game.closeOverlay(game.lobbyBackdrop, begin);
  } else {
    begin();
  }
});

net.on("tick", ({ timeLeft, mult }) => {
  latestTick = { timeLeft, mult, receivedAt: performance.now() };
});

net.on("guessResult", (result) => {
  // pendingSubmit stays true through the reveal animation so a same-tick
  // "gameOver"/"roomGameOver" event (the server sends both when a guess
  // ends the game) doesn't show the result card before the tiles finish
  // flipping.
  game.reveal(result.states, () => {
    pendingSubmit = false;
    if (result.gameOver) {
      if (inMultiplayer) finishMultiplayer(result);
      else finishGame(result);
      return;
    }
    game.awardPoints(result.score);
    game.taunt(pick(WRONG_TAUNTS, game.lastWrongTaunt), "wrong");
    game.advanceRow(result.row);
    // Synced classic stays locked until the whole room advances — unless
    // the roomAdvance already arrived while the tiles were flipping.
    if (!(inMultiplayer && game.mode === "classic" && result.row > syncRow)) {
      game.locked = false;
    }
  });
});

net.on("guessError", ({ error }) => {
  pendingSubmit = false;
  if (error === "row-locked") {
    // Server-side gate: this row is done for us; roomAdvance will unlock.
    game.toast("Wait for the next row");
    return;
  }
  game.locked = false;
  if (error === "not-in-word-list") {
    game.toast("Not in word list");
    game.taunt(pick(WRONG_TAUNTS, game.lastWrongTaunt), "wrong");
  } else {
    game.toast("Something went wrong");
  }
  game.shakeRow();
});

net.on("rowBurned", (result) => {
  game.burnRow();
  game.taunt("Too slow. That guess is ash now.", "wrong");
  if (inMultiplayer) {
    // Synced classic: the roomAdvance right behind this event unlocks
    // input (or roomGameOver ends it) — never a local timer.
    if (result.gameOver) {
      finishMultiplayer(result);
    } else {
      game.advanceRow(result.row);
    }
    return;
  }
  setTimeout(() => {
    game.advanceRow(result.row);
    game.locked = false;
  }, 500);
});

net.on("gameOver", (result) => {
  // Solo only (coded rooms end via roomGameOver). Already handled via the
  // guessResult reveal callback for a win/loss triggered by a submitted
  // guess; this covers timeout-driven endings (sudden-death expiry, or
  // the final burned row in classic).
  if (pendingSubmit || inMultiplayer) return;
  finishGame(result, true);
});

net.on("roomAdvance", ({ row, timeLeft, mult, progress }) => {
  if (!inMultiplayer) return;
  syncRow = row;
  latestTick = { timeLeft, mult, receivedAt: performance.now() };
  progressPanel.render(progress, net.id);
  // A mid-reveal advance is handled by the reveal callback's syncRow check.
  if (!waitingForOthers && !game.gameOver && !pendingSubmit) {
    game.locked = false;
  }
});

net.on("progressState", ({ progress }) => {
  if (inMultiplayer) progressPanel.render(progress, net.id);
});

net.on("roomGameOver", (payload) => {
  if (!inMultiplayer) return;
  if (pendingSubmit) {
    // My own winning/losing guess ended the room; let the tiles finish
    // flipping first (finishMultiplayer picks this up).
    pendingRoomOver = payload;
    return;
  }
  showRoomResults(payload);
});

// My game ended but the room's may not have: no modal, no answer — just
// the waiting banner with the clock and progress strip still live.
function finishMultiplayer(result) {
  game.gameOver = true;
  game.locked = true;
  waitingForOthers = true;
  game.awardPoints(result.score);
  if (result.won) {
    game.bounceRow();
    game.announce("Correct. Waiting for the others to finish.");
    game.showWaiting("You got it! Waiting for others…");
  } else {
    game.announce("Out of guesses. Waiting for the others to finish.");
    game.showWaiting("You're done — waiting for others…");
  }
  if (pendingRoomOver) {
    const payload = pendingRoomOver;
    pendingRoomOver = null;
    showRoomResults(payload);
  }
}

// The simultaneous shared ending: everyone gets the answer and standings
// in the same tick.
function showRoomResults({ answer, results }) {
  waitingForOthers = false;
  pendingRoomOver = null;
  game.gameOver = true;
  game.locked = true;
  game.hideWaiting();
  game.playAgain.style.display = "none";
  game.changeModeBtn.textContent = "Back to Menu";
  game.announce("Game over. The word was " + answer);
  setTimeout(() => game.showResults(answer, results, net.id), 300);
}

function finishGame(result, timedOut = false) {
  game.gameOver = true;
  game.locked = true;
  game.playAgain.style.display = "";
  game.changeModeBtn.textContent = "Change Mode";
  if (result.won) {
    game.awardPoints(result.score);
    game.bounceRow();
    game.announce("Correct. You won.");
    setTimeout(() => game.showWin(game.row + 1, result.score), 1100);
  } else {
    game.awardPoints(result.score);
    const reason = timedOut
      ? (game.mode === "sudden" ? "The clock beat you." : "You let the clock burn every guess.")
      : "You ran out of guesses.";
    game.announce("Game over. The word was " + result.answer);
    setTimeout(() => game.showLose(result.answer, reason, result.score), 300);
  }
}

/* ============================================================
   RENDER LOOP — smooths the server's periodic tick into the ring
   ============================================================ */
function frame(now) {
  requestAnimationFrame(frame);
  // Keep rendering while waitingForOthers: my game is over but the
  // room's clock is still the star of the waiting screen.
  if (!latestTick || (game.gameOver && !waitingForOthers)) return;
  const dt = lastFrame ? now - lastFrame : 0;
  lastFrame = now;

  const displayed = Math.max(0, latestTick.timeLeft - (performance.now() - latestTick.receivedAt));
  game.renderTimer(displayed, latestTick.mult, currentDuration());

  if (!game.locked) {
    idleAccum += dt;
    if (idleAccum >= TAUNT_MS) {
      idleAccum = 0;
      game.taunt(pick(IDLE_TAUNTS, game.lastIdleTaunt), "idle");
    }
  } else {
    idleAccum = 0;
  }
}
requestAnimationFrame(frame);

game.showStart();
lobby.showMenuView("menuHome");
