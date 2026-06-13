/**
 * ChatPanel — in-room text chat over the match data channel.
 *
 * Collapsible: collapsed it shows a "Chat" toggle with an unread badge; open it
 * shows the transcript (auto-scrolled to the newest line) and a send box.
 * Messages render as plain text — React escaping is the sanitizer.
 */

import { useEffect, useRef, useState } from "react";
import { useMpStore } from "../multiplayer/store";
import { mpSession } from "../multiplayer/session";
import { CHAT_MAX_LEN } from "../multiplayer/remoteMatch";

export function ChatPanel({ startOpen = false, readOnly = false }: { startOpen?: boolean; readOnly?: boolean }) {
  const messages = useMpStore((s) => s.chatMessages);
  const unread = useMpStore((s) => s.chatUnread);
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // Open panel = messages are being read.
  useEffect(() => {
    if (open) useMpStore.getState().clearChatUnread();
  }, [open, messages.length]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, open]);

  const send = () => {
    if (!draft.trim()) return;
    mpSession.sendChat(draft);
    setDraft("");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={unread > 0 ? `Open chat, ${unread} unread` : "Open chat"}
        className="relative px-4 py-2 rounded-lg bg-neutral-800 text-sm text-neutral-300 hover:bg-neutral-700"
      >
        💬 Chat
        {unread > 0 && (
          <span
            data-testid="chat-unread"
            className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-amber-400 text-neutral-900 text-xs font-bold flex items-center justify-center"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">Chat</span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Collapse chat"
          className="text-neutral-500 hover:text-neutral-200 text-sm font-bold"
        >
          —
        </button>
      </div>
      <div
        ref={listRef}
        role="log"
        aria-label="Chat messages"
        className="max-h-40 min-h-20 overflow-y-auto px-3 py-2 space-y-1 text-sm"
      >
        {messages.length === 0 && (
          <p className="text-neutral-600 text-xs">
            {readOnly ? "Player chat will appear here." : "Say hi — messages stay between you two."}
          </p>
        )}
        {messages.map((m, i) => (
          <p key={`${m.ts}-${i}`} className="break-words">
            <span className={m.self ? "text-amber-300 font-semibold" : "text-sky-300 font-semibold"}>
              {m.self ? "You" : m.name || "Opponent"}:
            </span>{" "}
            <span className="text-neutral-200">{m.text}</span>
          </p>
        ))}
      </div>
      {!readOnly && (
      <div className="flex gap-2 p-2 border-t border-neutral-800">
        <input
          type="text"
          value={draft}
          maxLength={CHAT_MAX_LEN}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Message…"
          aria-label="Chat message"
          className="flex-1 bg-neutral-800 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          onClick={send}
          disabled={!draft.trim()}
          aria-label="Send chat message"
          className="px-3 py-1.5 rounded-lg bg-amber-400 text-neutral-900 text-sm font-bold hover:bg-amber-300 disabled:opacity-40"
        >
          Send
        </button>
      </div>
      )}
    </div>
  );
}
