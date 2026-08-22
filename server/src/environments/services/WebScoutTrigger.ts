import type { CandidateEnvironmentRecord } from "../../shared/environment.js";
import { hostForWebEnvironmentId } from "../repositories/WebEnvironmentRepository.js";
import type { EnvironmentManager } from "./EnvironmentManager.js";
import type { WebEnvironmentScout, WebScoutLogger } from "./WebEnvironmentScout.js";

export interface WebScoutTriggerOptions {
  scout: WebEnvironmentScout;
  environmentManager: Pick<EnvironmentManager, "registerCandidateEnvironment">;
  logger?: WebScoutLogger;
}

const NO_OP_LOGGER: WebScoutLogger = { info: () => {}, warn: () => {}, debug: () => {} };

/**
 * Connects candidate registration to web scouting: when a `web:<host>` candidate is
 * registered, scout the host (the scout's TTL decides whether anything is fetched) and,
 * if the stored content changed, register the same candidate again so the manager
 * re-resolves its bundles through the composite repository. That refreshes the
 * remembered summary and hashes to include the web bundle, and the manager's existing
 * behavior clears and broadcasts unavailability for hashes that vanished.
 *
 * Web scouting is a dedicated adapter, deliberately kept out of `EnvironmentManager`;
 * this class is the only place the two meet. Known limitation: a session that already
 * entered the environment sees the new offer on its next entry or restart, which is
 * existing manager behavior.
 */
export class WebScoutTrigger {
  private readonly scout: WebEnvironmentScout;
  private readonly environmentManager: Pick<EnvironmentManager, "registerCandidateEnvironment">;
  private readonly logger: WebScoutLogger;

  constructor(options: WebScoutTriggerOptions) {
    this.scout = options.scout;
    this.environmentManager = options.environmentManager;
    this.logger = options.logger ?? NO_OP_LOGGER;
  }

  /** Never throws: scouting is best-effort and must not disturb registration. */
  async handleCandidate(candidate: CandidateEnvironmentRecord): Promise<void> {
    // Non-web and path-scoped ids are not scouted.
    const host = hostForWebEnvironmentId(candidate.id);
    if (host === null) return;
    try {
      const outcome = await this.scout.scout(host);
      this.logger.debug({ environmentId: candidate.id, host, ...outcome }, "web scout trigger completed");
      if (!outcome.changed) return;
      await this.environmentManager.registerCandidateEnvironment(candidate);
      this.logger.info({ environmentId: candidate.id, host, result: outcome.result }, "web environment re-registered after scout");
    } catch (error) {
      this.logger.warn({ environmentId: candidate.id, error }, "web scout trigger failed");
    }
  }
}
