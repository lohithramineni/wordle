// A room holds players and the current round. Phase 1 only ever creates
// solo (size-1) rooms; Phase 2 adds real multi-join via RoomManager.createRoom().
export class Room {
  constructor(code, hostSocketId) {
    this.code = code;
    this.hostSocketId = hostSocketId;
    this.players = new Map(); // socketId -> { nickname, socketId }
    this.status = "playing"; // "waiting" | "playing" | "finished" (Phase 2 introduces "waiting")
    this.round = null;
    this.prevSolution = null;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
  }

  touch() {
    this.lastActivityAt = Date.now();
  }
}
