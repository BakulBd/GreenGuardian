"use client";

/**
 * The Green Room meeting itself.
 *
 * Orchestration only — every hard problem lives in a focused module and this
 * component wires them together:
 *
 *   - authority        → lib/greenroom/permissions (shared with the server)
 *   - media transport  → lib/greenroom/mesh
 *   - data + realtime  → lib/greenroom/client
 *   - devices          → lib/greenroom/devices
 *
 * The single most important invariant here: the roster from Firestore is the
 * source of truth for who should be connected. `MeshConnection.syncPeers()` is
 * driven straight off it, so a participant who is removed server-side loses
 * their peer connections without any cooperation from their own client.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Copy, Info, Wifi, WifiOff, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import PreJoin from "@/components/greenroom/PreJoin";
import MeetingStage, { StageLayout, StageTile } from "@/components/greenroom/MeetingStage";
import MeetingControls from "@/components/greenroom/MeetingControls";
import ParticipantsPanel from "@/components/greenroom/ParticipantsPanel";
import ChatPanel from "@/components/greenroom/ChatPanel";
import { ReactionPicker, ReactionOverlay } from "@/components/greenroom/ReactionsBar";
import { MeshConnection, PeerConnectionState } from "@/lib/greenroom/mesh";
import { clearAllSignals } from "@/lib/greenroom/signaling";
import {
  acquireScreenShare,
  acquireStream,
  stopStream,
} from "@/lib/greenroom/devices";
import { capabilitiesFor } from "@/lib/greenroom/permissions";
import { HEARTBEAT_INTERVAL_MS, PRESENCE_TIMEOUT_MS } from "@/lib/greenroom/constants";
import { toMillis, buildJoinUrl, formatDuration } from "@/lib/greenroom/codes";
import {
  joinMeeting,
  leaveMeeting,
  moderate,
  subscribeToMeeting,
  subscribeToParticipants,
  subscribeToOwnParticipant,
  subscribeToMessages,
  subscribeToReactions,
  updateOwnPresence,
  touchPresence,
  sendMessage,
  sendReaction,
} from "@/lib/greenroom/client";
import {
  Meeting,
  MeetingMessage,
  MeetingParticipant,
  MeetingReaction,
  MeetingRole,
  ModerationAction,
  ReactionKind,
} from "@/lib/greenroom/types";

type Phase = "loading" | "passcode" | "prejoin" | "waiting" | "in-meeting" | "ended" | "error";

export default function MeetingClient() {
  const { user, initialized } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();
  // The route segment is the human meeting code (`123-456-789`), not the
  // Firestore document id — that is resolved server-side by /api/greenroom/join.
  const meetingCode = decodeURIComponent(String(params?.code || ""));

  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [passcodeInput, setPasscodeInput] = useState("");
  const [joining, setJoining] = useState(false);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [role, setRole] = useState<MeetingRole>("participant");
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [messages, setMessages] = useState<MeetingMessage[]>([]);
  const [reactions, setReactions] = useState<MeetingReaction[]>([]);

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);

  const [layout, setLayout] = useState<StageLayout>("grid");
  const [panelOpen, setPanelOpen] = useState<"participants" | "chat" | "settings" | null>(null);
  const [showReactions, setShowReactions] = useState(false);
  const [lastReadCount, setLastReadCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [peerStates, setPeerStates] = useState<Record<string, PeerConnectionState>>({});

  const meshRef = useRef<MeshConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const meetingIdRef = useRef<string>("");
  const deviceRef = useRef<{ cameraId?: string; microphoneId?: string }>({});

  const settings = meeting?.settings;
  const capabilities = useMemo(
    () =>
      settings
        ? capabilitiesFor(role, settings)
        : capabilitiesFor("participant", {
            waitingRoom: true,
            joinBeforeHost: false,
            allowParticipantScreenShare: false,
            allowChat: false,
            allowReactions: false,
            allowParticipantUnmute: false,
            audioOnly: false,
            locked: false,
          }),
    [role, settings]
  );

  // -----------------------------------------------------------------------
  // Admission
  // -----------------------------------------------------------------------

  const attemptJoin = useCallback(
    async (passcode?: string) => {
      setJoining(true);
      try {
        const result = await joinMeeting(meetingCode, passcode);
        meetingIdRef.current = result.meetingId;
        setMeeting(result.meeting);
        setRole(result.role);
        setPhase(result.waiting ? "waiting" : "prejoin");
        return true;
      } catch (error: any) {
        const message = error?.message || "Could not join this meeting.";
        // A passcode problem is recoverable in place; everything else
        // (not enrolled, meeting full, ended) is terminal for this attempt and
        // deserves the full error screen rather than an endless passcode form.
        if (/passcode/i.test(message)) {
          setPhase("passcode");
          setErrorMessage(message);
        } else {
          setPhase("error");
          setErrorMessage(message);
        }
        return false;
      } finally {
        setJoining(false);
      }
    },
    [meetingCode]
  );

  useEffect(() => {
    if (!initialized) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(`/green-room/${meetingCode}`)}`);
      return;
    }
    // Try without a passcode first: hosts and rejoining participants are
    // exempt, so this avoids asking them for something they don't need.
    attemptJoin();
  }, [initialized, user, meetingCode, attemptJoin, router]);

  // -----------------------------------------------------------------------
  // Realtime subscriptions (only once we have a meeting id)
  // -----------------------------------------------------------------------

  useEffect(() => {
    const meetingId = meetingIdRef.current;
    if (!meetingId || phase === "loading" || phase === "passcode" || phase === "error") return;

    const unsubs = [
      subscribeToMeeting(meetingId, (next) => {
        if (!next) return;
        setMeeting(next);
        if (next.status === "ended") setPhase("ended");
      }),
      subscribeToParticipants(meetingId, setParticipants),
      subscribeToMessages(meetingId, setMessages),
      subscribeToReactions(meetingId, setReactions),
    ];

    return () => unsubs.forEach((u) => u());
  }, [phase]);

  // Own participant document: drives admission from the waiting room, forced
  // mute by a host, and removal.
  useEffect(() => {
    const meetingId = meetingIdRef.current;
    if (!meetingId || !user) return;

    return subscribeToOwnParticipant(meetingId, user.id, (self) => {
      if (!self) return;

      setRole(self.role);

      if (self.state === "removed") {
        setPhase("ended");
        setErrorMessage("You were removed from this meeting by the host.");
        return;
      }
      if (self.state === "rejected") {
        setPhase("error");
        setErrorMessage("The host did not admit you to this meeting.");
        return;
      }
      // Admitted out of the waiting room → go set up devices.
      setPhase((current) => (current === "waiting" && self.state === "joined" ? "prejoin" : current));

      // A host-forced mute must actually stop the track, not just flip a flag.
      if (!self.micOn && micOn) {
        setMicOn(false);
        localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
        toast({ title: "You were muted", description: "The host muted your microphone." });
      }
      if (!self.handRaised && handRaised) setHandRaised(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, phase]);

  // -----------------------------------------------------------------------
  // Mesh lifecycle
  // -----------------------------------------------------------------------

  /**
   * Peers we should hold a connection to: everyone joined and recently seen,
   * except ourselves. Filtering on the heartbeat keeps ghosts (closed laptops)
   * out of the mesh — otherwise every stale participant costs a dead peer
   * connection for everyone still in the room.
   */
  const activePeerIds = useMemo(() => {
    const now = Date.now();
    return participants
      .filter((p) => {
        if (p.state !== "joined") return false;
        if (p.userId === user?.id) return false;
        const lastSeen = toMillis(p.lastSeenAt);
        return lastSeen === 0 || now - lastSeen < PRESENCE_TIMEOUT_MS;
      })
      .map((p) => p.userId);
  }, [participants, user?.id]);

  useEffect(() => {
    if (phase !== "in-meeting" || !user) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.syncPeers(activePeerIds);
  }, [activePeerIds, phase, user]);

  /** Enter the meeting with the stream the pre-join screen already acquired. */
  const enterMeeting = useCallback(
    async (options: {
      stream: MediaStream | null;
      micOn: boolean;
      camOn: boolean;
      cameraId?: string;
      microphoneId?: string;
    }) => {
      if (!user) return;
      const meetingId = meetingIdRef.current;

      localStreamRef.current = options.stream;
      deviceRef.current = { cameraId: options.cameraId, microphoneId: options.microphoneId };
      setMicOn(options.micOn);
      setCamOn(options.camOn);

      options.stream?.getAudioTracks().forEach((t) => (t.enabled = options.micOn));
      options.stream?.getVideoTracks().forEach((t) => (t.enabled = options.camOn));

      const mesh = new MeshConnection(meetingId, user.id, {
        onPeerStream: (userId, stream) =>
          setRemoteStreams((prev) => (prev[userId] === stream ? prev : { ...prev, [userId]: stream })),
        onPeerState: (userId, state) => setPeerStates((prev) => ({ ...prev, [userId]: state })),
        onPeerGone: (userId) => {
          setRemoteStreams((prev) => {
            const next = { ...prev };
            delete next[userId];
            return next;
          });
          setPeerStates((prev) => {
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        },
      });
      meshRef.current = mesh;
      await mesh.setLocalStream(options.stream);

      await updateOwnPresence(meetingId, user.id, {
        micOn: options.micOn,
        camOn: options.camOn,
      }).catch(() => {});

      setPhase("in-meeting");
    },
    [user]
  );

  // Heartbeat, so other clients can tell a quiet participant from a gone one.
  useEffect(() => {
    if (phase !== "in-meeting" || !user) return;
    const meetingId = meetingIdRef.current;
    const timer = setInterval(() => {
      touchPresence(meetingId, user.id);
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [phase, user]);

  // Meeting timer.
  useEffect(() => {
    if (phase !== "in-meeting" || !meeting?.startedAt) return;
    const started = toMillis(meeting.startedAt);
    const tick = () => setElapsed(Math.max(0, Date.now() - started));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase, meeting?.startedAt]);

  /** Full teardown. Runs on unmount and on explicit leave. */
  const teardown = useCallback(() => {
    meshRef.current?.close();
    meshRef.current = null;
    stopStream(localStreamRef.current);
    stopStream(screenStreamRef.current);
    localStreamRef.current = null;
    screenStreamRef.current = null;
  }, []);

  useEffect(() => {
    return () => teardown();
  }, [teardown]);

  // Best-effort leave when the tab closes. `keepalive` is what lets the request
  // survive unload; without it the participant lingers as joined until the
  // presence timeout and their attendance never gets banked.
  useEffect(() => {
    if (phase !== "in-meeting" || !user) return;
    const meetingId = meetingIdRef.current;

    const handleUnload = () => {
      const body = JSON.stringify({ meetingId });
      navigator.sendBeacon?.("/api/greenroom/leave", new Blob([body], { type: "application/json" }));
    };
    window.addEventListener("pagehide", handleUnload);
    return () => window.removeEventListener("pagehide", handleUnload);
  }, [phase, user]);

  // -----------------------------------------------------------------------
  // Controls
  // -----------------------------------------------------------------------

  const toggleMic = async () => {
    if (!user) return;
    const next = !micOn;
    if (next && !capabilities.unmuteSelf) {
      toast({
        title: "Unmuting is off",
        description: "The host has muted participants for this meeting.",
        variant: "destructive",
      });
      return;
    }

    let stream = localStreamRef.current;
    // Someone who joined with the mic off has no audio track at all; acquire
    // one on demand rather than forcing them back through the pre-join screen.
    if (next && !stream?.getAudioTracks().length) {
      try {
        const fresh = await acquireStream({
          video: false,
          audio: true,
          microphoneId: deviceRef.current.microphoneId,
        });
        const audioTrack = fresh.getAudioTracks()[0];
        if (audioTrack && stream) stream.addTrack(audioTrack);
        else if (audioTrack) {
          stream = new MediaStream([audioTrack]);
          localStreamRef.current = stream;
        }
        await meshRef.current?.setLocalStream(stream);
      } catch (error: any) {
        toast({ title: "Microphone unavailable", description: error?.message, variant: "destructive" });
        return;
      }
    }

    stream?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
    updateOwnPresence(meetingIdRef.current, user.id, { micOn: next }).catch(() => {});
  };

  const toggleCam = async () => {
    if (!user) return;
    if (!capabilities.enableCamera) {
      toast({ title: "Camera is off for this class", description: "This is an audio-only meeting." });
      return;
    }
    const next = !camOn;
    let stream = localStreamRef.current;

    if (next && !stream?.getVideoTracks().length) {
      try {
        const fresh = await acquireStream({
          video: true,
          audio: false,
          cameraId: deviceRef.current.cameraId,
          peerCount: meshRef.current?.peerCount ?? 0,
        });
        const videoTrack = fresh.getVideoTracks()[0];
        if (videoTrack && stream) stream.addTrack(videoTrack);
        else if (videoTrack) {
          stream = new MediaStream([videoTrack]);
          localStreamRef.current = stream;
        }
        await meshRef.current?.setLocalStream(stream);
      } catch (error: any) {
        toast({ title: "Camera unavailable", description: error?.message, variant: "destructive" });
        return;
      }
    }

    stream?.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
    updateOwnPresence(meetingIdRef.current, user.id, { camOn: next }).catch(() => {});
  };

  const toggleScreenShare = async () => {
    if (!user) return;
    if (!capabilities.shareScreen) {
      toast({
        title: "Screen sharing is off",
        description: "The host has not enabled screen sharing for participants.",
        variant: "destructive",
      });
      return;
    }

    if (screenSharing) {
      stopStream(screenStreamRef.current);
      screenStreamRef.current = null;
      await meshRef.current?.setScreenTrack(null);
      setScreenSharing(false);
      setLayout("grid");
      updateOwnPresence(meetingIdRef.current, user.id, { screenSharing: false }).catch(() => {});
      return;
    }

    try {
      const stream = await acquireScreenShare();
      if (!stream) return; // picker dismissed — not an error
      screenStreamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      await meshRef.current?.setScreenTrack(track || null);
      setScreenSharing(true);
      setLayout("screen");
      updateOwnPresence(meetingIdRef.current, user.id, { screenSharing: true }).catch(() => {});

      // The browser's own "Stop sharing" bar bypasses our button entirely, so
      // the track's end event has to drive the same teardown.
      track?.addEventListener("ended", () => {
        screenStreamRef.current = null;
        meshRef.current?.setScreenTrack(null);
        setScreenSharing(false);
        setLayout("grid");
        updateOwnPresence(meetingIdRef.current, user.id, { screenSharing: false }).catch(() => {});
      });
    } catch (error: any) {
      toast({ title: "Could not share your screen", description: error?.message, variant: "destructive" });
    }
  };

  const toggleHand = () => {
    if (!user) return;
    const next = !handRaised;
    setHandRaised(next);
    updateOwnPresence(meetingIdRef.current, user.id, { handRaised: next }).catch(() => {});
  };

  const handleModerate = async (action: ModerationAction, targetUserId: string) => {
    try {
      await moderate({ meetingId: meetingIdRef.current, action, targetUserId });
    } catch (error: any) {
      toast({ title: "Action failed", description: error?.message, variant: "destructive" });
    }
  };

  const handleLeave = async () => {
    teardown();
    await leaveMeeting(meetingIdRef.current).catch(() => {});
    router.push(user?.role === "teacher" ? "/dashboard/teacher/green-room" : "/dashboard/student/green-room");
  };

  const handleEndMeeting = async () => {
    if (!confirm("End this meeting for everyone? Nobody will be able to rejoin.")) return;
    try {
      await moderate({ meetingId: meetingIdRef.current, action: "end" });
      await clearAllSignals(meetingIdRef.current);
      teardown();
      router.push("/dashboard/teacher/green-room");
    } catch (error: any) {
      toast({ title: "Could not end the meeting", description: error?.message, variant: "destructive" });
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!user) return;
    try {
      await sendMessage(meetingIdRef.current, { id: user.id, name: user.name }, text);
    } catch (error: any) {
      toast({ title: "Message not sent", description: error?.message, variant: "destructive" });
    }
  };

  const handleReaction = async (kind: ReactionKind) => {
    if (!user) return;
    await sendReaction(meetingIdRef.current, { id: user.id, name: user.name }, kind).catch(() => {});
  };

  // -----------------------------------------------------------------------
  // Derived view state
  // -----------------------------------------------------------------------

  const sharingParticipant = participants.find((p) => p.screenSharing && p.state === "joined");

  const tiles: StageTile[] = useMemo(() => {
    if (!user) return [];
    const joined = participants.filter((p) => p.state === "joined");

    return joined.map((p) => {
      const isLocal = p.userId === user.id;
      return {
        userId: p.userId,
        name: p.name,
        stream: isLocal ? localStreamRef.current : remoteStreams[p.userId] || null,
        isLocal,
        micOn: isLocal ? micOn : p.micOn,
        camOn: isLocal ? camOn : p.camOn,
        handRaised: p.handRaised,
        screenSharing: p.screenSharing,
        role: p.role,
        connectionState: isLocal ? "connected" : peerStates[p.userId] || "connecting",
      };
    });
  }, [participants, user, remoteStreams, peerStates, micOn, camOn]);

  const effectiveLayout: StageLayout = sharingParticipant ? "screen" : layout;
  const featuredUserId = sharingParticipant?.userId || tiles.find((t) => !t.isLocal)?.userId || null;

  const waitingCount = capabilities.admitParticipants
    ? participants.filter((p) => p.state === "waiting").length
    : 0;
  const unreadMessages = panelOpen === "chat" ? 0 : Math.max(0, messages.length - lastReadCount);

  useEffect(() => {
    if (panelOpen === "chat") setLastReadCount(messages.length);
  }, [panelOpen, messages.length]);

  const anyPeerFailed = Object.values(peerStates).some((s) => s === "failed");

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (phase === "loading" || !initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" aria-hidden="true" />
        <span className="sr-only">Loading meeting</span>
      </div>
    );
  }

  if (phase === "passcode") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-sm rounded-xl border border-white/10 bg-slate-900 p-6 text-slate-100">
          <h1 className="text-lg font-semibold">Enter the passcode</h1>
          <p className="mt-1 text-sm text-slate-400">Meeting ID {meetingCode}</p>
          {errorMessage && <p className="mt-3 text-sm text-red-300">{errorMessage}</p>}
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              attemptJoin(passcodeInput);
            }}
          >
            <div>
              <label htmlFor="passcode" className="mb-1 block text-xs font-medium text-slate-300">
                Passcode
              </label>
              <input
                id="passcode"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                autoFocus
                autoComplete="off"
                className="w-full rounded-lg border border-white/15 bg-slate-800 px-3 py-2 text-center text-lg tracking-widest text-slate-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <Button type="submit" disabled={joining || !passcodeInput.trim()} className="w-full bg-emerald-600 hover:bg-emerald-700">
              {joining && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Join
            </Button>
          </form>
        </div>
      </div>
    );
  }

  if (phase === "error" || phase === "ended") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-6 text-center text-slate-100">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-400" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">
            {phase === "ended" ? "This meeting has ended" : "Cannot join this meeting"}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {errorMessage || "The host ended the meeting."}
          </p>
          <Button
            className="mt-4 bg-emerald-600 hover:bg-emerald-700"
            onClick={() =>
              router.push(
                user?.role === "teacher" ? "/dashboard/teacher/green-room" : "/dashboard/student/green-room"
              )
            }
          >
            Back to Green Room
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-6 text-center text-slate-100">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-500" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">Waiting for the host</h1>
          <p className="mt-2 text-sm text-slate-400">
            You&apos;re in the waiting room for <strong>{meeting?.title}</strong>. The host will let
            you in shortly.
          </p>
          <Button
            variant="outline"
            className="mt-4 border-white/20 bg-transparent text-slate-200 hover:bg-white/10"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "prejoin") {
    return (
      <PreJoin
        meetingTitle={meeting?.title || "Green Room"}
        hostName={meeting?.teacherName}
        audioOnly={settings?.audioOnly}
        joining={joining}
        onJoin={enterMeeting}
        onCancel={() => router.back()}
      />
    );
  }

  // --- in meeting ---
  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{meeting?.title}</h1>
          <p className="text-xs text-slate-400">
            {meeting?.meetingCode}
            {elapsed > 0 && <> · {formatDuration(elapsed)}</>}
          </p>
        </div>

        <span
          className="flex items-center gap-1 text-xs text-slate-400"
          title={anyPeerFailed ? "Some participants could not connect" : "Connected"}
        >
          {anyPeerFailed ? (
            <WifiOff className="h-4 w-4 text-amber-400" aria-hidden="true" />
          ) : (
            <Wifi className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{anyPeerFailed ? "Unstable" : "Connected"}</span>
        </span>

        <Button
          size="sm"
          variant="outline"
          className="border-white/20 bg-transparent text-slate-200 hover:bg-white/10"
          onClick={() => {
            navigator.clipboard
              ?.writeText(buildJoinUrl(window.location.origin, meeting?.meetingCode || ""))
              .then(() => toast({ title: "Invite link copied" }))
              .catch(() => toast({ title: "Could not copy", variant: "destructive" }));
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Invite</span>
        </Button>
      </header>

      {/* Stage + side panel */}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 p-2">
          <MeetingStage tiles={tiles} layout={effectiveLayout} featuredUserId={featuredUserId} />
          <ReactionOverlay reactions={reactions} />

          {showReactions && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <ReactionPicker onSelect={handleReaction} onClose={() => setShowReactions(false)} />
            </div>
          )}
        </main>

        {panelOpen && (
          <aside
            className="flex w-full max-w-xs shrink-0 flex-col border-l border-white/10 bg-slate-900"
            aria-label={
              panelOpen === "participants" ? "Participants" : panelOpen === "chat" ? "Chat" : "Settings"
            }
          >
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <h2 className="text-sm font-semibold capitalize">{panelOpen}</h2>
              <button
                type="button"
                onClick={() => setPanelOpen(null)}
                aria-label="Close panel"
                className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1">
              {panelOpen === "participants" && user && (
                <ParticipantsPanel
                  participants={participants}
                  selfUserId={user.id}
                  hostUserId={meeting?.teacherId || ""}
                  capabilities={capabilities}
                  onModerate={handleModerate}
                />
              )}
              {panelOpen === "chat" && user && (
                <ChatPanel
                  messages={messages}
                  selfUserId={user.id}
                  canSend={capabilities.sendChat}
                  onSend={handleSendMessage}
                />
              )}
              {panelOpen === "settings" && (
                <div className="space-y-3 p-3 text-sm">
                  <p className="flex items-start gap-2 rounded-lg bg-white/5 p-2 text-xs text-slate-300">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                    Green Room connects people directly to each other. Video quality adapts to the
                    number of participants.
                  </p>
                  <dl className="space-y-1 text-xs text-slate-400">
                    <div className="flex justify-between">
                      <dt>Meeting ID</dt>
                      <dd className="text-slate-200">{meeting?.meetingCode}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Your role</dt>
                      <dd className="capitalize text-slate-200">{role}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>In the meeting</dt>
                      <dd className="text-slate-200">{tiles.length}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <MeetingControls
        capabilities={capabilities}
        isHost={role === "host"}
        micOn={micOn}
        camOn={camOn}
        handRaised={handRaised}
        screenSharing={screenSharing}
        layout={effectiveLayout}
        participantCount={tiles.length}
        unreadMessages={unreadMessages}
        waitingCount={waitingCount}
        panelOpen={panelOpen}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleScreenShare={toggleScreenShare}
        onToggleHand={toggleHand}
        onCycleLayout={() => setLayout((l) => (l === "grid" ? "speaker" : "grid"))}
        onOpenPanel={setPanelOpen}
        onOpenReactions={() => setShowReactions((v) => !v)}
        onLeave={handleLeave}
        onEndMeeting={handleEndMeeting}
      />
    </div>
  );
}
