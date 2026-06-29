import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EnvironmentCandidate } from "../../shared/environment.js";
import { REPO_ROOT } from "../paths.js";

/** Gitignored runtime location for the generated location-context skill bundle. */
const CONTEXT_DIR = path.join(REPO_ROOT, ".var", "agent-station", "location-context");

function line(label: string, value: unknown): string {
  return value === undefined || value === null || value === "" ? "" : `- **${label}:** ${value}\n`;
}

function businessBlock(c: EnvironmentCandidate): string {
  return (
    `### ${c.displayName}\n` +
    line("Environment", `\`${c.environmentId}\``) +
    line("Operator", c.operator) +
    line("Address", c.address) +
    line("Store #", c.storeNumber) +
    line("Website", c.website) +
    line("Coordinates", c.latitude !== undefined && c.longitude !== undefined ? `${c.latitude}, ${c.longitude}` : undefined) +
    line("Distance", c.distanceMeters !== undefined ? `${c.distanceMeters} m` : undefined) +
    line("Match", c.matchReasons?.join(", ")) +
    "\n"
  );
}

/** Render the SKILL.md describing the current business + same-building neighbors. */
export function renderLocationContextSkill(current: EnvironmentCandidate, nearby: EnvironmentCandidate[]): string {
  const frontmatter =
    "---\n" +
    "name: location-context\n" +
    `description: Where the user currently is — ${current.displayName} and nearby businesses in the same building.\n` +
    `environment: ${current.environmentId}\n` +
    "---\n\n";

  const body =
    `# Current location\n\nYou are currently at the following place. Use this metadata when the user refers to "here", this store, or nearby shops.\n\n` +
    `## Current business\n\n${businessBlock(current)}` +
    (nearby.length > 0
      ? `## Nearby in this building\n\nOther businesses that may be relevant:\n\n${nearby.map(businessBlock).join("")}`
      : "");

  return frontmatter + body;
}

/** Confidence floor and lead gap above which the top guess is treated as unambiguous. */
const CONFIDENT_MIN = 0.7;
const CONFIDENT_LEAD = 0.15;

/** Whether the top candidate is a confident single match (vs an ambiguous cluster). */
export function isConfidentMatch(current: EnvironmentCandidate, nearby: EnvironmentCandidate[]): boolean {
  if (current.confidence < CONFIDENT_MIN) return false;
  const second = nearby[0];
  return !second || current.confidence - second.confidence >= CONFIDENT_LEAD;
}

/**
 * Concise, ambiguity-aware "where you are" context PUSHED into the agent (≈ system
 * prompt) — the best guess plus the top guesses by name. This is not the SKILL.md body
 * (skills stay on-demand pull); it's what lets the agent answer "where am I".
 */
export function renderLocationContextText(current: EnvironmentCandidate, nearby: EnvironmentCandidate[]): string {
  const names = [current, ...nearby].slice(0, 5).map((c) => c.displayName);
  const guidance = `When the user says "here", refers to this place, or asks where they are, use this.`;

  if (isConfidentMatch(current, nearby)) {
    const where = current.address ? `${current.displayName} (${current.address})` : current.displayName;
    const others = nearby.slice(0, 4).map((c) => c.displayName);
    const nearbyLine = others.length > 0 ? ` Other businesses nearby: ${others.join(", ")}.` : "";
    return `You are most likely at ${where}.${nearbyLine} ${guidance}`;
  }

  return `You are near several businesses and which one you're in is uncertain: ${names.join(", ")}. ${guidance}`;
}

/**
 * Write the location-context skill bundle to disk and return its directory path.
 * Overwrites any previous bundle (single global current location).
 */
export function writeLocationContextSkill(current: EnvironmentCandidate, nearby: EnvironmentCandidate[]): string {
  const bundleDir = path.join(CONTEXT_DIR, "location-context");
  rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(path.join(bundleDir, "SKILL.md"), renderLocationContextSkill(current, nearby), "utf8");
  return bundleDir;
}
