import { test } from "node:test";
import assert from "node:assert/strict";
import { Round } from "./round.js";
import {
  ROWS, GREEN_POINTS, YELLOW_POINTS, WIN_POINTS, UNUSED_ROW_POINTS, MAX_MULT,
} from "../config.js";

// A frozen clock pinning the multiplier at MAX_MULT makes point math exact.
const fullTimeClock = { timeLeft: () => 90000 };

function syncedRound(solution) {
  const r = new Round("classic", null, solution, fullTimeClock);
  return r;
}

test("first discoveries pay full green/yellow points", () => {
  const r = syncedRound("merit");
  // pilot vs merit: i present (new yellow), t correct (new green), rest absent
  const { gained } = r.submitGuess("pilot");
  assert.equal(gained, Math.round((GREEN_POINTS + YELLOW_POINTS) * MAX_MULT));
});

test("repeating known hints earns zero", () => {
  const r = syncedRound("merit");
  r.submitGuess("pilot");
  const { gained } = r.submitGuess("pilot");
  assert.equal(gained, 0);
});

test("yellow-to-green upgrade pays only the difference", () => {
  const r = syncedRound("merit");
  r.submitGuess("timer"); // t,i,m,e,r all present vs merit — 5 new yellows
  // remit vs merit: e,i,t green (3 upgrades), r,m present (already known)
  const { gained } = r.submitGuess("remit");
  assert.equal(gained, Math.round(3 * (GREEN_POINTS - YELLOW_POINTS) * MAX_MULT));
});

test("win bonus scales with unused rows", () => {
  const winIn = (guessesBeforeWin) => {
    const r = syncedRound("merit");
    for (let i = 0; i < guessesBeforeWin; i++) r.submitGuess("plonk"); // no overlap
    const { gained } = r.submitGuess("merit");
    return { gained, r };
  };
  const fast = winIn(1); // solved in 2 -> 4 unused rows
  const slow = winIn(2); // solved in 3 -> 3 unused rows
  assert.ok(fast.gained > slow.gained);
  const discovery = 5 * GREEN_POINTS; // all five greens are new in both cases
  assert.equal(
    fast.gained,
    Math.round(discovery * MAX_MULT) +
      Math.round((WIN_POINTS + UNUSED_ROW_POINTS * (ROWS - 2)) * MAX_MULT)
  );
});

test("a farmer never outscores a winner (the reported bug)", () => {
  const farmer = syncedRound("merit");
  farmer.submitGuess("shout");
  for (let i = 0; i < 5; i++) farmer.submitGuess("pilot"); // repeat-spam to the end
  assert.equal(farmer.gameOver, true);
  assert.equal(farmer.won, false);

  const winner = syncedRound("merit");
  winner.submitGuess("pilot");
  winner.submitGuess("merit");
  assert.equal(winner.won, true);
  assert.ok(winner.score > farmer.score);
});
