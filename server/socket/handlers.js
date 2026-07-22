import { TICK_MS, ROOM_SWEEP_MS, MAX_PLAYERS } from "../config.js";

// Solo/multiplayer share one protocol ("solo is a room of size 1"):
// startSolo/beginGame -> roundStarted, submitGuess -> guessResult,
// tick -> timeLeft, gameOver includes the answer only once the player's
// round has actually ended. Coded rooms add the lobby events below.
export function registerHandlers(io, roomManager) {
  // Starts a coded room's game: one solution for everyone, each player gets
  // their own Round. Used by both host startGame and the 7th-join auto-start.
  function beginGame(room) {
    if (!room.startGame()) return false;
    const round = room.rounds.values().next().value;
    io.to(room.code).emit("roundStarted", {
      mode: room.mode,
      row: 0,
      timeLeft: round.timeLeft(),
      code: room.code,
    });
    return true;
  }

  // Broadcasts to a coded room the departing socket just left, if it lives on.
  function broadcastDeparture(departure) {
    if (departure && departure.wasCoded && !departure.empty) {
      io.to(departure.room.code).emit("roomState", { roomState: departure.room.serialize() });
    }
  }

  io.on("connection", (socket) => {
    socket.on("startSolo", (payload = {}) => {
      const mode = payload.mode === "sudden" ? "sudden" : "classic";
      const { room, departure } = roomManager.startSoloGame(socket.id, mode);
      if (departure && departure.wasCoded) socket.leave(departure.room.code);
      broadcastDeparture(departure);
      const round = room.getRound(socket.id);
      socket.emit("roundStarted", {
        mode,
        row: round.row,
        timeLeft: round.timeLeft(),
      });
    });

    socket.on("createRoom", (payload = {}) => {
      const result = roomManager.createRoom(socket.id, payload.nickname, payload.mode);
      if (result.error) {
        socket.emit("roomError", { error: result.error });
        return;
      }
      if (result.departure && result.departure.wasCoded) socket.leave(result.departure.room.code);
      broadcastDeparture(result.departure);
      socket.join(result.room.code);
      socket.emit("roomCreated", { roomState: result.room.serialize() });
    });

    socket.on("joinRoom", (payload = {}) => {
      const result = roomManager.joinRoom(socket.id, payload.code, payload.nickname);
      if (result.error) {
        socket.emit("joinError", { error: result.error });
        return;
      }
      if (result.departure && result.departure.wasCoded) socket.leave(result.departure.room.code);
      broadcastDeparture(result.departure);
      const room = result.room;
      socket.join(room.code);
      socket.emit("joinedRoom", { roomState: room.serialize() });
      socket.to(room.code).emit("roomState", { roomState: room.serialize() });
      if (room.players.size >= MAX_PLAYERS) beginGame(room);
    });

    socket.on("startGame", () => {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room || room.isSolo) {
        socket.emit("roomError", { error: "not-in-room" });
        return;
      }
      if (socket.id !== room.hostSocketId) {
        socket.emit("roomError", { error: "not-host" });
        return;
      }
      if (room.status !== "waiting") {
        socket.emit("roomError", { error: "already-started" });
        return;
      }
      beginGame(room);
    });

    socket.on("leaveRoom", () => {
      const departure = roomManager.leaveCurrentRoom(socket.id);
      if (departure && departure.wasCoded) socket.leave(departure.room.code);
      broadcastDeparture(departure);
      socket.emit("leftRoom", {});
    });

    socket.on("submitGuess", (payload = {}) => {
      const room = roomManager.getRoomForSocket(socket.id);
      const round = room ? room.getRound(socket.id) : null;
      if (!round) {
        socket.emit("guessError", { error: "no-active-round" });
        return;
      }
      room.touch();
      const result = round.submitGuess(payload.guess);
      if (result.error) {
        socket.emit("guessError", { error: result.error });
        return;
      }
      socket.emit("guessResult", result);
      if (result.gameOver) {
        socket.emit("gameOver", result);
        if (!room.isSolo && room.allFinished()) room.status = "finished";
      }
    });

    socket.on("disconnect", () => {
      broadcastDeparture(roomManager.leaveCurrentRoom(socket.id));
    });
  });

  // Server-authoritative tick: advances/ends rounds on timeout and pushes
  // timeLeft to clients, independent of anything the client reports.
  // roomsBySocket has one entry per member socket, so this visits each
  // player's round exactly once.
  setInterval(() => {
    for (const [socketId, room] of roomManager.roomsBySocket) {
      const round = room.rounds.get(socketId);
      if (!round || round.gameOver) continue;
      const timeoutResult = round.checkTimeout();
      if (timeoutResult) {
        if (timeoutResult.gameOver) {
          io.to(socketId).emit("gameOver", timeoutResult);
          if (!room.isSolo && room.allFinished()) room.status = "finished";
        } else {
          io.to(socketId).emit("rowBurned", timeoutResult);
        }
        continue;
      }
      io.to(socketId).emit("tick", {
        timeLeft: round.timeLeft(),
        mult: round.multiplier(),
      });
    }
  }, TICK_MS);

  // Idle-room GC on its own slower interval.
  setInterval(() => {
    for (const { code, socketIds } of roomManager.sweep(Date.now())) {
      io.to(code).emit("roomClosed", { reason: "inactive" });
      for (const id of socketIds) io.sockets.sockets.get(id)?.leave(code);
    }
  }, ROOM_SWEEP_MS);
}
