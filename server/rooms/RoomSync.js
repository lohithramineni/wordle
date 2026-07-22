import { CLASSIC_ROUND_MS, SUDDEN_GAME_MS, MIN_MULT, MAX_MULT } from "../config.js";

// The single shared clock for a coded room's game. Every player's Round
// delegates timeLeft() here, so the whole room sees one authoritative
// deadline instead of N private ones.
//
// classic ("Rapid Rounds"): one rowDeadline per shared row; advanceRow()
// moves the whole room to the next row on a fresh 90s clock.
// sudden: one immutable gameDeadline set at game start; rowIndex is unused.
export class RoomSync {
  constructor(mode) {
    this.mode = mode; // "classic" | "sudden"
    this.rowIndex = 0;
    const now = Date.now();
    this.rowDeadline = mode === "classic" ? now + CLASSIC_ROUND_MS : null;
    this.gameDeadline = mode === "sudden" ? now + SUDDEN_GAME_MS : null;
  }

  duration() {
    return this.mode === "sudden" ? SUDDEN_GAME_MS : CLASSIC_ROUND_MS;
  }

  timeLeft() {
    const deadline = this.mode === "sudden" ? this.gameDeadline : this.rowDeadline;
    return Math.max(0, deadline - Date.now());
  }

  multiplier() {
    const frac = Math.max(0, this.timeLeft() / this.duration());
    return MIN_MULT + (MAX_MULT - MIN_MULT) * frac;
  }

  advanceRow() {
    this.rowIndex++;
    if (this.mode === "classic") this.rowDeadline = Date.now() + CLASSIC_ROUND_MS;
  }
}
