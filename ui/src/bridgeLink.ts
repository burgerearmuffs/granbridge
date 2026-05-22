/**
 * bridgeLink — a tiny shared pub/sub bridging the single Granbridge bridge
 * WebSocket (owned by useGranbridgeSocket) to consumers that are NOT on the
 * App -> Controls prop path, e.g. the Multiplayer view's RemoteMatch.
 *
 *   useGranbridgeSocket: each inbound event -> bridgeLink.emit(event)
 *                        on mount           -> bridgeLink.setSender(send)
 *   RemoteMatch:         bridge.onEvent(...) / bridge.send(...)
 *
 * Satisfies remoteMatch.BridgeLike (send + onEvent).
 */
import type { Command, Event } from "./types";

type Listener = (e: Event) => void;

const listeners = new Set<Listener>();
let sender: ((cmd: Command) => void) | null = null;

export const bridgeLink = {
  emit(e: Event): void {
    for (const l of listeners) l(e);
  },
  onEvent(cb: Listener): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  setSender(fn: ((cmd: Command) => void) | null): void {
    sender = fn;
  },
  send(cmd: Command): void {
    sender?.(cmd);
  },
};
