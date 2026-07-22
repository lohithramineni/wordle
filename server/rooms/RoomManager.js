import { Room } from "./Room.js";
import { Round } from "../game/round.js";

// In-memory room registry. Phase 1 only exercises startSoloGame(); the
// code-based create/join path is unused until Phase 2 but kept here since
// solo rooms already live in the same map/shape multiplayer rooms will use.
export class RoomManager {
  constructor() {
    this.roomsBySocket = new Map(); // socketId -> Room, solo rooms only for now
  }

  // Creates the socket's solo room on first call, reuses it (with a fresh
  // Round, avoiding an immediate solution repeat) on every subsequent call.
  startSoloGame(socketId, mode) {
    let room = this.roomsBySocket.get(socketId);
    if (!room) {
      room = new Room(`solo-${socketId}`, socketId);
      room.players.set(socketId, { socketId, nickname: "Player" });
      this.roomsBySocket.set(socketId, room);
    }
    room.round = new Round(mode, room.prevSolution);
    room.prevSolution = room.round.solution;
    room.status = "playing";
    room.touch();
    return room;
  }

  getRoomForSocket(socketId) {
    return this.roomsBySocket.get(socketId) || null;
  }

  removeSocket(socketId) {
    this.roomsBySocket.delete(socketId);
  }
}
