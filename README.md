# hilao-webchat
A modern, real-time Chatroulette-style video chat platform that randomly matches users worldwide, supports preference-based matchmaking through an earned virtual currency, automatically forms friendships after meaningful conversations, and enables direct friend-to-friend video calls with live presence tracking.

Built with WebRTC, Socket.io, Redis, and PostgreSQL, focusing on scalability, fairness, safety, and real-world system design.

🌍 Key Features
🔹 Random Video Matchmaking

1-to-1 real-time video chat

Global random pairing

Instant skip / next

Optional live text chat during calls

🔹 Dual Matchmaking Pools (Fair Design)

General Pool → All users

Preference Pool → Visually eligible users

Eligible users appear in both pools

Prevents starvation of the general pool

🔹 Visual Eligibility Verification

Live camera capture (no image uploads)

Liveness detection (blink / movement)

AI-based face attribute classification

Confidence-based eligibility assignment

No images stored — privacy-first design

Used to enable preference-based matchmaking, not identity verification

🔹 Quids (Virtual Currency System)

Earn Quids by engaging in normal conversations

Spend Quids to enable preference-based matchmaking

Quids deducted only after successful matches

Anti-abuse protections (idle detection, minimum duration)

🔹 Smart Duplicate Match Handling

Prevents repetitive pairings

Allows re-matching during low traffic

Adaptive cooldown based on online user count

Redis-based recent match tracking

🔹 Automatic Friendship System

No “Add Friend” button

Users automatically become friends after:

Same session

≥ 1–2 minutes of conversation

No report / block

Zero friction, spam-resistant

🔹 Friends & Direct Calling

Friends list with online/offline status

Presence-aware direct video calls

Reuses the same WebRTC pipeline

Real-time call requests and responses

🔹 Modern Video Call UI

Split-screen (50/50) layout

Mirrored self-preview

Floating bottom control bar

Responsive design (desktop & mobile)

🔹 Safety & Moderation

Always-visible report & block controls

Session logging

Rate limiting

Temporary bans

Designed for future AI moderation hooks

🛠️ Tech Stack
Frontend

Next.js (App Router)

React

Tailwind CSS

Zustand (state management)

Framer Motion (animations)

WebRTC browser APIs

Backend

Node.js

Express / Fastify

Socket.io

WebRTC signaling server

Prisma ORM

Databases & Infra

PostgreSQL — persistent data

Redis — matchmaking, presence, cooldowns

STUN + TURN (coturn) — WebRTC connectivity

🧠 System Design Overview
Matchmaking Flow
User joins
  ↓
Added to General Queue
  ↓
If eligible → also added to Preference Queue
  ↓
Match request
  ├─ Normal mode → General Queue
  └─ Preference mode → Preference Queue (Quids required)
  ↓
Cooldown + active session checks
  ↓
Session created

Duplicate Match Prevention

Active session lock → prevents simultaneous matches

Recent match cooldown → avoids repetitive pairings

Cooldown dynamically reduces during low traffic

Friendship Creation

Triggered automatically on session end

Based on session duration

Idempotent & abuse-resistant

📊 Core Data Models (Simplified)
User {
  id
  quids
  eligibility
  lastSeen
}

Session {
  id
  userA
  userB
  duration
}

Friendship {
  user1
  user2
  createdAt
}

🚀 Getting Started (Planned)
# install dependencies
npm install

# start backend
npm run server

# start frontend
npm run dev


Detailed setup and environment configuration will be added as the project evolves.

🧪 Status

🚧 Active Development
This project is being built incrementally with a focus on:

correctness

scalability

clean architecture

interview-ready system design
