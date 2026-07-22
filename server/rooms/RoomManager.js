import { customAlphabet } from "nanoid";
import { Room } from "./Room.js";
import { Round } from "../game/round.js";
import {
  MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_TTL_MS,
} from "../config.js";

const nanoidCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

// In-memory room registry. roomsBySocket is the single source of truth for
// "which room is this socket in" (at most one entry per socket, solo or
// coded); roomsByCode is a secondary index for coded rooms only.
export class RoomManager {
  constructor() {
    this.roomsBySocket = new Map(); // socketId -> Room
    this.roomsByCode = new Map();   // CODE -> Room (coded rooms only)
  }

  generateCode() {
    let code;
    do { code = nanoidCode(); } while (this.roomsByCode.has(code));
    return code;
  }

  createRoom(socketId, rawNickname, mode) {
    if (mode !== "classic" && mode !== "sudden") return { error: "invalid-mode" };
    const room = new Room(this.generateCode(), socketId, mode);
    const nickname = room.uniqueNickname(rawNickname);
    if (!nickname) return { error: "invalid-nickname" };
    const departure = this.leaveCurrentRoom(socketId);
    room.addPlayer(socketId, nickname);
    this.roomsBySocket.set(socketId, room);
    this.roomsByCode.set(room.code, room);
    return { room, departure };
  }

  joinRoom(socketId, rawCode, rawNickname) {
    const code = String(rawCode || "").trim().toUpperCase();
    const room = this.roomsByCode.get(code);
    if (!room) return { error: "room-not-found" };
    if (room.status !== "waiting") return { error: "game-in-progress" };
    if (room.players.size >= MAX_PLAYERS) return { error: "room-full" };
    const nickname = room.uniqueNickname(rawNickname);
    if (!nickname) return { error: "invalid-nickname" };
    const departure = this.leaveCurrentRoom(socketId);
    room.addPlayer(socketId, nickname);
    this.roomsBySocket.set(socketId, room);
    return { room, departure };
  }

  // Creates the socket's solo room on first call, reuses it (with a fresh
  // Round, avoiding an immediate solution repeat) on every subsequent call.
  startSoloGame(socketId, mode) {
    let room = this.roomsBySocket.get(socketId);
    let departure = null;
    if (room && !room.isSolo) {
      departure = this.leaveCurrentRoom(socketId);
      room = null;
    }
    if (!room) {
      room = new Room(`solo-${socketId}`, socketId, mode, true);
      room.addPlayer(socketId, "Player");
      this.roomsBySocket.set(socketId, room);
    }
    room.mode = mode;
    room.rounds.set(socketId, new Round(mode, room.prevSolution));
    room.prevSolution = room.rounds.get(socketId).solution;
    room.status = "playing";
    room.touch();
    return { room, departure };
  }

  getRoomForSocket(socketId) {
    return this.roomsBySocket.get(socketId) || null;
  }

  // Removes the socket from whatever room it is in. Returns departure info
  // so the handler layer can broadcast to an abandoned coded room, or null
  // if the socket was not in any room.
  leaveCurrentRoom(socketId) {
    const room = this.roomsBySocket.get(socketId);
    if (!room) return null;
    this.roomsBySocket.delete(socketId);
    if (room.isSolo) return { room, wasCoded: false, hostChanged: false, empty: true };
    const { hostChanged, empty } = room.removePlayer(socketId);
    if (empty) this.roomsByCode.delete(room.code);
    return { room, wasCoded: true, hostChanged, empty };
  }

  removeSocket(socketId) {
    return this.leaveCurrentRoom(socketId);
  }

  // Sweeps rooms idle past the TTL. Returns swept coded rooms (code +
  // member ids) so handlers can notify and detach their sockets.
  sweep(now = Date.now()) {
    const swept = [];
    for (const [code, room] of this.roomsByCode) {
      if (now - room.lastActivityAt <= ROOM_TTL_MS) continue;
      const socketIds = [...room.players.keys()];
      for (const id of socketIds) this.roomsBySocket.delete(id);
      this.roomsByCode.delete(code);
      swept.push({ code, socketIds });
    }
    for (const [socketId, room] of this.roomsBySocket) {
      if (room.isSolo && now - room.lastActivityAt > ROOM_TTL_MS) {
        this.roomsBySocket.delete(socketId);
      }
    }
    return swept;
  }
}
