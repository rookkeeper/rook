/**
 * Parsing and validation for the Agent Skills discovery index served at
 * `/.well-known/agent-skills/index.json` (Cloudflare Agent Skills Discovery RFC).
 *
 * Pure: it only turns a response body into the entries worth fetching plus the problems
 * worth reporting. Fetching, digest verification, and error shaping belong to the scout.
 */

/** Recognized `$schema` values all start with this. */
export const DISCOVERY_SCHEMA_PREFIX = "https://schemas.agentskills.io/discovery/";

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

export type DiscoverySkillType = "skill-md" | "archive";

export interface DiscoverySkillEntry {
  name: string;
  type: DiscoverySkillType;
  description: string;
  url: string;
  digest: string;
}

export interface DiscoveryIndexProblem {
  code: "invalid_bundle_contents" | "unsupported_capability";
  message: string;
  url?: string;
}

export interface DiscoveryIndexParse {
  /** Valid `skill-md` entries, in index order, first-wins on duplicate names. */
  entries: DiscoverySkillEntry[];
  problems: DiscoveryIndexProblem[];
}

/** Validates a discovery index body; anything unusable becomes a problem, never a throw. */
export function parseAgentSkillsDiscoveryIndex(body: string, options: { maxSkills: number }): DiscoveryIndexParse {
  const problems: DiscoveryIndexProblem[] = [];
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch (cause) {
    problems.push({ code: "invalid_bundle_contents", message: `Skills index is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` });
    return { entries: [], problems };
  }
  if (!isRecord(document)) {
    problems.push({ code: "invalid_bundle_contents", message: "Skills index is not a JSON object" });
    return { entries: [], problems };
  }
  const schema = document.$schema;
  if (typeof schema !== "string" || !schema.startsWith(DISCOVERY_SCHEMA_PREFIX)) {
    problems.push({ code: "invalid_bundle_contents", message: `Skills index $schema is not a recognized discovery schema: ${String(schema)}` });
    return { entries: [], problems };
  }
  if (!Array.isArray(document.skills)) {
    problems.push({ code: "invalid_bundle_contents", message: "Skills index has no 'skills' array" });
    return { entries: [], problems };
  }

  const entries: DiscoverySkillEntry[] = [];
  const seen = new Set<string>();
  const listed = document.skills;
  for (const [index, raw] of listed.entries()) {
    if (index >= options.maxSkills) {
      problems.push({
        code: "invalid_bundle_contents",
        message: `Skills index lists ${listed.length} skills; only the first ${options.maxSkills} were considered`,
      });
      break;
    }
    const entry = validateEntry(raw, problems);
    if (!entry) continue;
    if (seen.has(entry.name)) {
      problems.push({ code: "invalid_bundle_contents", message: `Skills index lists '${entry.name}' more than once; the first entry was kept`, url: entry.url });
      continue;
    }
    seen.add(entry.name);
    if (entry.type === "archive") {
      problems.push({ code: "unsupported_capability", message: `Skill '${entry.name}': archive skills are not supported yet`, url: entry.url });
      continue;
    }
    entries.push(entry);
  }
  return { entries, problems };
}

function validateEntry(raw: unknown, problems: DiscoveryIndexProblem[]): DiscoverySkillEntry | null {
  const url = isRecord(raw) && typeof raw.url === "string" ? raw.url : undefined;
  const reject = (message: string): null => {
    problems.push({ code: "invalid_bundle_contents", message, ...(url === undefined ? {} : { url }) });
    return null;
  };
  if (!isRecord(raw)) return reject("Skills index entry is not an object");
  const { name, type, description, digest } = raw;
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
    return reject(`Skills index entry has an invalid name: ${String(name)}`);
  }
  if (type !== "skill-md" && type !== "archive") return reject(`Skill '${name}' has an unknown type: ${String(type)}`);
  if (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH) {
    return reject(`Skill '${name}' has an invalid description`);
  }
  if (typeof url !== "string" || !isHttpsUrl(url)) return reject(`Skill '${name}' has an invalid url: ${String(raw.url)}`);
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) return reject(`Skill '${name}' has an invalid digest: ${String(digest)}`);
  return { name, type, description, url, digest };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
