import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const waitingQueue: string[] = [];
const searchingSockets = new Set<string>();

type PendingMatch = {
  a: string;
  b: string;
  accepted: Set<string>;
};
const pendingMatches = new Map<string, PendingMatch>();


const app = express();
app.use(cors());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000"
  }
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("find_match", () => {
  if (searchingSockets.has(socket.id)) return;

  console.log("🔍 Find match:", socket.id);
  searchingSockets.add(socket.id);

  if (waitingQueue.length > 0) {
    const partnerId = waitingQueue.shift();

    if (
      partnerId &&
      partnerId !== socket.id &&
      io.sockets.sockets.get(partnerId)
    ) {
      const matchId = `${socket.id}:${partnerId}`;

      pendingMatches.set(matchId, {
        a: socket.id,
        b: partnerId,
        accepted: new Set()
      });

      console.log("📩 Match proposed:", matchId);

      io.to(socket.id).emit("match_proposed", { matchId });
      io.to(partnerId).emit("match_proposed", { matchId });

      return;
    }
  }

  waitingQueue.push(socket.id);
  console.log("⏳ Added to queue:", socket.id);
});

  socket.on("accept_match", ({ matchId }) => {
  const match = pendingMatches.get(matchId);
  if (!match) return;

  match.accepted.add(socket.id);
  console.log("✅ Accepted by:", socket.id);

  if (match.accepted.size === 2) {
    pendingMatches.delete(matchId);

    searchingSockets.delete(match.a);
    searchingSockets.delete(match.b);

    io.to(match.a).emit("match_confirmed", { partnerId: match.b });
    io.to(match.b).emit("match_confirmed", { partnerId: match.a });

    console.log("🤝 Match confirmed:", match.a, match.b);
  }
});

  socket.on("reject_match", ({ matchId }) => {
  const match = pendingMatches.get(matchId);
  if (!match) return;

  pendingMatches.delete(matchId);

  const otherUser =
    socket.id === match.a ? match.b : match.a;

  console.log("❌ Match rejected by:", socket.id);

  // Clean searching state
  searchingSockets.delete(match.a);
  searchingSockets.delete(match.b);

  // Notify both users
  io.to(match.a).emit("match_rejected");
  io.to(match.b).emit("match_rejected");

  // 🔥 IMPORTANT: requeue the OTHER user automatically
  if (io.sockets.sockets.get(otherUser)) {
    console.log("🔄 Re-queueing:", otherUser);
    waitingQueue.push(otherUser);
    searchingSockets.add(otherUser);
  }
});




  socket.on("cancel_search", () => {
  console.log("⏸ Search cancelled:", socket.id);

  searchingSockets.delete(socket.id);

  const idx = waitingQueue.indexOf(socket.id);
  if (idx !== -1) waitingQueue.splice(idx, 1);
});



  socket.on("disconnect", () => {
  console.log("🔴 Disconnected:", socket.id);

  searchingSockets.delete(socket.id);

  const idx = waitingQueue.indexOf(socket.id);
  if (idx !== -1) waitingQueue.splice(idx, 1);

  for (const [id, match] of pendingMatches) {
    if (match.a === socket.id || match.b === socket.id) {
      pendingMatches.delete(id);
      io.to(match.a).emit("match_rejected");
      io.to(match.b).emit("match_rejected");
    }
  }
});



});

httpServer.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});
