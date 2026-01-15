"use client";

import { Camera, ChevronLeft } from "lucide-react";
import { SlidersHorizontal, User } from "lucide-react"
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

/* ---------------- Types ---------------- */

type Status = "Idle" | "Searching" | "Confirming" | "Matched";
type MediaState = "idle" | "requesting" | "preview" | "denied";

/* ---------------- RemoteVideo Component ---------------- */
// Separate component to properly handle video element lifecycle
function RemoteVideo({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<string>("waiting");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      setStatus("waiting");
      return;
    }

    console.log("🎬 RemoteVideo: Got stream, setting up video");
    video.srcObject = stream;
    setStatus("connecting");

    let intervalId: NodeJS.Timeout | null = null;

    // Monitor video state with interval (will stop once playing)
    intervalId = setInterval(() => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const readyState = video.readyState;

      // readyState >= 2 and dimensions > 0 means video is ready
      if (readyState >= 2 && w > 0 && h > 0) {
        console.log(`✅ Video playing: ${w}x${h}`);
        setStatus("playing");

        if (video.paused) {
          video.play().catch(() => { });
        }

        // Stop the interval once video is confirmed playing
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    }, 500);

    // Also listen for actual playing event
    const onPlaying = () => {
      console.log("🎉 Video 'playing' event!");
      setStatus("playing");
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    video.addEventListener('playing', onPlaying);
    video.play().catch(() => { });

    return () => {
      if (intervalId) clearInterval(intervalId);
      video.removeEventListener('playing', onPlaying);
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="w-1/2 h-full relative">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full rounded-xl object-cover bg-gray-900"
      />
      {status !== "playing" && (
        <div className="absolute inset-0 rounded-xl bg-gray-900/90 flex items-center justify-center">
          <span className="text-white/50">
            {status === "waiting" ? "Waiting for video..." : "Connecting..."}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------------- Component ---------------- */

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mySocketIdRef = useRef<string | null>(null);

  const pendingIceCandidates = useRef<RTCIceCandidate[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Ref to accumulate remote tracks (initialized lazily to avoid SSR error)
  const remoteStreamRef = useRef<MediaStream | null>(null);

  // Use STATE for remote stream so React re-renders when it changes
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);


  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  const [photo, setPhoto] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mediaGranted, setMediaGranted] = useState(false);
  const [showDeniedDialog, setShowDeniedDialog] = useState(true);

  /* ---------- Media (REQUIRED FIRST) ---------- */
  const [mediaState, setMediaState] = useState<MediaState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);

  const [isEditingPhoto, setIsEditingPhoto] = useState(false);


  /* ---------- Socket / Matchmaking ---------- */
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<Status>("Idle");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [partner, setPartner] = useState<string | null>(null);
  const [hasAccepted, setHasAccepted] = useState(false);

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (width === 0 || height === 0) {
      console.warn("Video not ready yet");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setPhoto(dataUrl);

    setIsEditingPhoto(false);

  };
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // 🎥 REMOTE TRACK - accumulate tracks into our own MediaStream
    pc.ontrack = (event) => {
      console.log("🎥 ontrack:", event.track.kind);

      // Lazily create the MediaStream (avoids SSR error)
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }

      remoteStreamRef.current.addTrack(event.track);
      setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()));
    };

    // 🧊 ICE CANDIDATES (SEND)
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      const currentPartner = partnerRef.current;
      if (!currentPartner) {
        pendingIceCandidates.current.push(event.candidate);
        return;
      }

      socketRef.current?.emit("webrtc-ice", {
        to: currentPartner,
        candidate: event.candidate,
      });
    };

    // 📡 CONNECTION STATE MONITORING (keep for debugging)
    pc.oniceconnectionstatechange = () => {
      console.log("🧊 ICE state:", pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log("📡 Connection:", pc.connectionState);
    };

    peerRef.current = pc;
    return pc;
  };


  /*
  useEffect(() => {
    if (!stream) return;
   
    const pc = peerRef.current ?? createPeerConnection();
   
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
  }, [stream]);
  */

  useEffect(() => {
    console.log("Peer connection:", peerRef.current);
  }, [peerRef.current]);


  /* ---------------- Media Logic ---------------- */
  /*
    const requestMedia = async () => {
      
      setMediaState("requesting");
      if (videoRef.current) {
    videoRef.current.srcObject = stream;
   
    videoRef.current.onloadedmetadata = () => {
      videoRef.current?.play();
    };
  }
   
   
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
   
        setStream(s);
        setMediaState("preview");
      } catch (err) {
        console.error("❌ Media permission denied", err);
        setMediaState("denied");
      }
    };
   
    useEffect(() => {
    requestMedia();
  }, []);
  */

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [status, stream]);

  // Apply remote stream when video element AND stream are both available
  useEffect(() => {
    const videoEl = remoteVideoRef.current;
    if (!videoEl || !remoteStream) return;

    console.log("📺 Applying remote stream to video element");
    console.log("📺 Stream ID:", remoteStream.id);
    console.log("📺 Stream active:", remoteStream.active);
    console.log("📺 Video tracks:", remoteStream.getVideoTracks());
    console.log("📺 Audio tracks:", remoteStream.getAudioTracks());

    // Check if video tracks are live
    const videoTracks = remoteStream.getVideoTracks();
    if (videoTracks.length > 0) {
      console.log("📺 Video track enabled:", videoTracks[0].enabled);
      console.log("📺 Video track readyState:", videoTracks[0].readyState);
    }

    videoEl.srcObject = remoteStream;

    // Force play after a short delay
    setTimeout(() => {
      videoEl.play()
        .then(() => console.log("✅ Video playing!"))
        .catch((e) => console.error("❌ Play failed:", e));
    }, 100);

  }, [remoteStream, status]);

  // 1. Define the function inside your component body
  const requestMedia = async () => {
    setMediaState("requesting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        },
        audio: true,
      });

      setStream(s);
      streamRef.current = s; // Keep ref in sync
      setMediaState("preview");
      setMediaGranted(true);

      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(console.error);
        };
      }
    } catch (err) {
      console.error("❌ Media permission denied", err);
      setMediaState("denied");
      setMediaGranted(false);
    }
  };

  // 2. Use the useEffect to trigger it automatically on mount
  useEffect(() => {
    requestMedia();
  }, []);
  /*
  useEffect(() => {
  const startCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
       video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
    facingMode: "user"
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
    });
  
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.setAttribute("playsinline", "true");
  
      videoRef.current.onloadedmetadata = () => {
    videoRef.current?.play();
  };
    }
    setMediaGranted(true);
  
  };
  
  startCamera();
  }, []);
  */

  /* ---------------- Socket Logic ---------------- */

  // Use ref to avoid stale closure issues with partner
  const partnerRef = useRef<string | null>(null);

  useEffect(() => {
    if (mediaState !== "preview") return;

    const s = io("http://localhost:4000");
    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => {
      mySocketIdRef.current = s.id!;
      console.log("🆔 Socket ID:", s.id);
    });

    // Backend proposes a match
    s.on("match_proposed", ({ matchId }) => {
      console.log("📩 Match proposed:", matchId);
      setMatchId(matchId);
      setStatus("Confirming");
      setHasAccepted(false);
    });

    // Both users accepted - START WEBRTC
    s.on("match_confirmed", async ({ partnerId }) => {
      console.log("🤝 Match confirmed with:", partnerId);

      // Set partner in both state and ref (ref avoids stale closure)
      setPartner(partnerId);
      partnerRef.current = partnerId;
      setStatus("Matched");

      // Clean up any existing peer connection
      if (peerRef.current) {
        console.log("🧹 Cleaning up existing peer connection");
        peerRef.current.close();
        peerRef.current = null;
      }

      // Determine who is the OFFERER (the one with smaller socket ID)
      const isOfferer = mySocketIdRef.current! < partnerId;
      console.log("📋 I am the:", isOfferer ? "OFFERER" : "ANSWERER");

      if (isOfferer) {
        // OFFERER: Create peer connection, add tracks, create and send offer
        const pc = createPeerConnection();

        const currentStream = streamRef.current;
        if (currentStream) {
          console.log("🎤 Adding local tracks to PC");
          currentStream.getTracks().forEach((track) => {
            pc.addTrack(track, currentStream);
          });
        } else {
          console.error("❌ No stream available!");
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log("📤 Sending offer to:", partnerId);

        s.emit("webrtc-offer", { to: partnerId, offer });
      }
      // ANSWERER: Wait for offer - will create PC in webrtc-offer handler
    });

    // Receive offer (ANSWERER receives this)
    s.on("webrtc-offer", async ({ from, offer }) => {
      console.log("📥 Received offer from:", from);

      // Clean up any existing peer connection
      if (peerRef.current) {
        console.log("🧹 Cleaning up existing peer connection (answerer)");
        peerRef.current.close();
        peerRef.current = null;
      }

      // ANSWERER: Create peer connection now
      const pc = createPeerConnection();

      // Store partner if not already set
      if (!partnerRef.current) {
        setPartner(from);
        partnerRef.current = from;
      }

      // Add local tracks BEFORE setting remote description
      const currentStream = streamRef.current;
      if (currentStream) {
        console.log("🎤 Adding local tracks (answerer)");
        currentStream.getTracks().forEach((track) => {
          pc.addTrack(track, currentStream);
        });
      } else {
        console.error("❌ No stream available for answerer!");
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log("✅ Remote description set (offer)");

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log("📤 Sending answer to:", from);

      s.emit("webrtc-answer", { to: from, answer });
    });

    // Receive answer (OFFERER receives this)
    s.on("webrtc-answer", async ({ from, answer }) => {
      console.log("📥 Received answer from:", from);

      const pc = peerRef.current;
      if (!pc) {
        console.error("❌ No peer connection when receiving answer!");
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log("✅ Remote description set (answer)");
    });

    // 🧊 RECEIVE ICE
    s.on("webrtc-ice", async ({ from, candidate }) => {
      console.log("🧊 ICE received from:", from);

      const pc = peerRef.current;
      if (!pc) {
        console.log("⏳ PC not ready, queuing ICE candidate");
        pendingIceCandidates.current.push(candidate);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("✅ ICE candidate added");
      } catch (err) {
        console.error("❌ ICE error:", err);
      }
    });

    // Either user rejected
    s.on("match_rejected", () => {
      console.log("❌ Match rejected");
      setMatchId(null);
      setStatus("Searching");
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [mediaState]);

  useEffect(() => {
    if (!partner || !socketRef.current) return;

    const count = pendingIceCandidates.current.length;
    if (count > 0) {
      console.log(`🧊 Sending ${count} pending ICE candidates to ${partner}`);
    }

    pendingIceCandidates.current.forEach((candidate) => {
      socketRef.current!.emit("webrtc-ice", {
        to: partner,
        candidate,
      });
    });

    pendingIceCandidates.current = [];
  }, [partner]);


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
  };

  /* ---------------- UI ---------------- */

  /* ---------------- MEDIA GATE ---------------- */
  if (mediaState !== "preview") {
    return (
      <main className="h-screen flex items-center justify-center bg-black text-white">

        {/* APP NAME (always visible before preview) */}
        <h1 className="text-7xl font-bold tracking-wide">
          Hilao WebChat
        </h1>


        {mediaState === "denied" && showDeniedDialog && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">

            <div
              className="
        relative
        w-[420px]            /* bigger */
        px-10 py-8
        rounded-2xl
        bg-gray-900          /* grey & opaque */
        border border-white/10
        shadow-2xl
        text-center
      "
            >
              <button
                onClick={() => setShowDeniedDialog(false)}
                className="
          absolute top-4 right-4
          text-gray-400
          hover:text-white
          text-lg
        "
              >
                ✕
              </button>
              <p className="text-xl font-semibold mb-3">
                Camera and microphone blocked
              </p>

              <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                Allow access to your camera and microphone in your browser settings
                to continue.
              </p>

              <button
                onClick={requestMedia}
                className="
          px-10 py-3
          rounded-full
          bg-yellow-400
          text-black
          font-semibold
          text-sm
          hover:brightness-110
          active:scale-95
          transition
        "
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  /* ---------------- MAIN UI ---------------- */
  return (
    <main className="h-screen w-screen bg-black text-white relative overflow-hidden">

      {/* CENTER UI */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center gap-6">

        {mediaState !== "preview" && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black">
            <h1 className="text-4xl font-bold tracking-wide text-white">
              Hilao WebChat
            </h1>
          </div>
        )}

        {/* TOP BAR */}
        <div
          className="
    absolute top-0 left-0
    w-full h-14
    z-40
    bg-[#2b2b2b]
    flex items-center justify-between
    px-4
  "
        >
          {/* LEFT: HILLIES */}
          <div className="flex items-center gap-2 text-white font-medium">
            <div className="w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center text-black text-sm">
              H
            </div>
            <span>1157</span>
          </div>

          {/* RIGHT: FILTERS + ACCOUNT */}
          <div className="flex items-center gap-4">
            {/* FILTERS */}
            <button
              className="
        w-9 h-9
        rounded-full
        flex items-center justify-center
        hover:bg-white/10
        transition
      "
              title="Filters"
            >
              <SlidersHorizontal className="w-5 h-5 text-white/80" />
            </button>

            <div className="h-6 w-px bg-white/25" />

            {/* ACCOUNT */}
            <button
              className="
        w-9 h-9
        rounded-full
        flex items-center justify-center
        hover:bg-white/10
        transition
      "
              title="Account"
            >
              <User className="w-5 h-5 text-white/80" />
            </button>
          </div>
        </div>


        <div
          className="
    absolute
    top-10
    left-0
    w-full
    h-[calc(100vh-2.5rem)]
    z-10
  "
        >
          {/* BACK BUTTON (top-left of video) */}
          {photo && isEditingPhoto && (
            <button
              onClick={() => setIsEditingPhoto(false)}
              className="
      absolute
      top-6 left-52
      z-30
      w-9 h-9
      rounded-full
      bg-black/70
      text-white
      flex items-center justify-center
      text-lg
      hover:bg-black/90
      transition
    "
            >
              <ChevronLeft size={28} strokeWidth={2.5} className="text-white" />

            </button>
          )}

          {status === "Matched" ? (
            /* MATCHED → SPLIT VIEW */
            <div className="absolute inset-0 pt-14 px-4 flex gap-4 z-0">
              {/* REMOTE USER (LEFT) - Using dedicated component */}
              <RemoteVideo stream={remoteStream} />

              {/* LOCAL USER (RIGHT) */}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-1/2 h-full rounded-xl object-cover bg-black"
                style={{ transform: "scaleX(-1)" }}
              />
            </div>
          ) : (
            /* BEFORE MATCH → SINGLE CAMERA */
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="
      absolute top-1/2 left-1/2
      -translate-x-1/2 -translate-y-1/2
      h-full
      max-w-[1080px]
      object-cover
      z-0
    "
              style={{ transform: "scaleX(-1)" }}
            />
          )}


          {/* PREVIEW PHOTO (TOP LEFT) */}
          {photo && (
            <div className="absolute top-3 left-2 z-20">

              <img
                src={photo}
                alt="Preview"
                className="
  w-45
  h-45
  rounded-2xl
  object-cover
  border border-white/20
"
                style={{ transform: "scaleX(-1)" }}
              />
              <button
                onClick={() => setIsEditingPhoto(true)}

                className="
        absolute bottom-0 w-full
        bg-black/60 backdrop-blur
        text-xs text-white
        py-1
      "
              >
                Change Photo
              </button>
            </div>
          )}





          {status === "Matched" && <p>Matched with {partner}</p>}

          {/* CAPTURE BUTTON (only if no photo yet) */}
          {(!photo || isEditingPhoto) && (
            <button
              onClick={capturePhoto}
              className="
  absolute bottom-10 left-1/2 -translate-x-1/2
  w-16 h-16 rounded-full
  bg-black/60 backdrop-blur-md
  border border-white/10
  shadow-lg
  flex items-center justify-center
  text-white text-2xl
  hover:scale-110 active:scale-95 transition
"

            >
              <Camera className="w-7 h-7 text-white" />
            </button>
          )}


          {/* START */}
          {mediaGranted && status === "Idle" && photo && !isEditingPhoto && (
            <button
              onClick={startSearch}
              className="
        absolute bottom-2 left-1/2 -translate-x-1/2
        px-33 py-3
        rounded-full
        bg-yellow-300 text-black font-semibold
        text-lg
        shadow-lg
        z-20
      "
            >
              Start
            </button>
          )}

          {/* PAUSE */}
          {mediaGranted && status === "Searching" && (
            <button
              onClick={cancelSearch}
              className="
      absolute bottom-12 left-1/2 -translate-x-1/2
      px-10 py-3
      rounded-full
      bg-gray-600
      text-white
      font-semibold
      z-30
      shadow-lg
    "
            >
              ⏸ Pause
            </button>
          )}


          {/* ACCEPT / REJECT */}
          {status === "Confirming" && (
            <div
              className="
      absolute bottom-12 left-1/2 -translate-x-1/2
      z-30
      flex flex-col items-center gap-4
    "
            >
              <p className="text-sm text-gray-400">
                {hasAccepted
                  ? "Waiting for user to accept…"
                  : "Found someone! Accept?"}
              </p>

              <div className="flex gap-8">
                <button
                  onClick={rejectMatch}
                  disabled={hasAccepted}
                  className={`
          w-16 h-16 rounded-full text-2xl
          flex items-center justify-center
          transition
          ${hasAccepted
                      ? "bg-gray-700 text-gray-400"
                      : "bg-red-600 text-white hover:scale-110 active:scale-95"
                    }
        `}
                >
                  ✕
                </button>

                <button
                  onClick={acceptMatch}
                  disabled={hasAccepted}
                  className={`
          w-16 h-16 rounded-full text-2xl
          flex items-center justify-center
          transition
          ${hasAccepted
                      ? "bg-gray-700 text-gray-400"
                      : "bg-yellow-400 text-black hover:scale-110 active:scale-95"
                    }
        `}
                >
                  ✓
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* HIDDEN CANVAS */}
      <canvas ref={canvasRef} className="hidden" />
    </main>
  );


}
