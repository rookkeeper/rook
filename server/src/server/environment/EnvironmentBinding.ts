import { mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Binding — user-local filesystem paths for environment authoring
// ═══════════════════════════════════════════════════════════════════════════════
//
// Prompt rendering for the system message has been extracted to
// EnvironmentPromptTemplate.ts so the template is easy to inspect and modify.
// ═══════════════════════════════════════════════════════════════════════════════

export function userEnvironmentRepositoryRoot(): string {
  return path.join(os.homedir(), ".rook", "environment-repository");
}

export interface EnvironmentBindingInfo {
  environmentId: string;
  environmentDir: string;
  bundlesDir: string;
  personalBundleDir: string;
  skillsDir: string;
  existingSkills: string[];
}

function resolveEnvironmentDir(environmentId: string, root: string): string | null {
  const colonIndex = environmentId.indexOf(":");
  if (colonIndex === -1) return null;
  const kind = environmentId.slice(0, colonIndex);
  const envPath = environmentId.slice(colonIndex + 1);
  if (!kind || !envPath) return null;
  return path.join(root, kind, envPath);
}

function listExistingSkills(skillsDir: string): string[] {
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function ensurePersonalEnvironmentBinding(environmentId: string): EnvironmentBindingInfo | null {
  const environmentDir = resolveEnvironmentDir(environmentId, userEnvironmentRepositoryRoot());
  if (!environmentDir) return null;

  const bundlesDir = path.join(environmentDir, ".bundles");
  const personalBundleDir = path.join(bundlesDir, "personal");
  const skillsDir = path.join(personalBundleDir, "skills");
  mkdirSync(skillsDir, { recursive: true });

  return {
    environmentId,
    environmentDir,
    bundlesDir,
    personalBundleDir,
    skillsDir,
    existingSkills: listExistingSkills(skillsDir),
  };
}
