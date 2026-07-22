import { scoreGuess } from "./scoring.js";
import { SOLUTIONS } from "../words/solutions.js";
import { VALID_SET } from "../words/valid.js";
import {
  ROWS, COLS, CLASSIC_ROUND_MS, SUDDEN_GAME_MS, MIN_MULT, MAX_MULT,
  GREEN_POINTS, YELLOW_POINTS, WIN_POINTS, UNUSED_ROW_POINTS,
} from "../config.js";

export function pickSolution(avoid) {
  let word;
  do { word = SOLUTIONS[(Math.random() * SOLUTIONS.length) | 0]; }
  while (word === avoid && SOLUTIONS.length > 1);
  return word;
}

// Server-authoritative round/game state machine. One instance == one player's
// board in one game; a solo game is just a room of size 1. Timers are
// wall-clock deadlines computed from Date.now(), never trusted from the
// client. When a shared clock (RoomSync) is injected, this round owns no
// deadlines of its own — the room's clock is the only authority.
export class Round {
  constructor(mode, prevSolution = null, forcedSolution = null, clock = null) {
    this.mode = mode; // "classic" | "sudden"
    this.solution = forcedSolution ?? pickSolution(prevSolution);
    this.clock = clock; // RoomSync for synced coded rooms, null for solo
    this.row = 0;
    this.guesses = [];
    this.burnedRows = [];
    this.gameOver = false;
    this.won = false;
    this.score = 0;
    // Discovery tracking for scoring: a guess only earns points for
    // information it newly reveals, so repeating known hints earns nothing.
    this.greenPositions = new Set(); // board positions already seen green
    this.yellowLetters = new Set();  // letters already discovered as present
    this.greenLetters = new Set();   // letters already seen green anywhere
    this.startedAt = Date.now();
    this.rowDeadline = this.mode === "classic" && !clock ? this.startedAt + CLASSIC_ROUND_MS : null;
    this.gameDeadline = this.mode === "sudden" && !clock ? this.startedAt + SUDDEN_GAME_MS : null;
  }

  currentDuration() {
    return this.mode === "sudden" ? SUDDEN_GAME_MS : CLASSIC_ROUND_MS;
  }

  timeLeft() {
    if (this.clock) return this.clock.timeLeft();
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
    return this.mode === "sudden" ? this.expire() : this.burnRow();
  }

  // Classic: forfeits the current row (solo timeout, or synced row-close for
  // a player who didn't submit in time). Same result shape as checkTimeout().
  burnRow() {
    const burnedRow = this.row;
    this.burnedRows.push(burnedRow);
    this.row++;
    if (this.row >= ROWS) {
      this.gameOver = true;
      return { timedOut: true, burnedRow, gameOver: true, won: false, answer: this.solution, score: this.score };
    }
    if (!this.clock) this.rowDeadline = Date.now() + CLASSIC_ROUND_MS;
    return { timedOut: true, burnedRow, gameOver: false, won: false, row: this.row };
  }

  // Sudden death: the game clock ran out.
  expire() {
    this.gameOver = true;
    return { timedOut: true, gameOver: true, won: false, answer: this.solution, score: this.score };
  }

  // Base points for what this guess NEWLY reveals: first green at a board
  // position pays full (or the upgrade difference if that letter was already
  // known-yellow), first yellow for a letter pays yellow, and anything
  // already known pays zero — so re-submitting known hints can't farm points.
  discoveryPoints(guess, states) {
    let base = 0;
    for (let i = 0; i < COLS; i++) {
      const ch = guess[i];
      if (states[i] === "correct") {
        if (!this.greenPositions.has(i)) {
          const upgrade = this.yellowLetters.has(ch) && !this.greenLetters.has(ch);
          base += upgrade ? GREEN_POINTS - YELLOW_POINTS : GREEN_POINTS;
          this.greenPositions.add(i);
        }
        this.greenLetters.add(ch);
      } else if (states[i] === "present") {
        if (!this.yellowLetters.has(ch) && !this.greenLetters.has(ch)) {
          base += YELLOW_POINTS;
        }
        this.yellowLetters.add(ch);
      }
    }
    return base;
  }

  submitGuess(rawGuess) {
    if (this.gameOver) return { error: "game-over" };
    const guess = String(rawGuess || "").toLowerCase();
    if (guess.length !== COLS) return { error: "wrong-length" };
    if (!VALID_SET.has(guess)) return { error: "not-in-word-list" };

    // Captured before any deadline mutation below, so it reflects the time
    // actually remaining when this guess was submitted, not a freshly-reset one.
    const mult = this.multiplier();
    const states = scoreGuess(guess, this.solution);
    const won = states.every((s) => s === "correct");
    this.guesses.push({ guess, states });

    let gained = Math.round(this.discoveryPoints(guess, states) * mult);

    if (won) {
      const unusedRows = ROWS - this.guesses.length;
      gained += Math.round((WIN_POINTS + UNUSED_ROW_POINTS * unusedRows) * mult);
      this.score += gained;
      this.won = true;
      this.gameOver = true;
      return { states, gained, score: this.score, gameOver: true, won: true, answer: this.solution };
    }
    this.score += gained;

    this.row++;
    if (this.row >= ROWS) {
      this.gameOver = true;
      return { states, gained, score: this.score, gameOver: true, won: false, answer: this.solution };
    }

    if (this.mode === "classic" && !this.clock) this.rowDeadline = Date.now() + CLASSIC_ROUND_MS;
    return { states, gained, score: this.score, gameOver: false, won: false, row: this.row };
  }
}
