import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { PORT } from "./config.js";
import { RoomManager } from "./rooms/RoomManager.js";
import { registerHandlers } from "./socket/handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const app = express();
app.use(express.static(publicDir));

const httpServer = createServer(app);
const io = new Server(httpServer);
const roomManager = new RoomManager();
registerHandlers(io, roomManager);

httpServer.listen(PORT, () => {
  console.log(`Wordle server listening on http://localhost:${PORT}`);
});
