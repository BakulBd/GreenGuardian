"use client";

/**
 * In-meeting chat.
 *
 * Autoscroll only follows when the reader is already at the bottom — yanking
 * someone away from a message they are reading because a new one arrived is
 * the classic chat annoyance, and during a class the scrollback is often the
 * point (a link the teacher posted five minutes ago).
 */
import { FormEvent, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_MESSAGE_LENGTH } from "@/lib/greenroom/constants";
import { MeetingMessage } from "@/lib/greenroom/types";
import { toMillis } from "@/lib/greenroom/codes";
import { cn } from "@/lib/utils";

export interface ChatPanelProps {
  messages: MeetingMessage[];
  selfUserId: string;
  canSend: boolean;
  onSend: (text: string) => Promise<void>;
}

function timeOf(value: any): string {
  const ms = toMillis(value);
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPanel({ messages, selfUserId, canSend, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottom = useRef(true);

  // Track whether the reader is at the bottom BEFORE the new message paints.
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottom.current = distance < 60;
  };

  useEffect(() => {
    if (!pinnedToBottom.current) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      await onSend(text);
      setDraft("");
      pinnedToBottom.current = true;
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
        role="log"
        aria-label="Meeting chat"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-slate-400">No messages yet.</p>
        ) : (
          messages.map((message) => {
            if (message.type === "system") {
              return (
                <p key={message.id} className="text-center text-[11px] italic text-slate-400">
                  {message.text}
                </p>
              );
            }
            const isSelf = message.senderId === selfUserId;
            return (
              <div key={message.id} className={cn("text-sm", isSelf && "text-right")}>
                <p className="text-[11px] text-slate-400">
                  <span className="font-medium text-slate-300">
                    {isSelf ? "You" : message.senderName}
                  </span>
                  {" · "}
                  {timeOf(message.createdAt)}
                </p>
                <p
                  className={cn(
                    "mt-0.5 inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-left",
                    isSelf ? "bg-emerald-600 text-white" : "bg-white/10 text-slate-100"
                  )}
                >
                  {message.text}
                </p>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t border-white/10 p-2">
        <label htmlFor="greenroom-chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="greenroom-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes a new line — the convention
            // everyone already has muscle memory for.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          rows={1}
          disabled={!canSend || sending}
          placeholder={canSend ? "Type a message…" : "Chat is off for this meeting"}
          className="max-h-24 min-h-[2.25rem] flex-1 resize-y rounded-lg border border-white/15 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!canSend || sending || !draft.trim()}
          className="h-9 bg-emerald-600 hover:bg-emerald-700"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
