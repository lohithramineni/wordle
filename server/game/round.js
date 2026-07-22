import { scoreGuess } from "./scoring.js";
import { SOLUTIONS } from "../words/solutions.js";
import { VALID_SET } from "../words/valid.js";
import { ROWS, COLS, CLASSIC_ROUND_MS, SUDDEN_GAME_MS, MIN_MULT, MAX_MULT } from "../config.js";

function pickSolution(avoid) {
  let word;
  do { word = SOLUTIONS[(Math.random() * SOLUTIONS.length) | 0]; }
  while (word === avoid && SOLUTIONS.length > 1);
  return word;
}

// Server-authoritative round/game state machine. One instance == one room's
// current game; a solo game is just a room of size 1. Timers are wall-clock
// deadlines computed from Date.now(), never trusted from the client.
export class Round {
  constructor(mode, prevSolution = null) {
    this.mode = mode; // "classic" | "sudden"
    this.solution = pickSolution(prevSolution);
    this.row = 0;
    this.guesses = [];
    this.gameOver = false;
    this.won = false;
    this.score = 0;
    this.startedAt = Date.now();
    this.rowDeadline = this.mode === "classic" ? this.startedAt + CLASSIC_ROUND_MS : null;
    this.gameDeadline = this.mode === "sudden" ? this.startedAt + SUDDEN_GAME_MS : null;
  }

  currentDuration() {
    return this.mode === "sudden" ? SUDDEN_GAME_MS : CLASSIC_ROUND_MS;
  }

  timeLeft() {
    const deadline = this.mode === "sudden" ? this.gameDeadline : this.rowDeadline;
    return Math.max(0, deadline - Date.now());
  }

  multiplier() {
    const frac = Math.max(0, this.timeLeft() / this.currentDuration());
    return MIN_MULT + (MAX_MULT - MIN_MULT) * frac;
  }

  // Returns null if the round has not timed out yet; otherwise applies the
  // timeout (burns a row in classic, ends the game in sudden) and returns
  // a result describing what happened, mirroring submitGuess()'s shape.
  checkTimeout() {
    if (this.gameOver || this.timeLeft() > 0) return null;

    if (this.mode === "sudden") {
      this.gameOver = true;
      return { timedOut: true, gameOver: true, won: false, answer: this.solution, score: this.score };
    }

    // classic: burn this row and move on
    const burnedRow = this.row;
    this.row++;
    if (this.row >= ROWS) {
      this.gameOver = true;
      return { timedOut: true, burnedRow, gameOver: true, won: false, answer: this.solution, score: this.score };
    }
    this.rowDeadline = Date.now() + CLASSIC_ROUND_MS;
    return { timedOut: true, burnedRow, gameOver: false, won: false, row: this.row };
  }

  submitGuess(rawGuess) {
    if (this.gameOver) return { error: "game-over" };
    const guess = String(rawGuess || "").toLowerCase();
    if (guess.length !== COLS) return { error: "wrong-length" };
    if (!VALID_SET.has(guess)) return { error: "not-in-word-list" };

    const states = scoreGuess(guess, this.solution);
    const won = states.every((s) => s === "correct");
    this.guesses.push({ guess, states });

    if (won) {
      const gained = Math.round(300 * this.multiplier());
      this.score += gained;
      this.won = true;
      this.gameOver = true;
      return { states, gained, score: this.score, gameOver: true, won: true, answer: this.solution };
    }

    this.row++;
    if (this.row >= ROWS) {
      this.gameOver = true;
      return { states, score: this.score, gameOver: true, won: false, answer: this.solution };
    }

    if (this.mode === "classic") this.rowDeadline = Date.now() + CLASSIC_ROUND_MS;
    return { states, score: this.score, gameOver: false, won: false, row: this.row };
  }
}
