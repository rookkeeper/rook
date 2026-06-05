type DirNode = {
  subdirs: Map<string, DirNode>;
  files: { name: string; fullPath: string }[];
};

function emptyDir(): DirNode {
  return { subdirs: new Map(), files: [] };
}

function insertPath(root: DirNode, fullPath: string): void {
  const segments = fullPath.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return;
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    let next = node.subdirs.get(seg);
    if (!next) {
      next = emptyDir();
      node.subdirs.set(seg, next);
    }
    node = next;
  }
  const fileName = segments[segments.length - 1]!;
  node.files.push({ name: fileName, fullPath });
}

export type SkillTreeRow =
  | { kind: "dir"; label: string; depth: number }
  | { kind: "file"; label: string; path: string; depth: number };

function emitDir(node: DirNode, depth: number, prefix: string[]): SkillTreeRow[] {
  const rows: SkillTreeRow[] = [];
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  for (const f of files) {
    rows.push({ kind: "file", label: f.fullPath, path: f.fullPath, depth });
  }
  const dirNames = [...node.subdirs.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of dirNames) {
    const label = prefix.length ? `${prefix.join("/")}/${name}` : name;
    rows.push({ kind: "dir", label, depth });
    rows.push(...emitDir(node.subdirs.get(name)!, depth + 1, [...prefix, name]));
  }
  return rows;
}

/** Flat rows: within each folder, files first (sorted), then subfolders (sorted), each with depth. */
export function skillPathsToTreeRows(skills: Record<string, string>): SkillTreeRow[] {
  const root = emptyDir();
  for (const path of Object.keys(skills).sort((a, b) => a.localeCompare(b))) {
    insertPath(root, path);
  }
  const rows: SkillTreeRow[] = [];
  const topFiles = [...root.files].sort((a, b) => a.name.localeCompare(b.name));
  for (const f of topFiles) {
    rows.push({ kind: "file", label: f.fullPath, path: f.fullPath, depth: 0 });
  }
  const topDirNames = [...root.subdirs.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of topDirNames) {
    rows.push({ kind: "dir", label: name, depth: 0 });
    rows.push(...emitDir(root.subdirs.get(name)!, 1, [name]));
  }
  return rows;
}

/** First file in the same depth-first order as `skillPathsToTreeRows` (matches the UI list). */
export function firstSkillFilePathInTree(skills: Record<string, string>): string | null {
  for (const row of skillPathsToTreeRows(skills)) {
    if (row.kind === "file") return row.path;
  }
  return null;
}
