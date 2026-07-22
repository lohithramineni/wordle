import { Round, pickSolution } from "../game/round.js";
import { MAX_PLAYERS, NICKNAME_MAX } from "../config.js";

// A room holds players and one Round per player. A solo game is a room of
// size 1 (isSolo) whose single Round lives under the player's own socketId;
// a coded room seeds every player's Round with the SAME solution so the
// whole lobby races on one word.
export class Room {
  constructor(code, hostSocketId, mode, isSolo = false) {
    this.code = code;
    this.hostSocketId = hostSocketId;
    this.mode = mode; // "classic" | "sudden"
    this.isSolo = isSolo;
    this.players = new Map(); // socketId -> { id, nickname }
    this.status = isSolo ? "playing" : "waiting"; // "waiting" | "playing" | "finished"
    this.rounds = new Map(); // socketId -> Round
    this.prevSolution = null;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
  }

  touch() {
    this.lastActivityAt = Date.now();
  }

  // Trim, cap, and de-duplicate (case-insensitive) against current players.
  uniqueNickname(raw) {
    const base = String(raw || "").trim().slice(0, NICKNAME_MAX);
    if (!base) return null;
    const taken = new Set(
      [...this.players.values()].map((p) => p.nickname.toLowerCase())
    );
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  addPlayer(socketId, nickname) {
    this.players.set(socketId, { id: socketId, nickname });
    this.touch();
  }

  // Removes a player; migrates host to the oldest remaining player (Map
  // insertion order == join order) if the host left.
  removePlayer(socketId) {
    this.players.delete(socketId);
    this.rounds.delete(socketId);
    let hostChanged = false;
    if (socketId === this.hostSocketId && this.players.size > 0) {
      this.hostSocketId = this.players.keys().next().value;
      hostChanged = true;
    }
    this.touch();
    return { hostChanged, empty: this.players.size === 0 };
  }

  // One solution for the whole room; each player gets their own Round on it.
  startGame() {
    if (this.status !== "waiting") return false;
    const solution = pickSolution(this.prevSolution);
    for (const id of this.players.keys()) {
      this.rounds.set(id, new Round(this.mode, null, solution));
    }
    this.prevSolution = solution;
    this.status = "playing";
    this.touch();
    return true;
  }

  getRound(socketId) {
    return this.rounds.get(socketId) || null;
  }

  allFinished() {
    return this.rounds.size > 0 &&
      [...this.rounds.values()].every((r) => r.gameOver);
  }

  // Canonical roomState payload — never exposes solutions or round internals.
  serialize() {
    return {
      code: this.code,
      mode: this.mode,
      status: this.status,
      maxPlayers: MAX_PLAYERS,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        isHost: p.id === this.hostSocketId,
      })),
    };
  }
}
