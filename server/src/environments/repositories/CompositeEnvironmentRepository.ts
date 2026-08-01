import type { EnvironmentBundle, EnvironmentBundleResult, EnvironmentRecord, RepositoryReadError } from "../../shared/environmentRepository.js";
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

  async listEnvironments(): Promise<EnvironmentRecord[]> {
    const environments = (await Promise.all(this.repositories.map((repository) => repository.listEnvironments()))).flat();
    return uniqueBy(environments, (environment) => environment.id);
  }

  async searchBundles(query: string, repositoryId?: string): Promise<EnvironmentBundle[]> {
    const bundles = (await Promise.all(this.repositories.map((repository) => repository.searchBundles(query, repositoryId)))).flat();
    return uniqueBy(bundles, (bundle) => `${bundle.repository}:${bundle.id}`);
  }
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const valueKey = key(value);
    if (seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  });
}
