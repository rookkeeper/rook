import { describe, expect, it } from "vitest";
import { firstSkillFilePathInTree, skillPathsToTreeRows } from "./skillFiles";

describe("firstSkillFilePathInTree", () => {
  it("returns the first file in tree order", () => {
    expect(firstSkillFilePathInTree({ z: "1", a: "2", m: "3" })).toBe("a");
    expect(
      firstSkillFilePathInTree({
        "skill-b/SKILL.md": "b",
        "skill-a/nested/x.md": "x",
        "skill-a/SKILL.md": "a",
      }),
    ).toBe("skill-a/SKILL.md");
  });
});

describe("skillPathsToTreeRows", () => {
  it("orders directories and files in a tree-friendly way", () => {
    const rows = skillPathsToTreeRows({
      "skill-b/SKILL.md": "b",
      "skill-a/nested/x.md": "x",
      "skill-a/SKILL.md": "a",
    });
    const files = rows.filter((r) => r.kind === "file").map((r) => r.path);
    expect(files).toEqual(["skill-a/SKILL.md", "skill-a/nested/x.md", "skill-b/SKILL.md"]);
  });
});
