/**
 * A small, agent-agnostic registry of ambient "context" blocks keyed by source
 * (e.g. "location", later "voice", "foreground-app", "home"). `BaseAgent` owns one
 * and injects its rendered form into the next prompt turn, so every agent (Pi,
 * Claude, Cursor, generic) receives context identically through the shared ACP
 * `session/prompt` path — no per-agent system-prompt plumbing.
 */
export class AgentContext {
  private readonly entries = new Map<string, string>();

  /**
   * Set or clear the block for `key`. A null/blank value removes it.
   * Returns whether anything actually changed (so callers can avoid re-injecting).
   */
  set(key: string, text: string | null | undefined): boolean {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) {
      return this.entries.delete(key);
    }
    if (this.entries.get(key) === trimmed) return false;
    this.entries.set(key, trimmed);
    return true;
  }

  /** True when there is no context to inject. */
  get isEmpty(): boolean {
    return this.entries.size === 0;
  }

  /**
   * Compose the present entries into a single text block, each labelled by source.
   * Returns null when empty (nothing to inject).
   */
  render(): string | null {
    if (this.entries.size === 0) return null;
    return [...this.entries.entries()]
      .map(([key, text]) => `<context source="${key}">\n${text}\n</context>`)
      .join("\n");
  }
}
