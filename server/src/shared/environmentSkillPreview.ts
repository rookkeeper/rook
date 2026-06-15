import type { SkillPreview } from "./environment.js";

/** Group flat skill files into per-skill previews for the approval UI. */
export function groupSkillsForPreview(skills: Record<string, string>): SkillPreview[] {
  const bySkill = new Map<string, Record<string, string>>();

  for (const [filePath, content] of Object.entries(skills)) {
    const segments = filePath.split("/").filter(Boolean);
    let skillId = segments[0] ?? "skill";
    if (segments.length >= 2 && segments[segments.length - 1] === "SKILL.md") {
      skillId = segments[segments.length - 2]!;
    }
    const files = bySkill.get(skillId) ?? {};
    files[filePath] = content;
    bySkill.set(skillId, files);
  }

  return [...bySkill.entries()]
    .map(([id, files]) => ({ id, name: id, files }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
