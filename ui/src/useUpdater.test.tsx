import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdater } from "./useUpdater";

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("useUpdater", () => {
  it("surfaces an available update", async () => {
    (check as Mock).mockResolvedValue({
      version: "0.1.2",
      body: "Bug fixes",
      downloadAndInstall: vi.fn(),
    });
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    expect(result.current.version).toBe("0.1.2");
    expect(result.current.notes).toBe("Bug fixes");
  });

  it("stays idle when there is no update", async () => {
    (check as Mock).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(result.current.phase).toBe("idle");
  });

  it("downloads then relaunches on startUpdate", async () => {
    const downloadAndInstall = vi.fn(async (cb: (e: unknown) => void) => {
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 50 } });
      cb({ event: "Progress", data: { chunkLength: 50 } });
      cb({ event: "Finished" });
    });
    (check as Mock).mockResolvedValue({ version: "0.1.2", body: null, downloadAndInstall });
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    act(() => result.current.startUpdate());
    await waitFor(() => expect(relaunch).toHaveBeenCalled());
    expect(downloadAndInstall).toHaveBeenCalled();
    expect(result.current.progress).toBe(1);
  });

  it("fails silently when the check rejects", async () => {
    (check as Mock).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toContain("offline");
  });

  it("no-ops outside Tauri", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => {});
    expect(check).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("dismiss hides the banner state", async () => {
    (check as Mock).mockResolvedValue({ version: "0.1.2", body: null, downloadAndInstall: vi.fn() });
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    act(() => result.current.dismiss());
    expect(result.current.phase).toBe("dismissed");
  });
});
