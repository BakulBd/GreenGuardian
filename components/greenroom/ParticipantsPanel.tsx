"use client";

/**
 * Participants panel — the live roster plus host moderation.
 *
 * Waiting-room arrivals are pulled to the top as a distinct section: an admit
 * decision is time-sensitive in a way that scrolling a roster is not, and
 * burying a waiting student in an alphabetical list is how they end up stuck
 * outside a class for ten minutes.
 *
 * Every moderation button here calls `/api/greenroom/moderate`, which re-checks
 * authority server-side. The `capabilities` prop only decides what is drawn.
 */
import { useMemo, useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Hand,
  Crown,
  Shield,
  UserMinus,
  UserPlus,
  MonitorUp,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MeetingCapabilities } from "@/lib/greenroom/permissions";
import { MeetingParticipant, ModerationAction } from "@/lib/greenroom/types";
import { cn } from "@/lib/utils";

export interface ParticipantsPanelProps {
  participants: MeetingParticipant[];
  selfUserId: string;
  hostUserId: string;
  capabilities: MeetingCapabilities;
  onModerate: (action: ModerationAction, targetUserId: string) => Promise<void>;
}

function RoleBadge({ role }: { role: MeetingParticipant["role"] }) {
  if (role === "host") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
        <Crown className="h-3 w-3" aria-hidden="true" />
        Host
      </span>
    );
  }
  if (role === "cohost") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
        <Shield className="h-3 w-3" aria-hidden="true" />
        Co-host
      </span>
    );
  }
  return null;
}

export default function ParticipantsPanel({
  participants,
  selfUserId,
  hostUserId,
  capabilities,
  onModerate,
}: ParticipantsPanelProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { waiting, joined } = useMemo(
    () => ({
      waiting: participants.filter((p) => p.state === "waiting"),
      joined: participants.filter((p) => p.state === "joined"),
    }),
    [participants]
  );

  const run = async (action: ModerationAction, userId: string) => {
    const key = `${action}:${userId}`;
    setBusyKey(key);
    try {
      await onModerate(action, userId);
    } finally {
      setBusyKey(null);
    }
  };

  const busy = (action: ModerationAction, userId: string) => busyKey === `${action}:${userId}`;

  return (
    <div className="flex h-full flex-col text-sm">
      {capabilities.admitParticipants && waiting.length > 0 && (
        <section className="border-b border-white/10 p-3" aria-labelledby="waiting-heading">
          <h3 id="waiting-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
            Waiting to join ({waiting.length})
          </h3>
          <ul className="space-y-2">
            {waiting.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-slate-100">{p.name}</span>
                <Button
                  size="sm"
                  className="h-7 bg-emerald-600 px-2 hover:bg-emerald-700"
                  onClick={() => run("admit", p.userId)}
                  disabled={busy("admit", p.userId)}
                  aria-label={`Admit ${p.name}`}
                >
                  {busy("admit", p.userId) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-white/20 bg-transparent px-2 text-slate-200 hover:bg-white/10"
                  onClick={() => run("reject", p.userId)}
                  disabled={busy("reject", p.userId)}
                  aria-label={`Deny ${p.name}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="min-h-0 flex-1 overflow-y-auto p-3" aria-labelledby="inroom-heading">
        <h3 id="inroom-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          In the meeting ({joined.length})
        </h3>

        {joined.length === 0 ? (
          <p className="text-xs text-slate-400">Nobody has joined yet.</p>
        ) : (
          <ul className="space-y-1">
            {joined.map((p) => {
              const isSelf = p.userId === selfUserId;
              const isOwner = p.userId === hostUserId;
              // The meeting owner is never moderatable — otherwise a co-host
              // could remove the teacher from their own class.
              const canModerate = capabilities.removeParticipants && !isOwner && !isSelf;

              return (
                <li
                  key={p.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-2 py-1.5",
                    "hover:bg-white/5"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-slate-100">
                    {p.name}
                    {isSelf && <span className="text-slate-400"> (you)</span>}
                  </span>

                  <RoleBadge role={p.role} />

                  {p.handRaised && (
                    <Hand className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-label="Hand raised" />
                  )}
                  {p.screenSharing && (
                    <MonitorUp
                      className="h-3.5 w-3.5 shrink-0 text-emerald-400"
                      aria-label="Sharing screen"
                    />
                  )}
                  {p.micOn ? (
                    <Mic className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-label="Unmuted" />
                  ) : (
                    <MicOff className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-label="Muted" />
                  )}
                  {p.camOn ? (
                    <Video className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-label="Camera on" />
                  ) : (
                    <VideoOff className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-label="Camera off" />
                  )}

                  {/* Moderation actions. Always in the DOM for keyboard users;
                      visually revealed on hover/focus to keep the list calm. */}
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    {capabilities.muteOthers && p.micOn && !isSelf && (
                      <button
                        type="button"
                        onClick={() => run("mute", p.userId)}
                        disabled={busy("mute", p.userId)}
                        title={`Mute ${p.name}`}
                        aria-label={`Mute ${p.name}`}
                        className="rounded p-1 text-slate-300 hover:bg-white/10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}

                    {capabilities.lowerOthersHands && p.handRaised && (
                      <button
                        type="button"
                        onClick={() => run("lowerHand", p.userId)}
                        disabled={busy("lowerHand", p.userId)}
                        title={`Lower ${p.name}'s hand`}
                        aria-label={`Lower ${p.name}'s hand`}
                        className="rounded p-1 text-slate-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        <Hand className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}

                    {capabilities.assignCoHost && !isOwner && !isSelf && (
                      <button
                        type="button"
                        onClick={() => run(p.role === "cohost" ? "demote" : "promote", p.userId)}
                        disabled={busy("promote", p.userId) || busy("demote", p.userId)}
                        title={p.role === "cohost" ? `Remove co-host from ${p.name}` : `Make ${p.name} co-host`}
                        aria-label={p.role === "cohost" ? `Remove co-host from ${p.name}` : `Make ${p.name} co-host`}
                        className="rounded p-1 text-slate-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        {p.role === "cohost" ? (
                          <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>
                    )}

                    {canModerate && (
                      <button
                        type="button"
                        onClick={() => run("remove", p.userId)}
                        disabled={busy("remove", p.userId)}
                        title={`Remove ${p.name} from the meeting`}
                        aria-label={`Remove ${p.name} from the meeting`}
                        className="rounded p-1 text-red-400 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      >
                        <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
