"use client";

/**
 * Reaction picker plus the floating reaction overlay.
 *
 * Reactions are ephemeral by design: they are stored so remote participants
 * receive them, but the overlay only renders ones newer than `REACTION_TTL_MS`
 * so a reaction from ten minutes ago never reappears when someone opens the
 * meeting. Sorting/filtering happens on read rather than by deleting documents,
 * which keeps the write path cheap.
 */
import { useEffect, useState } from "react";
import { REACTION_TTL_MS } from "@/lib/greenroom/constants";
import { MeetingReaction, ReactionKind } from "@/lib/greenroom/types";
import { toMillis } from "@/lib/greenroom/codes";

export const REACTION_EMOJI: Record<ReactionKind, string> = {
  thumbsUp: "👍",
  heart: "❤️",
  laugh: "😂",
  clap: "👏",
  celebrate: "🎉",
  surprised: "😮",
};

const REACTION_LABEL: Record<ReactionKind, string> = {
  thumbsUp: "Thumbs up",
  heart: "Heart",
  laugh: "Laugh",
  clap: "Clap",
  celebrate: "Celebrate",
  surprised: "Surprised",
};

export function ReactionPicker({
  onSelect,
  onClose,
}: {
  onSelect: (kind: ReactionKind) => void;
  onClose: () => void;
}) {
  // Escape closes, matching every other transient popover in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-white/15 bg-slate-800 px-2 py-1.5 shadow-lg"
      role="group"
      aria-label="Send a reaction"
    >
      {(Object.keys(REACTION_EMOJI) as ReactionKind[]).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => {
            onSelect(kind);
            onClose();
          }}
          title={REACTION_LABEL[kind]}
          aria-label={REACTION_LABEL[kind]}
          className="rounded-full px-2 py-1 text-xl transition hover:scale-125 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span aria-hidden="true">{REACTION_EMOJI[kind]}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Floating reactions over the stage.
 *
 * Re-renders on a timer so expired reactions disappear even when no new
 * snapshot arrives — without it, the last reaction of a burst would stay
 * pinned on screen until the next Firestore update.
 */
export function ReactionOverlay({ reactions }: { reactions: MeetingReaction[] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const live = reactions.filter((r) => now - toMillis(r.createdAt) < REACTION_TTL_MS);
  if (live.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-wrap items-end justify-center gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {live.slice(0, 12).map((reaction) => (
        <span
          key={reaction.id}
          className="animate-bounce rounded-full bg-black/50 px-2.5 py-1 text-lg"
        >
          <span aria-hidden="true">{REACTION_EMOJI[reaction.kind] || "👍"}</span>
          <span className="ml-1 align-middle text-[11px] text-white">{reaction.senderName}</span>
        </span>
      ))}
    </div>
  );
}
