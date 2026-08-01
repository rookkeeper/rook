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
  /** Human-readable display name. */
  displayName?: string;
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

function bundleLabel(id: string): { name: string; editable: boolean } {
  return id === "default"
    ? { name: "Personal capabilities", editable: true }
    : { name: "Environment capabilities", editable: false };
}

function agentsMdBlock(bundles: EnvironmentPromptEntry["agentsMdBundles"]): string {
  if (bundles.length === 0) return "";
  const blocks = bundles.map(({ bundleId, content }) => {
    const label = bundleLabel(bundleId);
    const editable = label.editable ? ' editable="true"' : "";
    const indented = content.split("\n").map((line) => `      ${line}`).join("\n");
    return `  <bundle name="${label.name}"${editable}>\n\n    <instructions>\n${indented}\n    </instructions>\n\n  </bundle>`;
  });
  return blocks.join("\n\n");
}

const USEFUL_METADATA_KEYS = new Set([
  "website",
  "observedUrls",
  "observedPaths",
  "appName",
  "windowTitle",
  "operator",
  "storeNumber",
  "address",
  "latitude",
  "longitude",
]);

function renderContext(metadata: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!USEFUL_METADATA_KEYS.has(key)) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item !== "string" && typeof item !== "number") continue;
      const tag = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      lines.push(`    <${tag}>${escapePseudoMarkup(String(item))}</${tag}>`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "    No additional context was provided.";
}

function escapePseudoMarkup(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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

- "You're currently in both \`web:example.com\` and \`mac:slack\`. Which environment should this be attached to?"
- "The personal bundle already has a skill called \`api-explorer\`. Do you want me to update that skill, or create a new one?"
- "Here are the environments/skills you might be thinking of -- is this the one?"

### A note about metadata

The metadata shown for each environment below may contain useful details you can use to search the internet and find what you need. However, metadata is not always dependable -- use discretion and good judgment.

## Currently entered environments`;
}

// -- per-environment entry -----------------------------------------------------

function renderEnvEntry(entry: EnvironmentPromptEntry): string {
  const environmentName = escapePseudoMarkup(entry.displayName ?? "Current environment");
  const agents = agentsMdBlock(entry.agentsMdBundles);

  return `<environment name="${environmentName}">

  <context>
${renderContext(entry.metadata)}
  </context>

  <bundle name="Personal capabilities" editable="true">

    <instructions>
      Write skills to: \`${entry.skillsDir}/<skill-name>/SKILL.md\`
      Write AGENTS.md to: \`${entry.bindingDir}/AGENTS.md\`
      Write MCP servers to: \`${entry.bindingDir}/mcp-servers/<server-name>/\`
      Existing personal skills: ${skillsList(entry.existingSkills)}
    </instructions>

  </bundle>${agents ? `\n\n${agents}` : ""}

</environment>`;
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
