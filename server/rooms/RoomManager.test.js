import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "./RoomManager.js";
import { Round } from "../game/round.js";
import { MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "../config.js";

test("generated codes use the unambiguous alphabet at the right length", () => {
  const rm = new RoomManager();
  for (let i = 0; i < 50; i++) {
    const code = rm.generateCode();
    assert.equal(code.length, ROOM_CODE_LENGTH);
    for (const ch of code) assert.ok(ROOM_CODE_ALPHABET.includes(ch), `bad char ${ch}`);
    for (const banned of "0O1I") assert.ok(!code.includes(banned));
  }
});

test("createRoom + joinRoom happy path", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Alice", "classic");
  assert.equal(room.status, "waiting");
  assert.equal(room.hostSocketId, "s1");
  const { room: joined } = rm.joinRoom("s2", room.code.toLowerCase(), "Bob");
  assert.equal(joined, room);
  assert.equal(room.players.size, 2);
  assert.equal(rm.getRoomForSocket("s2"), room);
});

test("join errors: not-found, full, in-progress, invalid nickname", () => {
  const rm = new RoomManager();
  assert.equal(rm.joinRoom("sX", "ZZZZZZ", "Bob").error, "room-not-found");

  const { room } = rm.createRoom("s1", "Host", "classic");
  for (let i = 2; i <= MAX_PLAYERS; i++) rm.joinRoom(`s${i}`, room.code, `P${i}`);
  assert.equal(room.players.size, MAX_PLAYERS);
  assert.equal(rm.joinRoom("sOver", room.code, "Late").error, "room-full");

  const { room: room2 } = rm.createRoom("t1", "Host2", "sudden");
  assert.equal(rm.joinRoom("t2", room2.code, "   ").error, "invalid-nickname");
  room2.startGame();
  assert.equal(rm.joinRoom("t3", room2.code, "Late").error, "game-in-progress");
});

test("nicknames are trimmed, capped, and suffixed on case-insensitive collision", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "  Sam  ", "classic");
  assert.equal(room.players.get("s1").nickname, "Sam");
  rm.joinRoom("s2", room.code, "sam");
  assert.equal(room.players.get("s2").nickname, "sam (2)");
  rm.joinRoom("s3", room.code, "SAM");
  assert.equal(room.players.get("s3").nickname, "SAM (3)");
  rm.joinRoom("s4", room.code, "x".repeat(50));
  assert.equal(room.players.get("s4").nickname.length, 20);
});

test("host migration goes to the oldest remaining player; empty room is dropped", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "A", "classic");
  rm.joinRoom("s2", room.code, "B");
  rm.joinRoom("s3", room.code, "C");
  const dep = rm.leaveCurrentRoom("s1");
  assert.equal(dep.hostChanged, true);
  assert.equal(room.hostSocketId, "s2");
  rm.leaveCurrentRoom("s2");
  const last = rm.leaveCurrentRoom("s3");
  assert.equal(last.empty, true);
  assert.equal(rm.roomsByCode.has(room.code), false);
});

test("startGame seeds every player's Round with the same solution", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "A", "classic");
  rm.joinRoom("s2", room.code, "B");
  rm.joinRoom("s3", room.code, "C");
  assert.equal(room.startGame(), true);
  assert.equal(room.status, "playing");
  const solutions = [...room.rounds.values()].map((r) => r.solution);
  assert.equal(new Set(solutions).size, 1);
  assert.equal(room.startGame(), false); // can't start twice
});

test("Round honors forcedSolution", () => {
  const r = new Round("classic", null, "crane");
  assert.equal(r.solution, "crane");
  const result = r.submitGuess("crane");
  assert.equal(result.won, true);
});

test("one-room-per-socket invariant across solo and coded rooms", () => {
  const rm = new RoomManager();
  rm.startSoloGame("s1", "classic");
  assert.equal(rm.getRoomForSocket("s1").isSolo, true);
  const { room } = rm.createRoom("s1", "A", "classic");
  assert.equal(rm.getRoomForSocket("s1"), room);
  const { room: other } = rm.createRoom("s9", "H", "classic");
  rm.joinRoom("s1", other.code, "A");
  assert.equal(rm.getRoomForSocket("s1"), other);
  assert.equal(rm.roomsByCode.has(room.code), false); // first coded room emptied out
  rm.startSoloGame("s1", "sudden");
  assert.equal(rm.getRoomForSocket("s1").isSolo, true);
  assert.equal(other.players.has("s1"), false);
});

test("sweep removes idle rooms from both indexes and spares active ones", () => {
  const rm = new RoomManager();
  const { room: idle } = rm.createRoom("s1", "A", "classic");
  rm.joinRoom("s2", idle.code, "B");
  const { room: active } = rm.createRoom("t1", "C", "classic");
  idle.lastActivityAt = Date.now() - 31 * 60 * 1000;
  const swept = rm.sweep();
  assert.equal(swept.length, 1);
  assert.equal(swept[0].code, idle.code);
  assert.deepEqual(swept[0].socketIds.sort(), ["s1", "s2"]);
  assert.equal(rm.roomsByCode.has(idle.code), false);
  assert.equal(rm.getRoomForSocket("s1"), null);
  assert.equal(rm.roomsByCode.get(active.code), active);
});
