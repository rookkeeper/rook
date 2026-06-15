import { REPO_ROOT } from "../paths.js";
import { BaseAgent, type BaseAgentOptions } from "./BaseAgent.js";
import type { AgentRestartMetadata, AgentSessionRecord } from "./sessionLog.js";

export interface CursorAgentOptions {
  command?: string;
  cwd?: string;
  startupTimeoutMs?: number;
  agentName?: string;
  /** Cursor model id (e.g. "default[]" for Auto, "composer-2.5" for Composer 2.5). Set after session/new via session/set_config_option. */
  model?: string;
}

function toBaseAgentOptions(options: CursorAgentOptions, restartMetadata?: AgentRestartMetadata): BaseAgentOptions {
  const cwd = options.cwd ?? REPO_ROOT;
  const cursorCommand = options.command?.trim() || "agent";

  return {
    command: cursorCommand,
    args: ["acp"],
    cwd,
    sessionCwd: typeof restartMetadata?.cwd === "string" ? restartMetadata.cwd : cwd,
    startupTimeoutMs: options.startupTimeoutMs,
    agentName: options.agentName,
  };
}

export class CursorAgent extends BaseAgent {
  private readonly cursorModel?: string;

  constructor(options: CursorAgentOptions = {}, restartMetadata?: AgentRestartMetadata) {
    super(toBaseAgentOptions(options, restartMetadata), restartMetadata);
    this.cursorModel = options.model?.trim() || undefined;
  }

  protected override async initialize(): Promise<void> {
    await super.initialize();
    await this.sendRequestWithTimeout("authenticate", { methodId: "cursor_login" }, this.options.startupTimeoutMs ?? 15_000);
  }

  protected override async registerSession(): Promise<AgentSessionRecord> {
    const record = await super.registerSession();
    if (this.cursorModel && this.sessionIdValue) {
      const result = await this.sendRequestWithTimeout(
        "session/set_config_option",
        { sessionId: this.sessionIdValue, configId: "model", value: this.cursorModel },
        this.options.startupTimeoutMs ?? 15_000,
      ) as { configOptions?: unknown };
      if (Array.isArray(result?.configOptions)) {
        this.emitConfigOptions(result.configOptions as never);
      }
    }
    return record;
  }
}
