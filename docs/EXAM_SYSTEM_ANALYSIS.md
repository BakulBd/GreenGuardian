# GreenGuardian — Exam System Analysis & Fixes

Scope of this pass: make live student video work on the **deployed (Vercel) site**
— not only on one local PC — and audit the exam system end to end across the
**student**, **teacher** and **admin** modules.

---

## 1. Live video: why it only worked locally

The old implementation (`lib/services/webrtcSignaling.ts`, now removed) had three
independent reasons to fail in production:

| # | Problem | Effect on Vercel |
|---|---------|------------------|
| 1 | **BroadcastChannel was the only reliable transport.** `startLocalLiveVideoBroadcaster()` pushed JPEG frames over a `BroadcastChannel`, which is scoped to *one browser on one machine*. | Perfect video when the teacher tab and student tab were open on the same PC; nothing at all when the teacher was on another device. |
| 2 | **Single-slot WebRTC signaling.** One `liveVideoSignaling/{sessionId}` document held one `offer` and one `answer`. The student created its offer at exam start — before any teacher was watching — and never renegotiated. | Only the *first* teacher who ever opened the page could connect; a reload, a second teacher, or a teacher arriving after the exam started got a stale offer and no video. |
| 3 | **STUN-only ICE, no fallback.** No TURN servers and no non-P2P path. | Students behind symmetric NAT / campus firewalls / some mobile carriers could never connect, with nothing to fall back to. |

The teacher UI therefore fell through to `proctoring.lastSnapshot`, a 240×180
JPEG written every 5 seconds — a slideshow, not live video.

## 2. New design (`lib/services/liveVideo.ts`)

No VPS and no SFU. Three layered transports; the teacher UI shows whichever is
alive:

```
student browser                                    teacher browser
──────────────                                     ───────────────
 camera stream ──┬─ WebRTC P2P ────────────────────► <video>        "LIVE HD"
                 │   (signaling via Firestore)
                 ├─ Firestore frame relay ─────────► <img>          "LIVE"
                 │   liveFrames/{sessionId}
                 └─ BroadcastChannel (same PC) ────► <img>          "LIVE"
```

**Viewer-driven signaling.** A teacher writes a presence document at
`liveVideoSignaling/{sessionId}/viewers/{viewerId}`. The student's browser
watches that collection and creates a **dedicated `RTCPeerConnection` per
viewer**, with its own offer, answer and ICE candidate subcollections. This
fixes multi-teacher viewing, reconnects, and late joins.

**Firestore frame relay — the transport that makes Vercel work.** While at least
one viewer is present, the student writes a small JPEG into
`liveFrames/{sessionId}`; the teacher receives it over a realtime listener. It
needs no P2P connectivity at all, so a picture always appears.

**Presence & heartbeats.** Viewers refresh `lastSeenAt` every 12s; the student
prunes viewers stale for >45s and stops streaming for them.

### Firestore cost control (Spark free plan)

The relay is a write loop, so it is deliberately conservative:

| Condition | Frame interval | Frame size |
|-----------|---------------|------------|
| No teacher watching | **no writes at all** | — |
| Grid tile watching (`thumb`) | 2.5s | 320px wide, q0.5 |
| Fullscreen/detail (`high`) | 1.0s | 480px wide, q0.6 |
| WebRTC connected for all viewers | 15s (heartbeat only) | as above |

Identical consecutive frames are skipped. WebRTC, when it connects, costs zero
Firestore writes — the relay is a fallback, not the primary path.

### Optional TURN

STUN cannot traverse symmetric NAT (~10–20% of real connections). Those students
automatically use the relay. To give them full-rate P2P video, set in Vercel:

```
NEXT_PUBLIC_TURN_URLS=turn:host:3478,turns:host:5349
NEXT_PUBLIC_TURN_USERNAME=...
NEXT_PUBLIC_TURN_CREDENTIAL=...
```

### Deployment checklist

1. Deploy the app (Vercel) — no extra server is needed.
2. **Deploy the Firestore rules**: `npm run firebase:deploy:rules`. The new
   `liveFrames` and `liveVideoSignaling/viewers` rules are required; without them
   live video is silently denied in production.
3. Optionally set the TURN env vars above.
4. Camera access requires HTTPS — Vercel provides this; a raw-IP LAN host does not.

---

## 3. Module-by-module audit

### Student module

| Issue | Status |
|-------|--------|
| Refreshing mid-exam created a **second session** and reset the countdown to full duration — an unlimited time exploit. | **Fixed** — `resolvePriorAttempt()` finds the open attempt, resumes the same session document and computes the remaining time from the original `startTime`. |
| Answers existed only in React state; a crash or reload lost everything. | **Fixed** — answers auto-save to `examSessions/{id}.savedAnswers` every 15s and are restored on resume. |
| No server-visible heartbeat, so a teacher could not tell an open tab from a closed one. | **Fixed** — the same 15s tick refreshes `updatedAt`. |
| A submitted exam could be re-entered from a direct `/exam/{id}` URL. | **Fixed** — a finished attempt shows an "Already Submitted" screen. |
| Expired attempt left "in progress" forever if the student never came back. | **Fixed** — closed out as `auto-submitted` on next visit. |
| Dashboard loaded an **unordered `limit(10)`** of sessions: stats were computed from an arbitrary subset, and an attempt outside those 10 was invisible. | **Fixed** — loads all of the student's sessions, sorts, then displays the latest 10. |
| Dashboard did one Firestore query **per session** to resolve the exam title (N+1). | **Fixed** — resolved in a single pass from a title map. |
| An interrupted exam showed a disabled "Attempted" button, locking the student out of their own unfinished attempt. | **Fixed** — shows "Resume Exam"; only *submitted* attempts lock the exam. |

### Teacher module

| Issue | Status |
|-------|--------|
| Live grid showed **ghost students** — every never-submitted session, however old, counted as live forever. | **Fixed** — sessions inactive for >30 min are dropped; `isOnline` is derived from the heartbeat (90s window) instead of a flag the student's browser can never clear. |
| `subscribeToLiveSessions` re-queried the violation list for **every student on every snapshot**. Each student writes every ~5s, so a 30-student exam generated thousands of reads per minute and lagged the grid. | **Fixed** — per-session event cache with a 20s TTL. |
| `logProctoringEvent` counted a whole collection with a query on **every single violation** just to store a number. | **Fixed** — atomic `increment(1)`. |
| Watch Live polled a `refreshKey` every 2s to force `<img>` re-renders. | **Removed** — the live transports push frames. |
| "Camera Off / Live" badge only meant "a stored snapshot exists". | **Fixed** — reflects the real transport (`LIVE HD` / `LIVE` / `Snapshot` / `Offline`). |
| Live video appeared only on Watch Live. | **Fixed** — `components/LiveVideoTile.tsx` is shared by Watch Live (grid, fullscreen, detail dialog), Live Monitoring (grid, list, detail) and Monitoring. |
| Teacher dashboard "Active Exams" counted only `status === "active"`, but exams are created as `published` — it always read 0. | **Fixed** — counts both. |

### Admin module

Reviewed: users/approvals, courses, batches, sections, teacher assignments,
academics, exam oversight, settings. No correctness defects were found in this
pass; admin reads and writes are governed by the `isAdmin()` rules in
`firestore.rules`, which were left unchanged apart from the new live-video
collections.

---

## 4. Known limitations / recommended next steps

These are **not** fixed here and are worth planning:

1. **Grading is client-side.** `ExamClient.handleSubmit()` reads the exam
   document (with `correctAnswer`) in the browser to compute the score. A
   determined student can read the answers from network traffic before
   submitting. Moving grading to a server route / Cloud Function is the single
   biggest integrity improvement left.
2. **One-attempt-per-exam is enforced in the UI**, not by Firestore rules. A
   crafted client could still create a second session document.
3. **Relay frames are stored inline** in `liveFrames/{sessionId}` (overwritten
   each tick, deleted at exam end). At large scale, Cloud Storage plus a signed
   URL would be cheaper than repeated document writes.
4. **`liveVideoSignaling/**/viewers` is readable/writable by any authenticated
   user.** SDP/ICE blobs are ephemeral and useless without the peer, but scoping
   writes to the owning student and staff would be tighter.
5. **Proctoring events have no composite index** for `sessionId + timestamp`;
   sorting happens in memory. Fine for a class, not for thousands of events.
