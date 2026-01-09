"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

type Status = "Idle" | "Searching" | "Confirming" | "Matched";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<Status>("Idle");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [partner, setPartner] = useState<string | null>(null);
  const [hasAccepted, setHasAccepted] = useState(false);

  useEffect(() => {
    const s = io("http://localhost:4000");

    s.on("connect", () => {
      console.log("🆔 Socket ID:", s.id);
    });

    // Step 1: backend proposes a match
    s.on("match_proposed", ({ matchId }) => {
      console.log("📩 Match proposed:", matchId);
      setMatchId(matchId);
      setStatus("Confirming");
    });

    // Step 2: both users accepted
    s.on("match_confirmed", ({ partnerId }) => {
      console.log("🤝 Match confirmed with:", partnerId);
      setPartner(partnerId);
      setStatus("Matched");
      setMatchId(null);
      setHasAccepted(false);

    });

    // If either user rejects
    s.on("match_rejected", () => {
      console.log("❌ Match rejected");
      setMatchId(null);
      setStatus("Searching");
      //s.emit("find_match");
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  /* ---------------- Actions ---------------- */

  const startSearch = () => {
    if (!socket) return;
    socket.emit("find_match");
    setStatus("Searching");
  };

  const cancelSearch = () => {
    if (!socket) return;
    socket.emit("cancel_search");
    setStatus("Idle");
    setMatchId(null);
  };

  const acceptMatch = () => {
  if (!socket || !matchId || hasAccepted) return;

  socket.emit("accept_match", { matchId });
  setHasAccepted(true);
};


  const rejectMatch = () => {
    if (!socket || !matchId) return;
    socket.emit("reject_match", { matchId });
    setStatus("Searching");
    setMatchId(null);
    socket.emit("find_match");
  };

  /* ---------------- UI ---------------- */

return (
  <main className="h-screen flex flex-col items-center justify-center gap-6 bg-black text-white">
    <h1 className="text-3xl font-bold">Hilao WebChat</h1>

    {status === "Idle" && <p>Status: Idle</p>}
    {status === "Searching" && <p>Status: Searching...</p>}
    {status === "Matched" && <p>Matched with {partner}</p>}

    {/* Start */}
    {status === "Idle" && (
      <button
        onClick={startSearch}
        className="px-6 py-3 rounded-lg bg-yellow-400 text-black font-semibold"
      >
        Start
      </button>
    )}

    {/* Pause */}
    {status === "Searching" && (
      <button
        onClick={cancelSearch}
        className="px-6 py-3 rounded-lg bg-gray-600 text-white font-semibold"
      >
        ⏸ Pause
      </button>
    )}

    {/* Accept / Reject */}
    {status === "Confirming" && (
      <div className="flex flex-col items-center gap-4 mt-4">
        <p className="text-sm text-gray-400">
          {hasAccepted
            ? "Waiting for user to accept…"
            : "Found someone! Accept?"}
        </p>

        <div className="flex gap-8">
          <button
            onClick={rejectMatch}
            disabled={hasAccepted}
            className={`w-16 h-16 rounded-full text-2xl transition
              ${
                hasAccepted
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-red-600 text-white hover:scale-105"
              }`}
          >
            ✕
          </button>

          <button
            onClick={acceptMatch}
            disabled={hasAccepted}
            className={`w-16 h-16 rounded-full text-2xl transition
              ${
                hasAccepted
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-yellow-400 text-black hover:scale-105"
              }`}
          >
            ✓
          </button>
        </div>
      </div>
    )}
  </main>
);

}
