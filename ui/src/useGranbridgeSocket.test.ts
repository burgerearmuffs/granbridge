import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGranbridgeSocket } from "./useGranbridgeSocket";
import { useStore } from "./store";

class MockWS {
  static last: MockWS;
  static created = 0;
  onopen: any; onclose: any; onmessage: any; sent: string[] = []; readyState = 1;
  constructor(public url: string) { MockWS.last = this; MockWS.created++; }
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.(); }
}

beforeEach(() => {
  (globalThis as any).WebSocket = MockWS as any;
  MockWS.created = 0;
  useStore.getState().reset();
});

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

  it("reconnects with exponential backoff and resets after a successful open", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() => useGranbridgeSocket("ws://x"));
      expect(MockWS.created).toBe(1);

      // 1st close → retry after 500ms
      act(() => { MockWS.last.onclose?.(); });
      act(() => { vi.advanceTimersByTime(499); });
      expect(MockWS.created).toBe(1);
      act(() => { vi.advanceTimersByTime(1); });
      expect(MockWS.created).toBe(2);

      // 2nd consecutive close → 1000ms
      act(() => { MockWS.last.onclose?.(); });
      act(() => { vi.advanceTimersByTime(999); });
      expect(MockWS.created).toBe(2);
      act(() => { vi.advanceTimersByTime(1); });
      expect(MockWS.created).toBe(3);

      // a successful open resets the backoff → next close retries at 500ms again
      act(() => { MockWS.last.onopen?.(); });
      act(() => { MockWS.last.onclose?.(); });
      act(() => { vi.advanceTimersByTime(500); });
      expect(MockWS.created).toBe(4);

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps the backoff at 8s", () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useGranbridgeSocket("ws://x"));
      // Drive consecutive failures past the cap; delays go 500, 1k, 2k, 4k, 8k, 8k, …
      for (let i = 0; i < 8; i++) {
        act(() => { MockWS.last.onclose?.(); });
        act(() => { vi.advanceTimersByTime(8000); });
      }
      const before = MockWS.created;
      act(() => { MockWS.last.onclose?.(); });
      act(() => { vi.advanceTimersByTime(7999); });
      expect(MockWS.created).toBe(before);
      act(() => { vi.advanceTimersByTime(1); });
      expect(MockWS.created).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
