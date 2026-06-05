import { useEffect, useState } from "react";
import { fetchEnvironmentPreview } from "../remoteAgent";
import type { EnvironmentDecision, SkillPreview } from "../../shared/environment";
import { firstSkillFilePathInTree } from "../skillFiles";
import { SkillFilesPanel } from "./SkillFilesPanel";

export interface EnvironmentApprovalModalProps {
  environmentId: string;
  sourceLabel?: string;
  onDecide: (decision: EnvironmentDecision) => void | Promise<void>;
}

const DECISIONS: { decision: EnvironmentDecision; label: string; hint: string; className: string }[] = [
  { decision: "accept", label: "Allow this visit", hint: "Use its skills until you leave", className: "cwa-environment-modal__accept" },
  { decision: "approve", label: "Always allow", hint: "Auto-enter every future visit", className: "cwa-environment-modal__accept" },
  { decision: "ignore", label: "Not now", hint: "Skip until it returns", className: "cwa-environment-modal__deny" },
  { decision: "reject", label: "Never", hint: "Stop notifying me", className: "cwa-environment-modal__deny" },
];

export function EnvironmentApprovalModal({ environmentId, sourceLabel, onDecide }: EnvironmentApprovalModalProps) {
  const [skills, setSkills] = useState<SkillPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchEnvironmentPreview(environmentId)
      .then((preview) => {
        if (cancelled) return;
        setSkills(preview.skills);
        const firstSkill = preview.skills[0];
        if (firstSkill) {
          setSelectedSkillId(firstSkill.id);
          setSelectedPath(firstSkillFilePathInTree(firstSkill.files) ?? "");
        }
      })
      .catch((previewError) => {
        if (cancelled) return;
        setLoadError(previewError instanceof Error ? previewError.message : String(previewError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) ?? skills[0];

  const handleSelectSkill = (skillId: string) => {
    setSelectedSkillId(skillId);
    const skill = skills.find((item) => item.id === skillId);
    if (skill) setSelectedPath(firstSkillFilePathInTree(skill.files) ?? "");
  };

  const handleDecide = async (decision: EnvironmentDecision) => {
    setDeciding(true);
    setError(null);
    try {
      await onDecide(decision);
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : String(decideError));
      setDeciding(false);
    }
  };

  const displaySource = sourceLabel ?? environmentId;

  return (
    <div className="cwa-environment-modal-backdrop" role="presentation">
      <div
        className="cwa-environment-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cwa-environment-approval-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="cwa-environment-approval-title" className="cwa-environment-modal__title">
          Environment Available
        </h2>
        <div className="cwa-environment-modal__intro">
          <p>
            The environment <strong className="cwa-environment-modal__source">{displaySource}</strong> is now available.
            {skills.length === 0
              ? " It has no skills to review."
              : " Inspect its skills, then choose how to handle it. Allowing loads all of its skills into this session (the agent restarts when idle)."}
          </p>
        </div>

        {loading && <p className="cwa-environment-approval__status">Loading skills…</p>}
        {loadError && <div className="cwa-environment-modal__error" role="alert">{loadError}</div>}

        {!loading && !loadError && skills.length > 0 && selectedSkill && (
          <div className="cwa-environment-approval__explorer">
            <nav className="cwa-environment-approval__skills" aria-label="Skills in environment">
              {skills.map((skill) => {
                const isSelected = skill.id === selectedSkill.id;
                return (
                  <button
                    key={skill.id}
                    type="button"
                    className={`cwa-environment-approval__skill${isSelected ? " cwa-environment-approval__skill--selected" : ""}`}
                    onClick={() => handleSelectSkill(skill.id)}
                  >
                    {skill.name}
                  </button>
                );
              })}
            </nav>
            <SkillFilesPanel
              files={selectedSkill.files}
              selectedPath={selectedPath}
              onSelectPath={setSelectedPath}
            />
          </div>
        )}

        {error && <div className="cwa-environment-modal__error" role="alert">{error}</div>}
        <footer className="cwa-environment-modal__footer cwa-environment-approval__decisions">
          {DECISIONS.map(({ decision, label, hint, className }) => (
            <button
              key={decision}
              type="button"
              className={className}
              onClick={() => void handleDecide(decision)}
              disabled={deciding || loading}
              title={hint}
            >
              {label}
            </button>
          ))}
        </footer>
      </div>
    </div>
  );
}
