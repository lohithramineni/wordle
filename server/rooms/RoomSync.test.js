import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomSync } from "./RoomSync.js";
import { Round } from "../game/round.js";
import { CLASSIC_ROUND_MS, SUDDEN_GAME_MS, MAX_MULT, ROWS } from "../config.js";

test("classic sync owns a row deadline; sudden owns a game deadline", () => {
  const classic = new RoomSync("classic");
  assert.ok(classic.rowDeadline > Date.now());
  assert.equal(classic.gameDeadline, null);
  assert.equal(classic.duration(), CLASSIC_ROUND_MS);

  const sudden = new RoomSync("sudden");
  assert.equal(sudden.rowDeadline, null);
  assert.ok(sudden.gameDeadline > Date.now());
  assert.equal(sudden.duration(), SUDDEN_GAME_MS);
  assert.ok(sudden.multiplier() <= MAX_MULT && sudden.multiplier() > MAX_MULT - 0.1);
});

test("advanceRow moves the shared row and refreshes the classic deadline", () => {
  const sync = new RoomSync("classic");
  sync.rowDeadline = Date.now() + 1000; // pretend the row is nearly over
  sync.advanceRow();
  assert.equal(sync.rowIndex, 1);
  assert.ok(sync.timeLeft() > CLASSIC_ROUND_MS - 100);
});

test("a synced round owns no deadlines and delegates timeLeft to the clock", () => {
  const sync = new RoomSync("classic");
  const round = new Round("classic", null, "crane", sync);
  assert.equal(round.rowDeadline, null);
  assert.equal(round.gameDeadline, null);
  sync.rowDeadline = Date.now() + 5000;
  assert.ok(Math.abs(round.timeLeft() - 5000) < 100);
  assert.ok(Math.abs(round.timeLeft() - sync.timeLeft()) < 10);
});

test("synced classic submit does not move the shared deadline", () => {
  const sync = new RoomSync("classic");
  const deadline = Date.now() + 5000;
  sync.rowDeadline = deadline;
  const round = new Round("classic", null, "crane", sync);
  const result = round.submitGuess("slate");
  assert.equal(result.gameOver, false);
  assert.equal(sync.rowDeadline, deadline);
  assert.equal(round.rowDeadline, null);
});

test("solo classic submit still resets its own deadline (regression)", () => {
  const round = new Round("classic", null, "crane");
  round.rowDeadline = Date.now() + 1000;
  round.submitGuess("slate");
  assert.ok(round.timeLeft() > CLASSIC_ROUND_MS - 100);
});

test("burnRow records the burn, advances, and does not touch a synced deadline", () => {
  const sync = new RoomSync("classic");
  const deadline = Date.now() + 5000;
  sync.rowDeadline = deadline;
  const round = new Round("classic", null, "crane", sync);
  const result = round.burnRow();
  assert.deepEqual(round.burnedRows, [0]);
  assert.equal(round.row, 1);
  assert.equal(result.burnedRow, 0);
  assert.equal(result.gameOver, false);
  assert.equal(sync.rowDeadline, deadline);
});

test("burnRow on the final row ends the game with the answer", () => {
  const round = new Round("classic", null, "crane", new RoomSync("classic"));
  for (let i = 0; i < ROWS - 1; i++) round.burnRow();
  const result = round.burnRow();
  assert.equal(result.gameOver, true);
  assert.equal(result.won, false);
  assert.equal(result.answer, "crane");
  assert.equal(round.gameOver, true);
  assert.equal(round.burnedRows.length, ROWS);
});

test("solo burnRow via checkTimeout resets the solo deadline (regression)", () => {
  const round = new Round("classic", null, "crane");
  round.rowDeadline = Date.now() - 1;
  const result = round.checkTimeout();
  assert.equal(result.burnedRow, 0);
  assert.equal(result.gameOver, false);
  assert.ok(round.timeLeft() > CLASSIC_ROUND_MS - 100);
});

test("expire ends a sudden round with the answer and score", () => {
  const round = new Round("sudden", null, "crane", new RoomSync("sudden"));
  round.submitGuess("crate");
  const result = round.expire();
  assert.equal(result.gameOver, true);
  assert.equal(result.won, false);
  assert.equal(result.answer, "crane");
  assert.equal(result.score, round.score);
  assert.equal(round.gameOver, true);
});
