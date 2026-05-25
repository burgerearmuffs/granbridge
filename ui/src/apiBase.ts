/**
 * Absolute base URL for the local bridge's HTTP server (the StaticServer on port 8080).
 *
 * Why absolute, not a relative "/api/...": the packaged Tauri app serves the UI from the
 * asset protocol (origin tauri://localhost), so a relative fetch resolves against that
 * origin and never reaches the bridge. The WebSocket client uses an absolute
 * ws://127.0.0.1:8787 for the same reason. Override with VITE_API_BASE for dev.
 */
export function apiBase(): string {
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const nodeEnv =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return metaEnv["VITE_API_BASE"] ?? nodeEnv["VITE_API_BASE"] ?? "http://127.0.0.1:8080";
}
