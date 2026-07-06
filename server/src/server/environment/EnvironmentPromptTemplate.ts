/**
 * Templated system-prompt injection for entered environments.
 *
 * This is the canonical place to see and modify what gets injected into the
 * agent's system message whenever one or more environments are entered. The
 * data is gathered by EnvironmentManager.runtimeInstructionsForSession and
 * passed here as a fully-resolved structure -- no filesystem or network I/O
 * happens inside this module.
 *
 * The companion RookIdentityPrompt (RookIdentityPrompt.ts) is combined with
 * this output by EnvironmentManager.runtimeInstructionsForSession.
 *
 * Style note: Rook never uses em-dashes. Use " -- " instead.
 */

export interface EnvironmentPromptEntry {
  /** Stable environment id, e.g. "web:example.com". */
  environmentId: string;
  /** Environment metadata (title, tags, vault name, etc.). */
  metadata: Record<string, unknown>;
  /** Human-readable source name, e.g. "Arc", "Obsidian". */
  sourceName?: string;
  /** The canonical URL that produced this environment. */
  canonicalSourceUrl?: string;
  /** Ambient context pushed into the agent on enter (e.g. "The user is reading docs"). */
  contextText?: string;
  /** Absolute path to the user's personal binding bundle for this environment. */
  bindingDir: string;
  /** Absolute path to the user's skill-authoring directory for this environment. */
  skillsDir: string;
  /** Skill directories that already exist under skillsDir. */
  existingSkills: string[];
  /** Bundles belonging to this environment that carry an AGENTS.md file. */
  agentsMdBundles: Array<{
    bundleId: string;
    content: string;
  }>;
}

// -- helpers -------------------------------------------------------------------

function jsonBlock(value: Record<string, unknown>): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function skillsList(names: string[]): string {
  return names.length > 0 ? names.map((s) => `\`${s}\``).join(", ") : "(none yet)";
}

function bundleLabel(id: string): string {
  return id === "default" ? "personal" : id;
}

function agentsMdBlock(bundles: EnvironmentPromptEntry["agentsMdBundles"]): string {
  if (bundles.length === 0) return "";
  const blocks = bundles.map(
    ({ bundleId, content }) =>
      `**${bundleLabel(bundleId)}**\n\n${content
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n")}`,
  );
  return `#### Environment instructions:\n${blocks.join("\n\n")}`;
}

// -- intro (rendered once, above all environment entries) ----------------------

function renderIntro(): string {
  return `## Attaching memories and capabilities to an environment

You have entered one or more Rook environments. Because you are Rook you can **write new capabilities directly into the user's personal bundle** for each environment. These capabilities will be loaded every time you enter this environment in the future.

### Directory layout of a personal bundle

Each environment has exactly one writable personal bundle. It lives at:

\`\`\`
~/.rook/environment-repository/<kind>/<path>/.bundles/personal/
\`\`\`

Inside the personal bundle you can write three kinds of assets:

| Asset       | Path                                                                   |
|-------------|------------------------------------------------------------------------|
| Skill       | \`.../.bundles/personal/skills/<skill-name>/SKILL.md\`                   |
| AGENTS.md   | \`.../.bundles/personal/AGENTS.md\`                                      |
| MCP server  | \`.../.bundles/personal/mcp-servers/<server-name>/\`                     |

A skill directory may also contain a \`references/\` subdirectory (for larger reference files that SKILL.md links to), a \`scripts/\` subdirectory (for executable scripts that the skill invokes), and an \`assets/\` subdirectory (for images, data files, and other static resources).

### When to use each asset type

**Skills** -- Use when the task is multi-step, needs a repeatable procedure, or requires a nested approach. Write skills following the agent-skills methodology: a YAML frontmatter section at the top of SKILL.md with \`name\` and \`description\`, followed by Markdown instructions. SKILL.md should be relatively short; put detailed reference material in \`references/\`. The name of the skill must match the name of its containing folder.

**AGENTS.md** -- Use for information that must be read every time you enter this environment. This includes conventions and patterns you observe, to-do lists associated with the environment, general reminders, and anything time-sensitive. When tracking a to-do list include the date and time each item was written, modified, and completed. Ask whether completed items should be removed (usually yes).

**MCP servers** -- Use for functionality encoded as a small set of functions that other skills or the agent can call.

### Before you write anything, verify

There can be **multiple environments and multiple skills**. You must verify exactly which one the user means before writing.

Examples of clarifying questions you should ask:

- "You're currently in both \`web:example.com\` and \`app:slack\`. Which environment should this be attached to?"
- "The personal bundle already has a skill called \`api-explorer\`. Do you want me to update that skill, or create a new one?"
- "Here are the environments/skills you might be thinking of -- is this the one?"

### A note about metadata

The metadata shown for each environment below may contain useful details you can use to search the internet and find what you need. However, metadata is not always dependable -- use discretion and good judgment.

## Currently entered environments`;
}

// -- per-environment entry -----------------------------------------------------

function renderEnvEntry(entry: EnvironmentPromptEntry): string {
  const meta: string[] = [];

  if (entry.sourceName) meta.push(`- Source name: ${entry.sourceName}`);
  if (entry.canonicalSourceUrl) meta.push(`- Canonical source URL: ${entry.canonicalSourceUrl}`);
  if (entry.contextText) meta.push(`- Current environment context: ${entry.contextText}`);

  const agents = agentsMdBlock(entry.agentsMdBundles);

  return `### \`${entry.environmentId}\`
- Personal bundle: \`${entry.bindingDir}\`
  - Write skills to: \`${entry.skillsDir}/<skill-name>/SKILL.md\`
  - Write AGENTS.md to: \`${entry.bindingDir}/AGENTS.md\`
  - Write MCP servers to: \`${entry.bindingDir}/mcp-servers/<server-name>/\`
- Existing user-created skills in this bundle: ${skillsList(entry.existingSkills)}
${meta.join("\n")}
- Metadata:
${jsonBlock(entry.metadata)}${agents ? `\n${agents}` : ""}`;
}

// -- template ------------------------------------------------------------------

/**
 * Render the environment prompt section appended to the system message
 * (below the Rook identity prompt). Returns \`undefined\` when no environments
 * are entered.
 */
export function renderEnvironmentPrompt(entries: EnvironmentPromptEntry[]): string | undefined {
  if (entries.length === 0) return undefined;

  const sorted = [...entries].sort((a, b) => a.environmentId.localeCompare(b.environmentId));

  return `${renderIntro()}

${sorted.map(renderEnvEntry).join("\n\n")}`;
}
