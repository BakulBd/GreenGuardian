"use client";

/**
 * Green Room — browser-side data access.
 *
 * Split of responsibility mirrors the rules:
 *   - **Reads and realtime subscriptions** go straight to Firestore, because
 *     `onSnapshot` is what makes the roster, chat and reactions live without
 *     polling (the same approach `lib/firebase/classrooms.ts` uses).
 *   - **Anything that grants authority** (creating a meeting, joining,
 *     moderating, leaving) goes through `/api/greenroom/*` via `authedFetch`,
 *     because those writes are denied to clients by `firestore.rules`.
 *
 * Self-reported presence (`micOn`, `handRaised`, …) is the one client write,
 * and it is confined to the caller's own participant document by a field
 * allowlist in the rules.
 */
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  addDoc,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { authedFetch } from "@/lib/utils/api-client";
import {
  MEETINGS,
  MESSAGES,
  PARTICIPANTS,
  REACTIONS,
  MAX_MESSAGE_LENGTH,
  participantId,
} from "./constants";
import {
  Meeting,
  MeetingMessage,
  MeetingParticipant,
  MeetingReaction,
  MeetingRole,
  MeetingSettings,
  ModerationAction,
  ReactionKind,
  AttendanceRow,
} from "./types";

// ===========================================================================
// Meeting lifecycle (server-mediated)
// ===========================================================================

export interface CreateMeetingInput {
  title: string;
  description?: string;
  durationMinutes: number;
  /** When true the meeting starts immediately and `scheduledStart` is ignored. */
  instant?: boolean;
  scheduledStart?: string;
  courseId?: string;
  courseName?: string;
  classroomId?: string;
  settings?: Partial<MeetingSettings>;
}

export async function createMeeting(
  input: CreateMeetingInput
): Promise<{ meeting: Meeting; passcode: string }> {
  const result = await authedFetch<{ success: boolean; meeting: Meeting; passcode: string }>(
    "/api/greenroom/meetings",
    { method: "POST", body: input, fallbackError: "Failed to create the class." }
  );
  return { meeting: result.meeting, passcode: result.passcode };
}

export async function listMeetings(scope?: "mine"): Promise<Meeting[]> {
  const result = await authedFetch<{ success: boolean; meetings: Meeting[] }>(
    `/api/greenroom/meetings${scope ? `?scope=${scope}` : ""}`,
    { fallbackError: "Failed to load classes." }
  );
  return result.meetings || [];
}

export interface MeetingDetail {
  meeting: Meeting;
  role: MeetingRole;
  /** Host only. */
  passcode?: string;
  /** Moderators only. */
  attendance?: AttendanceRow[];
  participants?: MeetingParticipant[];
}

export async function getMeetingDetail(meetingId: string): Promise<MeetingDetail> {
  return authedFetch<MeetingDetail>(`/api/greenroom/meetings/${encodeURIComponent(meetingId)}`, {
    fallbackError: "Failed to load the class.",
  });
}

export async function updateMeeting(
  meetingId: string,
  updates: Partial<CreateMeetingInput> & { settings?: Partial<MeetingSettings> }
): Promise<Meeting> {
  const result = await authedFetch<{ success: boolean; meeting: Meeting }>(
    `/api/greenroom/meetings/${encodeURIComponent(meetingId)}`,
    { method: "PATCH", body: updates, fallbackError: "Failed to update the class." }
  );
  return result.meeting;
}

/** Soft-cancels by default; `purge` removes the record entirely. */
export async function cancelMeeting(meetingId: string, purge = false): Promise<void> {
  await authedFetch(
    `/api/greenroom/meetings/${encodeURIComponent(meetingId)}${purge ? "?purge=true" : ""}`,
    { method: "DELETE", fallbackError: "Failed to cancel the class." }
  );
}

export interface JoinResult {
  meeting: Meeting;
  meetingId: string;
  role: MeetingRole;
  state: string;
  waiting: boolean;
}

/**
 * Ask the server for admission. Returns `waiting: true` when the caller has
 * been parked in the waiting room and must wait for a host to admit them.
 */
export async function joinMeeting(meetingCode: string, passcode?: string): Promise<JoinResult> {
  return authedFetch<JoinResult>("/api/greenroom/join", {
    method: "POST",
    body: { meetingCode, passcode },
    fallbackError: "Failed to join the class.",
  });
}

export async function leaveMeeting(meetingId: string): Promise<void> {
  await authedFetch("/api/greenroom/leave", {
    method: "POST",
    body: { meetingId },
    fallbackError: "Failed to leave the class.",
  });
}

export interface ModerateInput {
  meetingId: string;
  action: ModerationAction;
  targetUserId?: string;
  settings?: Partial<MeetingSettings>;
}

export async function moderate(input: ModerateInput): Promise<void> {
  await authedFetch("/api/greenroom/moderate", {
    method: "POST",
    body: input,
    fallbackError: "That action could not be completed.",
  });
}

// ===========================================================================
// Realtime subscriptions (direct Firestore reads)
// ===========================================================================

/** Convert a Firestore snapshot doc into a typed object with its id. */
function withId<T>(d: any): T {
  return { ...d.data(), id: d.id } as T;
}

export function subscribeToMeeting(
  meetingId: string,
  onChange: (meeting: Meeting | null) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    doc(db, MEETINGS, meetingId),
    (snap) => onChange(snap.exists() ? withId<Meeting>(snap) : null),
    (error) => onError?.(error as Error)
  );
}

/**
 * Live roster. Ordering is done in memory rather than with `orderBy` so that a
 * missing composite index can never take the participant list down mid-class —
 * the roster is small and the sort is trivial.
 */
export function subscribeToParticipants(
  meetingId: string,
  onChange: (participants: MeetingParticipant[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    query(collection(db, PARTICIPANTS), where("meetingId", "==", meetingId)),
    (snap) => {
      const rows = snap.docs.map((d) => withId<MeetingParticipant>(d));
      rows.sort((a, b) => {
        // Hosts first, then co-hosts, then everyone alphabetically — the order
        // a teacher expects when scanning the panel.
        const rank = (r: MeetingRole) => (r === "host" ? 0 : r === "cohost" ? 1 : 2);
        const byRole = rank(a.role) - rank(b.role);
        return byRole !== 0 ? byRole : (a.name || "").localeCompare(b.name || "");
      });
      onChange(rows);
    },
    (error) => onError?.(error as Error)
  );
}

/** Watch only your own participant document — drives forced-mute and admission. */
export function subscribeToOwnParticipant(
  meetingId: string,
  userId: string,
  onChange: (participant: MeetingParticipant | null) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    doc(db, PARTICIPANTS, participantId(meetingId, userId)),
    (snap) => onChange(snap.exists() ? withId<MeetingParticipant>(snap) : null),
    (error) => onError?.(error as Error)
  );
}

const CHAT_WINDOW = 200;

export function subscribeToMessages(
  meetingId: string,
  onChange: (messages: MeetingMessage[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    query(
      collection(db, MESSAGES),
      where("meetingId", "==", meetingId),
      orderBy("createdAt", "asc"),
      limit(CHAT_WINDOW)
    ),
    (snap) => onChange(snap.docs.map((d) => withId<MeetingMessage>(d))),
    (error) => onError?.(error as Error)
  );
}

export function subscribeToReactions(
  meetingId: string,
  onChange: (reactions: MeetingReaction[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    query(
      collection(db, REACTIONS),
      where("meetingId", "==", meetingId),
      orderBy("createdAt", "desc"),
      limit(40)
    ),
    (snap) => onChange(snap.docs.map((d) => withId<MeetingReaction>(d))),
    (error) => onError?.(error as Error)
  );
}

// ===========================================================================
// Participant self-service writes (own document only)
// ===========================================================================

/**
 * Update your own presence flags.
 *
 * Only the fields in the rules' allowlist may be sent. Anything outside it
 * (role, state, attendance) is rejected by Firestore, which is what stops a
 * participant from promoting themselves — see firestore.rules.
 */
export async function updateOwnPresence(
  meetingId: string,
  userId: string,
  patch: Partial<Pick<MeetingParticipant, "micOn" | "camOn" | "handRaised" | "screenSharing">>
): Promise<void> {
  await updateDoc(doc(db, PARTICIPANTS, participantId(meetingId, userId)), {
    ...patch,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Heartbeat so the room can tell a closed laptop from a quiet participant. */
export async function touchPresence(meetingId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, PARTICIPANTS, participantId(meetingId, userId)), {
    lastSeenAt: serverTimestamp(),
  }).catch(() => {
    // A failed heartbeat is not worth surfacing — the next one will land, and
    // a genuinely dead session is handled by the presence timeout on read.
  });
}

export async function sendMessage(
  meetingId: string,
  sender: { id: string; name: string },
  text: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
  }
  await addDoc(collection(db, MESSAGES), {
    meetingId,
    senderId: sender.id,
    senderName: sender.name,
    text: trimmed,
    type: "chat",
    createdAt: serverTimestamp(),
  });
}

export async function sendReaction(
  meetingId: string,
  sender: { id: string; name: string },
  kind: ReactionKind
): Promise<void> {
  await addDoc(collection(db, REACTIONS), {
    meetingId,
    senderId: sender.id,
    senderName: sender.name,
    kind,
    createdAt: serverTimestamp(),
  });
}
