"use client";

/**
 * The meeting control bar.
 *
 * Which controls appear is driven entirely by `capabilitiesFor()` — the same
 * matrix the server enforces — so this component never decides policy itself.
 * Hiding a control here is a courtesy for the participant; the API refusing it
 * is the actual boundary.
 */
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MonitorX,
  Users,
  MessageSquare,
  Hand,
  Smile,
  Settings,
  PhoneOff,
  LayoutGrid,
  Presentation,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MeetingCapabilities } from "@/lib/greenroom/permissions";
import { StageLayout } from "./MeetingStage";
import { cn } from "@/lib/utils";

export interface MeetingControlsProps {
  capabilities: MeetingCapabilities;
  isHost: boolean;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  screenSharing: boolean;
  layout: StageLayout;
  participantCount: number;
  unreadMessages: number;
  waitingCount: number;
  panelOpen: "participants" | "chat" | "settings" | null;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleScreenShare: () => void;
  onToggleHand: () => void;
  onCycleLayout: () => void;
  onOpenPanel: (panel: "participants" | "chat" | "settings" | null) => void;
  onOpenReactions: () => void;
  onLeave: () => void;
  onEndMeeting: () => void;
}

/** A control-bar button with a consistent hit area, label and pressed state. */
function ControlButton({
  label,
  icon: Icon,
  onClick,
  danger,
  activeState,
  badge,
  disabled,
  pressed,
}: {
  label: string;
  icon: typeof Mic;
  onClick: () => void;
  danger?: boolean;
  activeState?: boolean;
  badge?: number;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "relative flex min-w-[4rem] flex-col items-center gap-1 rounded-lg px-3 py-2 text-[11px] font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
        "disabled:cursor-not-allowed disabled:opacity-40",
        danger
          ? "bg-red-600 text-white hover:bg-red-700"
          : activeState
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "text-slate-200 hover:bg-white/10"
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="hidden sm:block">{label}</span>
      {badge != null && badge > 0 && (
        <span
          className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
          aria-label={`${badge} new`}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

export default function MeetingControls(props: MeetingControlsProps) {
  const {
    capabilities,
    isHost,
    micOn,
    camOn,
    handRaised,
    screenSharing,
    layout,
    participantCount,
    unreadMessages,
    waitingCount,
    panelOpen,
  } = props;

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-1 border-t border-white/10 bg-slate-900/95 px-2 py-2 sm:gap-2 sm:px-4"
      role="toolbar"
      aria-label="Meeting controls"
    >
      <ControlButton
        label={micOn ? "Mute" : "Unmute"}
        icon={micOn ? Mic : MicOff}
        onClick={props.onToggleMic}
        activeState={micOn}
        pressed={micOn}
        // A room with self-unmute disabled leaves the button visible but
        // inert, so a muted participant can see *why* rather than hunting for
        // a control that vanished.
        disabled={!micOn && !capabilities.unmuteSelf}
      />

      <ControlButton
        label={camOn ? "Stop Video" : "Start Video"}
        icon={camOn ? Video : VideoOff}
        onClick={props.onToggleCam}
        activeState={camOn}
        pressed={camOn}
        disabled={!capabilities.enableCamera}
      />

      <ControlButton
        label={screenSharing ? "Stop Share" : "Share"}
        icon={screenSharing ? MonitorX : MonitorUp}
        onClick={props.onToggleScreenShare}
        activeState={screenSharing}
        pressed={screenSharing}
        disabled={!capabilities.shareScreen}
      />

      <ControlButton
        label="Participants"
        icon={Users}
        onClick={() => props.onOpenPanel(panelOpen === "participants" ? null : "participants")}
        activeState={panelOpen === "participants"}
        pressed={panelOpen === "participants"}
        badge={waitingCount}
      />

      <ControlButton
        label="Chat"
        icon={MessageSquare}
        onClick={() => props.onOpenPanel(panelOpen === "chat" ? null : "chat")}
        activeState={panelOpen === "chat"}
        pressed={panelOpen === "chat"}
        badge={unreadMessages}
        disabled={!capabilities.sendChat && unreadMessages === 0}
      />

      <ControlButton
        label={handRaised ? "Lower Hand" : "Raise Hand"}
        icon={Hand}
        onClick={props.onToggleHand}
        activeState={handRaised}
        pressed={handRaised}
        disabled={!capabilities.sendReactions}
      />

      <ControlButton
        label="React"
        icon={Smile}
        onClick={props.onOpenReactions}
        disabled={!capabilities.sendReactions}
      />

      <ControlButton
        label={layout === "grid" ? "Gallery" : layout === "speaker" ? "Speaker" : "Shared"}
        icon={layout === "grid" ? LayoutGrid : Presentation}
        onClick={props.onCycleLayout}
      />

      <ControlButton
        label="Settings"
        icon={Settings}
        onClick={() => props.onOpenPanel(panelOpen === "settings" ? null : "settings")}
        activeState={panelOpen === "settings"}
        pressed={panelOpen === "settings"}
      />

      <div className="mx-1 hidden h-8 w-px bg-white/10 sm:block" aria-hidden="true" />

      <Button
        type="button"
        onClick={props.onLeave}
        variant="outline"
        size="sm"
        className="border-white/20 bg-transparent text-slate-100 hover:bg-white/10"
      >
        <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Leave
      </Button>

      {isHost && (
        <Button
          type="button"
          onClick={props.onEndMeeting}
          size="sm"
          className="bg-red-600 text-white hover:bg-red-700"
        >
          <ShieldAlert className="mr-1.5 h-4 w-4" aria-hidden="true" />
          End for All
        </Button>
      )}

      <span className="sr-only" aria-live="polite">
        {participantCount} {participantCount === 1 ? "person" : "people"} in this meeting
      </span>
    </div>
  );
}
