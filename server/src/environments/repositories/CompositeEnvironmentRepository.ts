import type { EnvironmentBundleResult, RepositoryReadError } from "../../shared/environmentRepository.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

export class CompositeEnvironmentRepository extends EnvironmentRepository {
  constructor(private readonly repositories: EnvironmentRepository[]) {
    super();
  }

  async getBundles(environmentId: string): Promise<EnvironmentBundleResult> {
    const results = await Promise.all(this.repositories.map((repository) => repository.getBundles(environmentId)));
    const environment = results.find((result) => result.environment)?.environment ?? null;
    const bundles = results.flatMap((result) => result.bundles);
    const errors: RepositoryReadError[] = results.flatMap((result) => result.errors);
    return { environment, bundles, errors };
  }
}
