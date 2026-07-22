import "dotenv/config";

export const PORT = process.env.PORT || 3000;
export const ROWS = 6;
export const COLS = 5;
export const CLASSIC_ROUND_MS = 90000; // per-row deadline, "Rapid Rounds"
export const SUDDEN_GAME_MS = 300000;  // whole-game deadline
export const MAX_MULT = 3.0;
export const MIN_MULT = 1.0;
export const TICK_MS = 500;
export const GREEN_POINTS = 60;
export const YELLOW_POINTS = 20;
