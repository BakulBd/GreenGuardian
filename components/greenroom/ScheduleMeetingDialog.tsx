"use client";

/**
 * Schedule / edit a Green Room class.
 *
 * Doubles as the edit form: passing `existing` switches it to update mode.
 * Two forms for the same fields is how they drift, and the fields a teacher
 * sets when scheduling are exactly the ones they later want to change.
 */
import { FormEvent, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_MEETING_SETTINGS } from "@/lib/greenroom/constants";
import { Meeting, MeetingSettings } from "@/lib/greenroom/types";
import { toMillis } from "@/lib/greenroom/codes";

export interface ScheduleMeetingDialogProps {
  open: boolean;
  saving?: boolean;
  existing?: Meeting | null;
  onClose: () => void;
  onSubmit: (values: {
    title: string;
    description: string;
    scheduledStart: string;
    durationMinutes: number;
    settings: MeetingSettings;
  }) => void;
}

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` in LOCAL time, not an ISO string. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

const SETTING_LABELS: { key: keyof MeetingSettings; label: string; hint: string }[] = [
  { key: "waitingRoom", label: "Waiting room", hint: "Admit each person yourself before they join." },
  { key: "joinBeforeHost", label: "Join before host", hint: "Let students enter before you start." },
  { key: "allowParticipantUnmute", label: "Students can unmute", hint: "Otherwise only you can unmute them." },
  { key: "allowParticipantScreenShare", label: "Students can share screen", hint: "Off is the safer default." },
  { key: "allowChat", label: "Chat", hint: "Let everyone use the meeting chat." },
  { key: "allowReactions", label: "Reactions & raise hand", hint: "Emoji reactions and hand raising." },
  { key: "audioOnly", label: "Audio only", hint: "No video at all — supports more participants." },
];

export default function ScheduleMeetingDialog({
  open,
  saving = false,
  existing,
  onClose,
  onSubmit,
}: ScheduleMeetingDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [settings, setSettings] = useState<MeetingSettings>(DEFAULT_MEETING_SETTINGS);

  // Reset whenever the dialog opens so a cancelled edit never leaks into the
  // next one.
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setTitle(existing.title || "");
      setDescription(existing.description || "");
      const ms = toMillis(existing.scheduledStart);
      setScheduledStart(toLocalInputValue(ms ? new Date(ms) : new Date()));
      setDurationMinutes(existing.durationMinutes || 60);
      setSettings({ ...DEFAULT_MEETING_SETTINGS, ...existing.settings });
    } else {
      const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
      inAnHour.setMinutes(0, 0, 0);
      setTitle("");
      setDescription("");
      setScheduledStart(toLocalInputValue(inAnHour));
      setDurationMinutes(60);
      setSettings(DEFAULT_MEETING_SETTINGS);
    }
  }, [open, existing]);

  // Escape closes — expected of any modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      // datetime-local has no timezone; the Date constructor reads it as local
      // and toISOString converts to UTC for the API.
      scheduledStart: new Date(scheduledStart).toISOString(),
      durationMinutes,
      settings,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 id="schedule-title" className="text-lg font-semibold text-gray-900">
            {existing ? "Edit class" : "Schedule a class"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="gr-title">Class title *</Label>
            <Input
              id="gr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Data Structures — Week 3"
              required
              maxLength={200}
            />
          </div>

          <div>
            <Label htmlFor="gr-description">Description</Label>
            <Textarea
              id="gr-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What will this class cover?"
              rows={2}
              maxLength={2000}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="gr-start">Starts *</Label>
              <Input
                id="gr-start"
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="gr-duration">Duration (minutes) *</Label>
              <Input
                id="gr-duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <fieldset className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-sm font-medium text-gray-700">Meeting options</legend>
            <div className="space-y-2">
              {SETTING_LABELS.map(({ key, label, hint }) => (
                <label key={key} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(settings[key])}
                    onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="font-medium text-gray-800">{label}</span>
                    <span className="block text-xs text-gray-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !title.trim()}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {existing ? "Save changes" : "Schedule class"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
