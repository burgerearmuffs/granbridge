// ui/src/multiplayer/remoteMatch.matchid.test.ts
import { describe, it, expect, vi } from "vitest";
import { RemoteMatch } from "./remoteMatch";
import type { Command, Event } from "../types";

function fakePeer() {
  const sent: unknown[] = [];
  return {
    sent,
    sendData(o: unknown) { sent.push(o); },
    onDataMessage: (_p: string, _o: unknown) => {},
    onChannelOpen: (_p: string) => {},
  };
}
function fakeBridge() {
  return { send(_c: Command) {}, onEvent(_cb: (e: Event) => void) { return () => {}; } };
}

describe("remote match_id sharing", () => {
  it("host mints + sends a matchid and notifies onMatchId on startGame", () => {
    const peer = fakePeer();
    const onMatchId = vi.fn();
    const rm = new RemoteMatch({ role: "host", peer, bridge: fakeBridge(),
      applyState: () => {}, onMatchId });
    rm.start();
    rm.startGame("x01", ["Ann", "Bob"], {});
    const sentIds = peer.sent.filter((m) => (m as { t?: string }).t === "matchid");
    expect(sentIds).toHaveLength(1);
    const id = (sentIds[0] as { id: string }).id;
    expect(onMatchId).toHaveBeenCalledWith(id);
  });

  it("guest forwards a received matchid to onMatchId", () => {
    const peer = fakePeer();
    const onMatchId = vi.fn();
    const rm = new RemoteMatch({ role: "guest", peer, bridge: fakeBridge(),
      applyState: () => {}, onMatchId });
    rm.start();
    peer.onDataMessage("x", { t: "matchid", id: "shared-1" });
    expect(onMatchId).toHaveBeenCalledWith("shared-1");
  });
});

it("does not put writeToken in the card it sends", () => {
  const peer = fakePeer();
  const rm = new RemoteMatch({
    role: "guest", peer, bridge: fakeBridge(), applyState: () => {},
    selfCard: {
      profile: { id: "me", name: "Me", avatar: { color: "#abc" }, writeToken: "SECRET" } as unknown as import("./player").Profile,
      summary: { threeDartAvg: 0, wins: 0, gamesPlayed: 0 },
    },
  });
  rm.start();
  peer.onChannelOpen("x"); // guest sends its card on channel open
  const card = peer.sent.find((m) => (m as { t?: string }).t === "card") as { profile: Record<string, unknown> };
  expect(card).toBeTruthy();
  expect(card.profile).not.toHaveProperty("writeToken");
  expect(card.profile.id).toBe("me");
});
