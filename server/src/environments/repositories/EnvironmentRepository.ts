import type { EnvironmentBundleResult } from "../../shared/environmentRepository.js";

export abstract class EnvironmentRepository {
  abstract getBundles(environmentId: string): Promise<EnvironmentBundleResult>;
}
