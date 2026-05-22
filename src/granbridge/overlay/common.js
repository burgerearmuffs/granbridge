// GRANBRIDGE overlay helper: connect to the bridge WS with auto-reconnect.
// Usage: connectGranbridge((event) => { ... }, { port: 8787 });
function connectGranbridge(onEvent, opts) {
  const port = (opts && opts.port) || 8787;
  let ws;
  function connect() {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (e) { /* ignore */ } };
    ws.onclose = () => setTimeout(connect, 1000);
    ws.onopen = () => onEvent({ type: "_open" });
  }
  connect();
  return { close: () => ws && ws.close() };
}
window.connectGranbridge = connectGranbridge;
