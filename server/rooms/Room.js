import { Round, pickSolution } from "../game/round.js";
import { RoomSync } from "./RoomSync.js";
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
    this.sync = null; // RoomSync while a coded game is playing
    this.departed = []; // score snapshots of players who left mid-game
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
  // insertion order == join order) if the host left. A mid-game departure
  // keeps its score in `departed` so the final results still include it.
  removePlayer(socketId) {
    const round = this.rounds.get(socketId);
    if (this.status === "playing" && round) {
      const player = this.players.get(socketId);
      this.departed.push({
        id: socketId,
        nickname: player ? player.nickname : "?",
        won: round.won,
        guessesUsed: round.guesses.length,
        score: round.score,
        disconnected: true,
      });
    }
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

  // One solution for the whole room; each player gets their own Round on it,
  // all delegating to one shared RoomSync clock (coded rooms only).
  startGame() {
    if (this.status !== "waiting") return false;
    const solution = pickSolution(this.prevSolution);
    this.sync = this.isSolo ? null : new RoomSync(this.mode);
    this.departed = [];
    for (const id of this.players.keys()) {
      this.rounds.set(id, new Round(this.mode, null, solution, this.sync));
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

  // In synced classic, round.row > sync.rowIndex ⇔ this player already
  // submitted (or burned) the shared row — that comparison is the whole
  // gating state.
  canSubmit(socketId) {
    if (!this.sync || this.mode !== "classic") return null;
    const round = this.rounds.get(socketId);
    if (round && !round.gameOver && round.row > this.sync.rowIndex) return "row-locked";
    return null;
  }

  allSubmitted() {
    return this.rounds.size > 0 &&
      [...this.rounds.values()].every((r) => r.gameOver || r.row > this.sync.rowIndex);
  }

  // Closes the shared classic row: burns everyone who hasn't submitted it,
  // then advances the whole room. Returns the burns for personal emits.
  closeRow() {
    const burns = [];
    for (const [socketId, round] of this.rounds) {
      if (round.gameOver || round.row > this.sync.rowIndex) continue;
      burns.push({ socketId, result: round.burnRow() });
    }
    this.sync.advanceRow();
    return burns;
  }

  // Live per-player progress, safe to broadcast to the whole room: only
  // color counts per revealed row, never letters or the solution.
  progressSnapshot() {
    const progress = [];
    for (const [socketId, round] of this.rounds) {
      const player = this.players.get(socketId);
      const burned = new Set(round.burnedRows);
      const rows = [];
      let guessIdx = 0;
      // A winning guess doesn't advance round.row, so count revealed rows
      // directly: every guess or burn consumed exactly one row.
      const revealed = round.guesses.length + round.burnedRows.length;
      for (let r = 0; r < revealed; r++) {
        if (burned.has(r)) {
          rows.push("burned");
          continue;
        }
        const states = round.guesses[guessIdx++].states;
        rows.push({
          g: states.filter((s) => s === "correct").length,
          y: states.filter((s) => s === "present").length,
          x: states.filter((s) => s === "absent").length,
        });
      }
      let status = "typing";
      if (round.gameOver) status = round.won ? "won" : "lost";
      else if (this.canSubmit(socketId)) status = "submitted";
      progress.push({
        id: socketId,
        nickname: player ? player.nickname : "?",
        status,
        score: round.score,
        row: round.row,
        rows,
      });
    }
    for (const d of this.departed) {
      progress.push({
        id: d.id, nickname: d.nickname, status: "disconnected",
        score: d.score, row: 0, rows: [],
      });
    }
    return progress;
  }

  // Final standings for roomGameOver: everyone still in plus mid-game
  // departures, best score first.
  results() {
    const results = [...this.rounds].map(([socketId, round]) => {
      const player = this.players.get(socketId);
      return {
        id: socketId,
        nickname: player ? player.nickname : "?",
        won: round.won,
        guessesUsed: round.guesses.length,
        score: round.score,
      };
    });
    results.push(...this.departed);
    results.sort((a, b) => b.score - a.score);
    return results;
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
