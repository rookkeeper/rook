import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AgentRuntimeProfile } from "../config/agentRuntimes.js";
import type { JsonObject, RuntimeLaunchPlan, RuntimeLaunchPlanner, SessionRuntimeConfiguration } from "./SessionRuntime.js";

/** Resolves provider-specific startup into a process plan, not a runtime subclass. */
export const runtimeLaunchPlan: RuntimeLaunchPlanner = (profile, repoRoot, configuration) => {
  const cwd = profile.cwd ? path.resolve(repoRoot, profile.cwd) : repoRoot;
  if (profile.type === "pi") {
    return {
      command: "node",
      args: [path.join(repoRoot, "server", "node_modules", "pi-acp", "dist", "index.js")],
      cwd,
      env: { ...(profile.env ?? {}), PI_ACP_PI_COMMAND: piLauncher(profile, repoRoot, configuration) },
    };
  }
  if (profile.type === "claude") {
    return {
      command: "node",
      args: [path.join(repoRoot, "server", "node_modules", "@agentclientprotocol", "claude-agent-acp", "dist", "index.js")],
      cwd,
      env: { ...(profile.env ?? {}), CLAUDE_CODE_EXECUTABLE: profile.command?.trim() || "claude" },
    };
  }
  if (profile.type === "cursor") {
    return { command: profile.command?.trim() || "agent", args: ["acp"], cwd, env: profile.env };
  }
  return { command: profile.command?.trim() || "node", args: profile.args ?? [], cwd, env: profile.env };
};

/** Provider-specific session setup remains a data transformation at the edge. */
export function runtimeSessionParams(profile: AgentRuntimeProfile, params: JsonObject, configuration?: SessionRuntimeConfiguration): JsonObject {
  if (profile.type !== "claude") return params;
  const options = claudeOptions(profile.args ?? []);
  if (configuration?.appendSystemPrompt) options.extraArgs = { "append-system-prompt": configuration.appendSystemPrompt };
  const mcpServers = profile.mcpServers ?? (Array.isArray(params.mcpServers) ? params.mcpServers : []);
  return {
    ...params,
    mcpServers,
    ...(Object.keys(options).length > 0 ? { _meta: { claudeCode: { options } } } : {}),
  };
}

function piLauncher(profile: AgentRuntimeProfile, repoRoot: string, configuration: SessionRuntimeConfiguration): string {
  const generatedDir = path.join(repoRoot, ".var", "rook", "generated", "pi-launchers");
  mkdirSync(generatedDir, { recursive: true });
  const skillPaths = [...new Set([...(profile.skillPaths ?? []), ...configuration.skillPaths])];
  const extensionPaths = [...new Set([...(profile.extensionPaths ?? []), ...configuration.extensionPaths])];
  const spec = JSON.stringify({ command: profile.command?.trim() || "pi", args: profile.args ?? [], skillPaths, extensionPaths, appendSystemPrompt: configuration.appendSystemPrompt ?? "" });
  const digest = createHash("sha256").update(spec).digest("hex").slice(0, 12);
  const launcher = path.join(generatedDir, `pi-runtime-${digest}.mjs`);
  writeFileSync(launcher, `#!/usr/bin/env node
import { spawn } from "node:child_process";
const child = spawn(${JSON.stringify(profile.command?.trim() || "pi")}, [...${JSON.stringify(profile.args ?? [])}, ...${JSON.stringify(extensionPaths)}.flatMap((item) => ["-e", item]), ...${JSON.stringify(skillPaths)}.flatMap((item) => ["--skill", item]), ...${JSON.stringify(configuration.appendSystemPrompt ?? "")} ? ["--append-system-prompt", ${JSON.stringify(configuration.appendSystemPrompt ?? "")}] : [], ...process.argv.slice(2)], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
child.on("exit", (code, signal) => signal ? process.kill(process.pid, signal) : process.exit(code ?? 0));
child.on("error", (error) => { process.stderr.write(String(error) + "\\n"); process.exit(1); });
`, "utf8");
  chmodSync(launcher, 0o755);
  return launcher;
}

function claudeOptions(args: string[]): JsonObject {
  const options: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--agent" && value) {
      options.agent = value;
      index += 1;
    } else if (flag === "--agents" && value) {
      try {
        options.agents = JSON.parse(value) as JsonObject;
        index += 1;
      } catch {
        throw new Error("Claude runtime --agents value must be valid JSON.");
      }
    } else if (flag?.startsWith("--")) {
      throw new Error(`Unsupported Claude runtime arg: ${flag}`);
    }
  }
  return options;
}
