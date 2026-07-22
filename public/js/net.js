// Thin Socket.IO client wrapper — the only module that talks to the server.
// The server is the sole source of truth for the solution and scoring;
// nothing here ever holds or computes an answer.
export class Net {
  constructor() {
    this.socket = io();
  }

  startSolo(mode) {
    this.socket.emit("startSolo", { mode });
  }

  submitGuess(guess) {
    this.socket.emit("submitGuess", { guess });
  }

  on(event, handler) {
    this.socket.on(event, handler);
  }
}
