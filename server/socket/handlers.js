import { TICK_MS } from "../config.js";

// Solo/multiplayer share one protocol (Section: "solo is a room of size 1"):
// startSolo -> roundStarted, submitGuess -> guessResult, tick -> timeLeft,
// gameOver includes the answer only once the round has actually ended.
export function registerHandlers(io, roomManager) {
  io.on("connection", (socket) => {
    socket.on("startSolo", (payload = {}) => {
      const mode = payload.mode === "sudden" ? "sudden" : "classic";
      const room = roomManager.startSoloGame(socket.id, mode);
      socket.emit("roundStarted", {
        mode,
        row: room.round.row,
        timeLeft: room.round.timeLeft(),
      });
    });

    socket.on("submitGuess", (payload = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || !room.round) {
        socket.emit("guessError", { error: "no-active-round" });
        return;
      }
      room.touch();
      const result = room.round.submitGuess(payload.guess);
      if (result.error) {
        socket.emit("guessError", { error: result.error });
        return;
      }
      socket.emit("guessResult", result);
      if (result.gameOver) socket.emit("gameOver", result);
    });

    socket.on("disconnect", () => {
      roomManager.removeSocket(socket.id);
    });
  });

  // Server-authoritative tick: advances/ends rounds on timeout and pushes
  // timeLeft to clients, independent of anything the client reports.
  setInterval(() => {
    for (const [socketId, room] of roomManager.roomsBySocket) {
      if (!room.round || room.round.gameOver) continue;
      const timeoutResult = room.round.checkTimeout();
      if (timeoutResult) {
        if (timeoutResult.gameOver) {
          io.to(socketId).emit("gameOver", timeoutResult);
        } else {
          io.to(socketId).emit("rowBurned", timeoutResult);
        }
        continue;
      }
      io.to(socketId).emit("tick", {
        timeLeft: room.round.timeLeft(),
        mult: room.round.multiplier(),
      });
    }
  }, TICK_MS);
}
