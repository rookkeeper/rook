/**
 * Parsing and validation for the Agent Skills discovery index served at
 * `/.well-known/agent-skills/index.json` (Cloudflare Agent Skills Discovery RFC).
 *
 * Pure: it only turns a response body into the entries worth fetching plus the problems
 * worth reporting. Fetching, digest verification, and error shaping belong to the scout.
 *
 * Every value quoted back in a problem message comes from a remote document, so each one
 * goes through `clip` before it is interpolated: a hostile index must not be able to push
 * megabytes of text into the error log or the stored scout errors.
 */

/** Recognized `$schema` values all start with this. */
export const DISCOVERY_SCHEMA_PREFIX = "https://schemas.agentskills.io/discovery/";

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_URL_LENGTH = 2048;
/** How much of an untrusted value a problem message may quote. */
const MAX_QUOTED_LENGTH = 200;

export type DiscoverySkillType = "skill-md" | "archive";

export interface DiscoverySkillEntry {
  name: string;
  type: DiscoverySkillType;
  description: string;
  /** Absolute `https:` URL, resolved against the index URL the entry was listed in. */
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

export interface DiscoveryIndexParseOptions {
  /** Absolute URL the index was fetched from; entry URLs resolve against it. */
  indexUrl: string;
  maxSkills: number;
}

/** Validates a discovery index body; anything unusable becomes a problem, never a throw. */
export function parseAgentSkillsDiscoveryIndex(body: string, options: DiscoveryIndexParseOptions): DiscoveryIndexParse {
  const problems: DiscoveryIndexProblem[] = [];
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch (cause) {
    problems.push({ code: "invalid_bundle_contents", message: `Skills index is not valid JSON: ${clip(cause instanceof Error ? cause.message : String(cause))}` });
    return { entries: [], problems };
  }
  if (!isRecord(document)) {
    problems.push({ code: "invalid_bundle_contents", message: "Skills index is not a JSON object" });
    return { entries: [], problems };
  }
  const schema = document.$schema;
  if (typeof schema !== "string" || !schema.startsWith(DISCOVERY_SCHEMA_PREFIX)) {
    problems.push({ code: "invalid_bundle_contents", message: `Skills index $schema is not a recognized discovery schema: ${clip(schema)}` });
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
    const entry = validateEntry(raw, options.indexUrl, problems);
    if (!entry) continue;
    if (seen.has(entry.name)) {
      problems.push({ code: "invalid_bundle_contents", message: `Skills index lists '${clip(entry.name)}' more than once; the first entry was kept`, url: entry.url });
      continue;
    }
    seen.add(entry.name);
    if (entry.type === "archive") {
      problems.push({ code: "unsupported_capability", message: `Skill '${clip(entry.name)}': archive skills are not supported yet`, url: entry.url });
      continue;
    }
    entries.push(entry);
  }
  return { entries, problems };
}

function validateEntry(raw: unknown, indexUrl: string, problems: DiscoveryIndexProblem[]): DiscoverySkillEntry | null {
  const rawUrl = isRecord(raw) && typeof raw.url === "string" ? raw.url : undefined;
  // The RFC allows relative URLs, so an entry's location is only knowable against the
  // index it was listed in; only the resolved URL is ever reported or fetched.
  const url = rawUrl === undefined ? undefined : resolveHttpsUrl(rawUrl, indexUrl);
  const reject = (message: string): null => {
    problems.push({ code: "invalid_bundle_contents", message, ...(url === undefined ? {} : { url }) });
    return null;
  };
  if (!isRecord(raw)) return reject("Skills index entry is not an object");
  const { name, type, description, digest } = raw;
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
    return reject(`Skills index entry has an invalid name: ${clip(name)}`);
  }
  if (type !== "skill-md" && type !== "archive") return reject(`Skill '${clip(name)}' has an unknown type: ${clip(type)}`);
  if (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH) {
    return reject(`Skill '${clip(name)}' has an invalid description`);
  }
  if (url === undefined) return reject(`Skill '${clip(name)}' has an invalid url: ${clip(raw.url)}`);
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) return reject(`Skill '${clip(name)}' has an invalid digest: ${clip(digest)}`);
  return { name, type, description, url, digest };
}

/** The entry URL resolved against the index URL, or undefined unless it lands on https. */
function resolveHttpsUrl(value: string, indexUrl: string): string | undefined {
  if (value.length > MAX_URL_LENGTH) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(value, indexUrl);
  } catch {
    return undefined;
  }
  if (resolved.protocol !== "https:") return undefined;
  // `https://apple.com@evil.example/x.md` reads as a link to apple.com but points at
  // evil.example, and credentials in a skill url are never something to fetch with or
  // show, so the resolved url carries none.
  resolved.username = "";
  resolved.password = "";
  const href = resolved.toString();
  return href.length > MAX_URL_LENGTH ? undefined : href;
}

/** Renders an untrusted value as a bounded-length string safe to put in a message. */
function clip(value: unknown): string {
  const text = typeof value === "string" ? value : String(value);
  return text.length <= MAX_QUOTED_LENGTH ? text : `${text.slice(0, MAX_QUOTED_LENGTH)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
