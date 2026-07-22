export const WRONG_TAUNTS = [
  "Bold strategy. Completely wrong, but bold.",
  "The word is embarrassed to be associated with that guess.",
  "A trained pigeon would've done better.",
  "Are you solving it or just assaulting the keyboard?",
  "That was genuinely painful to watch.",
  "My disappointment is immeasurable, and your guess is done.",
  "Even autocomplete gave up on you.",
  "Somewhere, a dictionary just filed a restraining order.",
  "Confidence: high. Accuracy: tragic.",
  "You're not bad at this. You're historically bad.",
  "That guess set the English language back a decade.",
  "Wrong. Spectacularly, memorably wrong.",
  "I've seen toddlers with better vocabulary.",
  "Was that a guess or a cry for help?",
  "Swing and a miss. Again. Shocking.",
  "The letters are actively avoiding you now."
];
export const IDLE_TAUNTS = [
  "Tick tock. The word isn't getting easier.",
  "Still thinking? It's five letters, not rocket science.",
  "I've watched glaciers move faster than this.",
  "Any day now, champ.",
  "Loading… your brain, apparently.",
  "The clock is laughing at you.",
  "Take your time. Oh wait, you can't.",
  "This hesitation is genuinely hard to watch.",
  "Five letters. Five. You've got this. Probably not.",
  "The timer would like a word. Preferably before it runs out."
];
export const pick = (arr, avoid) => {
  let x;
  do { x = arr[(Math.random() * arr.length) | 0]; }
  while (x === avoid && arr.length > 1);
  return x;
};
