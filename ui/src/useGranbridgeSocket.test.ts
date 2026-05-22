import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGranbridgeSocket } from "./useGranbridgeSocket";
import { useStore } from "./store";

class MockWS {
  static last: MockWS;
  onopen: any; onclose: any; onmessage: any; sent: string[] = []; readyState = 1;
  constructor(public url: string) { MockWS.last = this; }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
}

beforeEach(() => { (globalThis as any).WebSocket = MockWS as any; useStore.getState().reset(); });

describe("useGranbridgeSocket", () => {
  it("updates store on game_state message and sends commands", () => {
    const { result } = renderHook(() => useGranbridgeSocket("ws://x"));
    act(() => { MockWS.last.onopen?.(); });
    expect(useStore.getState().connection).toBe("connected");
    act(() => { MockWS.last.onmessage?.({ data: JSON.stringify({ type:"game_state", state:{ mode:"x01", mode_view:{} } }) }); });
    expect(useStore.getState().gameState?.mode).toBe("x01");
    act(() => { result.current.send({ command: "next_player" }); });
    expect(JSON.parse(MockWS.last.sent[0]).command).toBe("next_player");
  });
});
