import type { EnvironmentBundleResult } from "../../shared/environmentRepository.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

const REPO_NAME = "location-context";

/**
 * Programmatic, in-memory environment repository for the synthesized location-context
 * bundle. Composed alongside the directory repositories so the location-context skill
 * reaches the agent through the normal repository facade (`getSkillRuntimePaths`) —
 * no special-cased `extraSkillPaths` channel. `LocationRegistrar` sets/clears the
 * current location's bundle as the user moves.
 */
export class LocationContextRepository extends EnvironmentRepository {
  /** environmentId -> the skill bundle directory (containing SKILL.md). */
  private readonly bundlesByEnv = new Map<string, string>();

  setContextBundle(environmentId: string, sourcePath: string): void {
    this.bundlesByEnv.set(environmentId, sourcePath);
  }

  clear(environmentId: string): void {
    this.bundlesByEnv.delete(environmentId);
  }

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    const sourcePath = this.bundlesByEnv.get(environmentId);
    if (!sourcePath) return { environment: null, bundles: [], errors: [] };
    return {
      environment: null,
      bundles: [
        {
          id: `${REPO_NAME}:${environmentId}`,
          bundleId: "location-context",
          environmentId,
          repository: REPO_NAME,
          skills: [{ id: "location-context", files: {}, sourcePath }],
          mcpServers: [],
          apps: [],
          valid: true,
          errors: [],
        },
      ],
      errors: [],
    };
  }
}
