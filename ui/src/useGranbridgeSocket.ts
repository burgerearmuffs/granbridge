import { useEffect, useRef, useCallback } from "react";
import { useStore } from "./store";
import type { Command, Event } from "./types";
import { soundManager } from "./sound/SoundManager";

export function useGranbridgeSocket(url = `ws://127.0.0.1:8787`) {
  const ws = useRef<WebSocket | null>(null);
  const apply = useStore((s) => s.applyEvent);
  const setConnection = useStore((s) => s.setConnection);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const sock = new WebSocket(url);
      ws.current = sock;
      sock.onopen = () => setConnection("connected");
      sock.onmessage = (m: MessageEvent) => {
        try {
          const event = JSON.parse(m.data) as Event;
          apply(event);
          soundManager.handleEvent(event);
        } catch { /* ignore malformed */ }
      };
      sock.onclose = () => {
        setConnection("disconnected");
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.current?.close(); };
  }, [url, apply, setConnection]);

  const send = useCallback((cmd: Command) => {
    if (ws.current && ws.current.readyState === 1) ws.current.send(JSON.stringify(cmd));
  }, []);

  return { send };
}
