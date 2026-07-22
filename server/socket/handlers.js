import { TICK_MS, ROOM_SWEEP_MS, MAX_PLAYERS } from "../config.js";

// Solo/multiplayer share one protocol ("solo is a room of size 1"):
// startSolo/beginGame -> roundStarted, submitGuess -> guessResult,
// tick -> timeLeft. Solo keeps personal gameOver/rowBurned timing; coded
// rooms run on one shared RoomSync clock instead — rows close for the
// whole room (roomAdvance), opponents' color counts stream via
// progressState, and the answer is only ever revealed in the simultaneous
// roomGameOver, never in a terminal guessResult.
export function registerHandlers(io, roomManager) {
  // Coded rooms never reveal the answer mid-game: an early loser could
  // feed it to still-playing friends over voice chat.
  function stripAnswer(result) {
    const { answer, ...rest } = result;
    return rest;
  }

  function endRoom(room) {
    room.status = "finished";
    io.to(room.code).emit("roomGameOver", {
      answer: room.prevSolution,
      results: room.results(),
    });
  }

  // Closes the current synced classic row (early because everyone
  // submitted, or because the shared deadline hit) and moves the room on.
  function closeRowAndBroadcast(room) {
    for (const { socketId, result } of room.closeRow()) {
      io.to(socketId).emit("rowBurned", stripAnswer(result));
    }
    if (room.allFinished()) {
      endRoom(room);
      return;
    }
    io.to(room.code).emit("roomAdvance", {
      row: room.sync.rowIndex,
      timeLeft: room.sync.timeLeft(),
      progress: room.progressSnapshot(),
    });
  }

  // A player leaving a mid-game coded room may have been the one holding
  // up the row close or the game end — re-check both, or a dropped
  // laggard blocks the room forever.
  function afterRoomMutation(room) {
    if (room.status !== "playing") return;
    if (room.allFinished()) {
      endRoom(room);
      return;
    }
    if (room.mode === "classic" && room.allSubmitted()) {
      closeRowAndBroadcast(room);
      return;
    }
    io.to(room.code).emit("progressState", { progress: room.progressSnapshot() });
  }

  // Starts a coded room's game: one solution and one shared clock for
  // everyone. Used by both host startGame and the 7th-join auto-start.
  function beginGame(room) {
    if (!room.startGame()) return false;
    io.to(room.code).emit("roundStarted", {
      mode: room.mode,
      row: 0,
      timeLeft: room.sync.timeLeft(),
      code: room.code,
      progress: room.progressSnapshot(),
    });
    return true;
  }

  // Broadcasts to a coded room the departing socket just left, if it
  // lives on, then re-checks its synced-game state.
  function broadcastDeparture(departure) {
    if (departure && departure.wasCoded && !departure.empty) {
      io.to(departure.room.code).emit("roomState", { roomState: departure.room.serialize() });
      afterRoomMutation(departure.room);
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

      if (room.isSolo) {
        const result = round.submitGuess(payload.guess);
        if (result.error) {
          socket.emit("guessError", { error: result.error });
          return;
        }
        socket.emit("guessResult", result);
        if (result.gameOver) socket.emit("gameOver", result);
        return;
      }

      const locked = room.canSubmit(socket.id);
      if (locked) {
        socket.emit("guessError", { error: locked });
        return;
      }
      const result = round.submitGuess(payload.guess);
      if (result.error) {
        socket.emit("guessError", { error: result.error });
        return;
      }
      socket.emit("guessResult", result.gameOver ? stripAnswer(result) : result);
      if (room.allFinished()) {
        endRoom(room);
      } else if (room.mode === "classic" && room.allSubmitted()) {
        closeRowAndBroadcast(room);
      } else {
        io.to(room.code).emit("progressState", { progress: room.progressSnapshot() });
      }
    });

    socket.on("disconnect", () => {
      broadcastDeparture(roomManager.leaveCurrentRoom(socket.id));
    });
  });

  // Server-authoritative tick: advances/ends rounds on timeout and pushes
  // timeLeft to clients, independent of anything the client reports.
  setInterval(() => {
    // Solo rounds own their deadlines; roomsBySocket has one entry per
    // member socket, so this visits each solo round exactly once.
    for (const [socketId, room] of roomManager.roomsBySocket) {
      if (!room.isSolo) continue;
      const round = room.rounds.get(socketId);
      if (!round || round.gameOver) continue;
      const timeoutResult = round.checkTimeout();
      if (timeoutResult) {
        if (timeoutResult.gameOver) {
          io.to(socketId).emit("gameOver", timeoutResult);
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

    // Coded rooms run on one shared clock — exactly one pass per room.
    for (const room of roomManager.roomsByCode.values()) {
      if (room.status !== "playing") continue;
      if (room.sync.timeLeft() > 0) {
        io.to(room.code).emit("tick", {
          timeLeft: room.sync.timeLeft(),
          mult: room.sync.multiplier(),
        });
        continue;
      }
      if (room.mode === "classic") {
        closeRowAndBroadcast(room);
      } else {
        for (const round of room.rounds.values()) {
          if (!round.gameOver) round.expire();
        }
        endRoom(room);
      }
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
