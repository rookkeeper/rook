import { useMemo } from "react";
import { skillPathsToTreeRows } from "../skillFiles";

export interface SkillFilesPanelProps {
  files: Record<string, string>;
  selectedPath: string;
  onSelectPath: (path: string) => void;
}

function treeRowPaddingLeft(depth: number): string {
  return `calc(var(--cwa-skill-tree-base, 10px) + ${depth} * var(--cwa-skill-tree-indent, 14px))`;
}

export function SkillFilesPanel({ files, selectedPath, onSelectPath }: SkillFilesPanelProps) {
  const rows = useMemo(() => skillPathsToTreeRows(files), [files]);
  const preview = files[selectedPath] ?? "";

  return (
    <div className="cwa-environment-modal__split">
      <nav className="cwa-environment-modal__tree" aria-label="Skill files">
        <div className="cwa-environment-modal__tree-inner">
          {rows.map((row) => {
            const pad = treeRowPaddingLeft(row.depth);
            const shortName = row.label.split("/").pop() ?? row.label;
            if (row.kind === "dir") {
              return (
                <div
                  key={`dir-${row.label}`}
                  className="cwa-environment-modal__tree-row cwa-environment-modal__tree-row--dir"
                  style={{ paddingLeft: pad }}
                >
                  <span className="cwa-environment-modal__tree-label cwa-environment-modal__tree-label--dir">{shortName}</span>
                </div>
              );
            }
            const isSelected = row.path === selectedPath;
            return (
              <button
                key={row.path}
                type="button"
                className={`cwa-environment-modal__tree-row cwa-environment-modal__tree-row--file${isSelected ? " cwa-environment-modal__tree-row--selected" : ""}`}
                style={{ paddingLeft: pad }}
                onClick={() => onSelectPath(row.path)}
              >
                <span className="cwa-environment-modal__tree-label">{shortName}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <div className="cwa-environment-modal__preview-wrap">
        <div className="cwa-environment-modal__preview-path" title={selectedPath}>
          {selectedPath}
        </div>
        <pre className="cwa-environment-modal__preview">{preview}</pre>
      </div>
    </div>
  );
}
