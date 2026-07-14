import { fetchJson } from "../client.mjs";

export async function runEnvironmentsCommand(args) {
  const serverUrl = args.serverUrl || process.env.ROOK_SERVER_BASE_URL || "http://127.0.0.1:7665";
  const authToken = args.authToken || process.env.ROOK_AUTH_TOKEN || "";
  const limit = args.limit || 20;

  const data = await fetchJson(`${serverUrl.replace(/\/$/, "")}/api/diagnostics/environments`, authToken);
  const environments = data?.environments ?? [];

  const shown = environments.slice(0, limit);

  if (shown.length === 0) {
    console.log("No environments.");
  } else {
    for (const env of shown) {
      const id = env.environmentId || "?";
      const status = env.status || "?";
      const bundles = Array.isArray(env.bundles) ? env.bundles.length : (env.bundleIds?.length ?? 0);
      const sourceName = env.record?.sourceName || env.info?.sourceName || "";
      console.log(`${id}  ${status}  bundles:${bundles}  ${sourceName}`);
    }
    if (environments.length > limit) console.log(`... and ${environments.length - limit} more (use --limit to adjust)`);
  }
}
