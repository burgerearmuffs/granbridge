/**
 * acquireLocalMedia — failure-reason reporting (jsdom has no real mediaDevices,
 * so every branch is driven through stubs).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { acquireLocalMedia, getLocalStream } from "./media";
import { mediaNoticeFor } from "./session";

const realMediaDevices = navigator.mediaDevices;

function stubGetUserMedia(impl: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: impl },
    configurable: true,
  });
}

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    value: realMediaDevices,
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe("acquireLocalMedia", () => {
  it("reports 'unsupported' when mediaDevices is absent", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    expect(await acquireLocalMedia({ video: true, audio: true }))
      .toEqual({ stream: null, failure: "unsupported" });
  });

  it("skips the request entirely when nothing is requested", async () => {
    const gum = vi.fn();
    stubGetUserMedia(gum);
    expect(await acquireLocalMedia({ video: false, audio: false }))
      .toEqual({ stream: null, failure: null });
    expect(gum).not.toHaveBeenCalled();
  });

  it("reports 'denied' on NotAllowedError", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubGetUserMedia(() => Promise.reject(new DOMException("nope", "NotAllowedError")));
    expect((await acquireLocalMedia()).failure).toBe("denied");
  });

  it("reports 'failed' on any other error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubGetUserMedia(() => Promise.reject(new DOMException("busy", "NotReadableError")));
    expect((await acquireLocalMedia()).failure).toBe("failed");
  });

  it("returns the stream with no failure on success", async () => {
    const fake = { id: "s1" } as unknown as MediaStream;
    stubGetUserMedia(() => Promise.resolve(fake));
    expect(await acquireLocalMedia()).toEqual({ stream: fake, failure: null });
  });

  it("getLocalStream stays a stream-or-null view of the same flow", async () => {
    const fake = { id: "s2" } as unknown as MediaStream;
    stubGetUserMedia(() => Promise.resolve(fake));
    expect(await getLocalStream()).toBe(fake);
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    expect(await getLocalStream()).toBeNull();
  });
});

describe("mediaNoticeFor", () => {
  it("maps failures to user-facing messages and null to undefined", () => {
    expect(mediaNoticeFor(null)).toBeUndefined();
    expect(mediaNoticeFor("denied")).toMatch(/permission denied/i);
    expect(mediaNoticeFor("unsupported")).toMatch(/isn't available/i);
    expect(mediaNoticeFor("failed")).toMatch(/another app/i);
  });
});
