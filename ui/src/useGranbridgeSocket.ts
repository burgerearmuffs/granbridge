import { useEffect, useRef, useCallback } from "react";
import { useStore } from "./store";
import type { Command, Event } from "./types";
import { soundManager } from "./sound/SoundManager";
import { bridgeLink } from "./bridgeLink";

export function useGranbridgeSocket(url = `ws://127.0.0.1:8787`) {
  const ws = useRef<WebSocket | null>(null);
  const apply = useStore((s) => s.applyEvent);
  const setConnection = useStore((s) => s.setConnection);

  useEffect(() => {
    let closed = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const sock = new WebSocket(url);
      ws.current = sock;
      sock.onopen = () => { attempts = 0; setConnection("connected"); };
      sock.onmessage = (m: MessageEvent) => {
        try {
          const event = JSON.parse(m.data) as Event;
          apply(event);
          soundManager.handleEvent(event);
          bridgeLink.emit(event);
        } catch { /* ignore malformed */ }
      };
      sock.onclose = () => {
        setConnection("disconnected");
        // Exponential backoff (0.5s → 8s cap) so a dead bridge isn't hammered.
        if (!closed) retry = setTimeout(connect, Math.min(8000, 500 * 2 ** attempts++));
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.current?.close(); };
  }, [url, apply, setConnection]);

  const send = useCallback((cmd: Command) => {
    if (ws.current && ws.current.readyState === 1) ws.current.send(JSON.stringify(cmd));
  }, []);

  // Expose the sender to non-prop-path consumers (Multiplayer view / RemoteMatch).
  useEffect(() => {
    bridgeLink.setSender(send);
    return () => bridgeLink.setSender(null);
  }, [send]);

  return { send };
}
