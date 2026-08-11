export async function runSessionsCommand(args) {
  const serverUrl = (args.serverUrl || process.env.ROOK_SERVER_BASE_URL || "http://127.0.0.1:7665").replace(/\/$/, "");
  const authToken = args.authToken || process.env.ROOK_AUTH_TOKEN || "";
  const response = await fetch(`${serverUrl}/api/sessions`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);

  const sessions = Array.isArray(body?.sessions) ? body.sessions : [];
  const limit = args.limit || 20;
  const shown = sessions.slice(0, limit);

  if (shown.length === 0) {
    console.log("No sessions.");
  } else {
    for (const session of shown) {
      const id = session.sessionId || "?";
      const title = session.title || "(untitled)";
      const runtimeId = session.runtimeId || "?";
      const updated = session.updatedAt || "?";
      console.log(`${id}  ${runtimeId}  ${title}  ${updated}`);
    }
    if (sessions.length > limit) console.log(`... and ${sessions.length - limit} more (use --limit to adjust)`);
  }
}
