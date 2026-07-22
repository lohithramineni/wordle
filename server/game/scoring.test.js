import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreGuess } from "./scoring.js";

test("exact match", () => {
  assert.deepEqual(scoreGuess("abide", "abide"), ["correct", "correct", "correct", "correct", "correct"]);
});

test("no overlap", () => {
  assert.deepEqual(scoreGuess("might", "close"), ["absent", "absent", "absent", "absent", "absent"]);
});

test("letter repeated in guess, once in solution", () => {
  // "pleat" has one 'l' (pos 1) and one 't' (pos 4); guess "allot" has two 'l's and two 't's
  assert.deepEqual(scoreGuess("allot", "pleat"), ["present", "correct", "absent", "absent", "correct"]);
});

test("letter repeated in solution, once in guess", () => {
  // "speed" has two 'e's; guess "abide" has one 'e' (pos 3, wrong spot) and one 'd' (pos 4, wrong spot)
  assert.deepEqual(scoreGuess("abide", "speed"), ["absent", "absent", "absent", "present", "present"]);
});

test("correct match consumes solution letter count before present pass runs", () => {
  // "erase" has two 'e's, both consumed by guess "eerie"'s correct matches at pos0/pos4,
  // so the leftover 'e' at pos1 has none left to claim and is absent, not present
  assert.deepEqual(scoreGuess("eerie", "erase"), ["correct", "absent", "present", "absent", "correct"]);
});
