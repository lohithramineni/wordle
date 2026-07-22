import { Game } from "./game.js";
import { Net } from "./net.js";
import { Lobby } from "./lobby.js";
import { WRONG_TAUNTS, IDLE_TAUNTS, pick } from "./taunts.js";

const CLASSIC_ROUND_MS = 90000;
const SUDDEN_GAME_MS = 300000;
const TAUNT_MS = 10000;

const game = new Game();
const net = new Net();
const lobby = new Lobby();

let starting = false;
let pendingSubmit = false;
let latestTick = null; // { timeLeft, mult, receivedAt }
let idleAccum = 0;
let lastFrame = null;
let inMultiplayer = false;

function currentDuration() {
  return game.mode === "sudden" ? SUDDEN_GAME_MS : CLASSIC_ROUND_MS;
}

function backToMenu() {
  inMultiplayer = false;
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
net.on("roundStarted", ({ mode, row }) => {
  const begin = () => {
    game.startRound(mode, row);
    latestTick = null;
    idleAccum = 0;
    lastFrame = null;
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
  // "gameOver" event (the server sends both when a guess ends the game)
  // doesn't show the result card before the tiles finish flipping.
  game.reveal(result.states, () => {
    pendingSubmit = false;
    if (result.gameOver) {
      finishGame(result);
      return;
    }
    game.awardPoints(result.score);
    game.taunt(pick(WRONG_TAUNTS, game.lastWrongTaunt), "wrong");
    game.advanceRow(result.row);
    game.locked = false;
  });
});

net.on("guessError", ({ error }) => {
  pendingSubmit = false;
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
  setTimeout(() => {
    game.advanceRow(result.row);
    game.locked = false;
  }, 500);
});

net.on("gameOver", (result) => {
  // Already handled via the guessResult reveal callback for a win/loss
  // triggered by a submitted guess; this covers timeout-driven endings
  // (sudden-death expiry, or the final burned row in classic).
  if (pendingSubmit) return;
  finishGame(result, true);
});

function finishGame(result, timedOut = false) {
  game.gameOver = true;
  game.locked = true;
  if (inMultiplayer) {
    game.playAgain.style.display = "none";
    game.changeModeBtn.textContent = "Back to Menu";
  } else {
    game.playAgain.style.display = "";
    game.changeModeBtn.textContent = "Change Mode";
  }
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
  if (!latestTick || game.gameOver) return;
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
