import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomSync } from "./RoomSync.js";
import { RoomManager } from "./RoomManager.js";
import { Round } from "../game/round.js";
import { CLASSIC_ROUND_MS, SUDDEN_GAME_MS, MAX_MULT, ROWS } from "../config.js";

// Three-player coded room, game started on a forced solution so guesses
// score predictably.
function playingRoom(mode = "classic", solution = "crane") {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "A", mode);
  rm.joinRoom("s2", room.code, "B");
  rm.joinRoom("s3", room.code, "C");
  room.startGame();
  for (const round of room.rounds.values()) round.solution = solution;
  return { rm, room };
}

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

test("coded startGame shares one sync clock; solo gets none", () => {
  const { room } = playingRoom();
  assert.ok(room.sync instanceof RoomSync);
  for (const round of room.rounds.values()) {
    assert.equal(round.clock, room.sync);
    assert.equal(round.rowDeadline, null);
  }
  const rm = new RoomManager();
  const { room: solo } = rm.startSoloGame("x1", "classic");
  assert.equal(solo.sync, null);
  assert.equal(solo.getRound("x1").clock, null);
  assert.ok(solo.getRound("x1").rowDeadline > Date.now());
});

test("canSubmit row-locks a synced classic player until the room advances", () => {
  const { room } = playingRoom();
  assert.equal(room.canSubmit("s1"), null);
  room.getRound("s1").submitGuess("slate");
  assert.equal(room.canSubmit("s1"), "row-locked");
  assert.equal(room.canSubmit("s2"), null);
  room.sync.advanceRow();
  room.getRound("s2").burnRow();
  room.getRound("s3").burnRow();
  assert.equal(room.canSubmit("s1"), null);
});

test("canSubmit never locks sudden rooms or solo", () => {
  const { room } = playingRoom("sudden");
  room.getRound("s1").submitGuess("slate");
  assert.equal(room.canSubmit("s1"), null);
  const rm = new RoomManager();
  const { room: solo } = rm.startSoloGame("x1", "classic");
  solo.getRound("x1").submitGuess("slate");
  assert.equal(solo.canSubmit("x1"), null);
});

test("allSubmitted flips when the last alive player submits; finished players never block", () => {
  const { room } = playingRoom();
  room.getRound("s1").solution = "slate";
  room.getRound("s1").submitGuess("slate"); // s1 wins outright
  assert.equal(room.allSubmitted(), false);
  room.getRound("s2").submitGuess("crate");
  assert.equal(room.allSubmitted(), false);
  room.getRound("s3").submitGuess("crate");
  assert.equal(room.allSubmitted(), true);
});

test("closeRow burns exactly the non-submitters and advances the room", () => {
  const { room } = playingRoom();
  room.getRound("s1").submitGuess("slate");
  const burns = room.closeRow();
  assert.deepEqual(burns.map((b) => b.socketId).sort(), ["s2", "s3"]);
  assert.equal(room.sync.rowIndex, 1);
  for (const b of burns) {
    assert.equal(b.result.burnedRow, 0);
    assert.equal(b.result.gameOver, false);
  }
  assert.deepEqual(room.getRound("s1").burnedRows, []);
  assert.equal(room.getRound("s2").row, 1);
});

test("closeRow on the final row ends the stragglers' games", () => {
  const { room } = playingRoom();
  for (let i = 0; i < ROWS - 1; i++) room.closeRow();
  const burns = room.closeRow();
  assert.equal(burns.length, 3);
  for (const b of burns) assert.equal(b.result.gameOver, true);
  assert.equal(room.allFinished(), true);
});

test("mid-game departure keeps its score and unblocks allSubmitted/allFinished", () => {
  const { rm, room } = playingRoom();
  room.getRound("s1").submitGuess("crate");
  room.getRound("s2").submitGuess("crate");
  assert.equal(room.allSubmitted(), false);
  rm.leaveCurrentRoom("s3"); // the laggard drops
  assert.equal(room.allSubmitted(), true);
  assert.equal(room.departed.length, 1);
  assert.equal(room.departed[0].nickname, "C");
  assert.equal(room.departed[0].disconnected, true);
  const results = room.results();
  assert.equal(results.length, 3);
  assert.ok(results.some((r) => r.id === "s3"));
});

test("results includes everyone, sorted by score, with departed players", () => {
  const { rm, room } = playingRoom();
  room.getRound("s1").solution = "slate";
  room.getRound("s1").submitGuess("slate");
  room.getRound("s2").submitGuess("crate");
  rm.leaveCurrentRoom("s2");
  const results = room.results();
  assert.equal(results.length, 3);
  assert.equal(results[0].id, "s1"); // 5 greens beats partials
  assert.equal(results[0].won, true);
  const departed = results.find((r) => r.id === "s2");
  assert.ok(departed.score > 0);
  assert.equal(departed.disconnected, true);
});

test("progressSnapshot exposes only counts and status — never letters or the solution", () => {
  const { room } = playingRoom("classic", "crane");
  room.getRound("s1").submitGuess("carte"); // c,e green; a,r present; t absent
  room.getRound("s2").burnRow();
  const snapshot = room.progressSnapshot();
  assert.equal(snapshot.length, 3);

  const s1 = snapshot.find((p) => p.id === "s1");
  assert.equal(s1.status, "submitted");
  assert.deepEqual(s1.rows, [{ g: 2, y: 2, x: 1 }]);

  const s2 = snapshot.find((p) => p.id === "s2");
  assert.deepEqual(s2.rows, ["burned"]);

  const s3 = snapshot.find((p) => p.id === "s3");
  assert.equal(s3.status, "typing");
  assert.deepEqual(s3.rows, []);

  const allowed = new Set(["id", "nickname", "status", "score", "row", "rows"]);
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes("crane"));
  assert.ok(!serialized.includes("carte"));
  for (const p of snapshot) {
    for (const key of Object.keys(p)) assert.ok(allowed.has(key), `unexpected key ${key}`);
  }
});

test("progressSnapshot includes the winner's final row and won status", () => {
  const { room } = playingRoom("classic", "crane");
  room.getRound("s1").submitGuess("crane");
  const s1 = room.progressSnapshot().find((p) => p.id === "s1");
  assert.equal(s1.status, "won");
  assert.deepEqual(s1.rows, [{ g: 5, y: 0, x: 0 }]);
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
