import { WebSocket } from "ws";

export async function runSessionsCommand(args) {
  const serverUrl = args.serverUrl || process.env.ROOK_SERVER_BASE_URL || "http://127.0.0.1:7665";
  const authToken = args.authToken || process.env.ROOK_AUTH_TOKEN || "";
  const webSocketUrl = serverUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "") + "/api/ws";
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const ws = new WebSocket(webSocketUrl, { headers });
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });

  let nextId = 1;
  const pending = new Map();
  const send = (method, params) => {
    const id = String(nextId++);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  ws.on("message", (data) => {
    const frame = JSON.parse(String(data));
    if (frame.id && pending.has(String(frame.id))) {
      const { resolve, reject } = pending.get(String(frame.id));
      pending.delete(String(frame.id));
      if (frame.error) reject(new Error(frame.error.message ?? "Request failed"));
      else resolve(frame.result ?? {});
    }
  });

  try {
    await send("initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "rook-cli", title: "Rook CLI", version: "0.1.0" } });
    const result = await send("session/list", {});
    const sessions = result?.sessions ?? [];
    const limit = args.limit || 20;
    const shown = sessions.slice(0, limit);

    if (shown.length === 0) {
      console.log("No sessions.");
    } else {
      for (const session of shown) {
        const id = session.sessionId || session.id || "?";
        const title = session.title || session.name || "(untitled)";
        const runtimeId = session._meta?.runtimeId || session.agent || "?";
        const updated = session.updatedAt || "?";
        console.log(`${id}  ${runtimeId}  ${title}  ${updated}`);
      }
      if (sessions.length > limit) console.log(`... and ${sessions.length - limit} more (use --limit to adjust)`);
    }
  } finally {
    ws.close();
  }
}
