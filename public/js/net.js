// Thin Socket.IO client wrapper — the only module that talks to the server.
// The server is the sole source of truth for the solution and scoring;
// nothing here ever holds or computes an answer.
export class Net {
  constructor() {
    this.socket = io();
  }

  get id() {
    return this.socket.id;
  }

  startSolo(mode) {
    this.socket.emit("startSolo", { mode });
  }

  submitGuess(guess) {
    this.socket.emit("submitGuess", { guess });
  }

  createRoom(nickname, mode) {
    this.socket.emit("createRoom", { nickname, mode });
  }

  joinRoom(code, nickname) {
    this.socket.emit("joinRoom", { code, nickname });
  }

  startGame() {
    this.socket.emit("startGame");
  }

  leaveRoom() {
    this.socket.emit("leaveRoom");
  }

  on(event, handler) {
    this.socket.on(event, handler);
  }
}
