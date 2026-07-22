import { Game } from "./game.js";
import { Net } from "./net.js";
import { WRONG_TAUNTS, IDLE_TAUNTS, pick } from "./taunts.js";

const CLASSIC_ROUND_MS = 90000;
const SUDDEN_GAME_MS = 300000;
const TAUNT_MS = 10000;

const game = new Game();
const net = new Net();

let starting = false;
let pendingSubmit = false;
let latestTick = null; // { timeLeft, mult, receivedAt }
let idleAccum = 0;
let lastFrame = null;

function currentDuration() {
  return game.mode === "sudden" ? SUDDEN_GAME_MS : CLASSIC_ROUND_MS;
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
   START / MODE SELECT
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
  game.hideModal(() => game.showStart());
});

function chooseMode(mode) {
  if (starting || !game.startBackdrop.classList.contains("open")) return;
  starting = true;

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
   SERVER EVENTS
   ============================================================ */
net.on("roundStarted", ({ mode, row }) => {
  game.startRound(mode, row);
  latestTick = null;
  idleAccum = 0;
  lastFrame = null;
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
