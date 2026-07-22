const COLS = 5;

export function scoreGuess(guess, solution) {
  const result = new Array(COLS).fill("absent");
  const counts = {};
  for (const ch of solution) counts[ch] = (counts[ch] || 0) + 1;
  for (let i = 0; i < COLS; i++)
    if (guess[i] === solution[i]) { result[i] = "correct"; counts[guess[i]]--; }
  for (let i = 0; i < COLS; i++) {
    if (result[i] === "correct") continue;
    const ch = guess[i];
    if (counts[ch] > 0) { result[i] = "present"; counts[ch]--; }
  }
  return result;
}
