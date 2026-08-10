"use client";

/**
 * The meeting's main viewing area.
 *
 * Three layouts, chosen by what is happening rather than by a user setting —
 * the right view for "someone is presenting" is never the gallery:
 *
 *   - `screen`  — a screen share owns the stage, everyone else becomes a strip.
 *   - `speaker` — one person large, everyone else a strip.
 *   - `grid`    — equal tiles.
 *
 * The grid is capped by `MAX_VISIBLE_TILES`. Rendering 30 `<video>` elements
 * is what actually janks a call, and a tile too small to recognise a face is
 * not worth its decode cost; overflow is reported as a count instead.
 */
import { useMemo } from "react";
import VideoTile from "./VideoTile";
import { PeerConnectionState } from "@/lib/greenroom/mesh";
import { MeetingParticipant } from "@/lib/greenroom/types";
import { cn } from "@/lib/utils";

export type StageLayout = "grid" | "speaker" | "screen";

export interface StageTile {
  userId: string;
  name: string;
  stream: MediaStream | null;
  isLocal: boolean;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  screenSharing: boolean;
  role: MeetingParticipant["role"];
  connectionState: PeerConnectionState;
}

/** Beyond this the tiles are too small to be useful and too costly to decode. */
export const MAX_VISIBLE_TILES = 12;

export interface MeetingStageProps {
  tiles: StageTile[];
  layout: StageLayout;
  /** Whoever owns the main stage (screen sharer, or active/pinned speaker). */
  featuredUserId?: string | null;
}

/**
 * Column count for an equal grid of `count` tiles.
 *
 * Chosen so the last row is never a single stranded tile where avoidable —
 * 3 across for 5-9 people reads better than 4 across leaving one alone.
 */
export function gridColumnsFor(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 9) return "grid-cols-2 lg:grid-cols-3";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";
}

export default function MeetingStage({ tiles, layout, featuredUserId }: MeetingStageProps) {
  const { featured, others, hidden } = useMemo(() => {
    const featuredTile =
      tiles.find((t) => t.userId === featuredUserId) ||
      (layout !== "grid" ? tiles[0] : undefined);

    if (layout === "grid") {
      const visible = tiles.slice(0, MAX_VISIBLE_TILES);
      return { featured: null, others: visible, hidden: tiles.length - visible.length };
    }

    const rest = tiles.filter((t) => t.userId !== featuredTile?.userId);
    const visible = rest.slice(0, MAX_VISIBLE_TILES);
    return { featured: featuredTile || null, others: visible, hidden: rest.length - visible.length };
  }, [tiles, layout, featuredUserId]);

  if (tiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl bg-slate-900 text-sm text-slate-400">
        Waiting for people to join…
      </div>
    );
  }

  if (layout === "grid") {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className={cn("grid flex-1 auto-rows-fr gap-2", gridColumnsFor(others.length))}>
          {others.map((tile) => (
            <VideoTile key={tile.userId} {...tile} />
          ))}
        </div>
        {hidden > 0 && (
          <p className="text-center text-xs text-slate-400">
            +{hidden} more {hidden === 1 ? "person" : "people"} in this meeting
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1">
        {featured && (
          <VideoTile
            {...featured}
            active
            className="h-full w-full"
          />
        )}
      </div>

      {others.length > 0 && (
        <div
          className="flex shrink-0 gap-2 overflow-x-auto pb-1"
          // A horizontal strip is the one place a scroll region is right: the
          // stage must not shrink as more people join.
          role="list"
          aria-label="Other participants"
        >
          {others.map((tile) => (
            <div key={tile.userId} role="listitem" className="h-24 w-40 shrink-0 sm:h-28 sm:w-48">
              <VideoTile {...tile} className="h-full w-full" />
            </div>
          ))}
          {hidden > 0 && (
            <div className="flex h-24 w-40 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-xs text-slate-300 sm:h-28 sm:w-48">
              +{hidden} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
