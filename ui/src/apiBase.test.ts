import { describe, it, expect, afterEach, vi } from "vitest";
import { apiBase } from "./apiBase";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("apiBase", () => {
  it("defaults to the local bridge HTTP server as an absolute URL", () => {
    // Must be absolute: the packaged app serves the UI from the Tauri asset origin,
    // where a relative /api/... never reaches the bridge on 127.0.0.1:8080.
    expect(apiBase()).toBe("http://127.0.0.1:8080");
  });

  it("honors a VITE_API_BASE override", () => {
    vi.stubEnv("VITE_API_BASE", "http://127.0.0.1:9999");
    expect(apiBase()).toBe("http://127.0.0.1:9999");
  });
});
