// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CompositeEnvironmentRepository } from "./CompositeEnvironmentRepository.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

class FakeRepository extends EnvironmentRepository {
  constructor(private readonly result: any) {
    super();
  }

  async getBundles(): Promise<any> {
    return this.result;
  }
}

describe("CompositeEnvironmentRepository", () => {
  it("returns bundles from multiple repositories for the same environment", async () => {
    const repository = new CompositeEnvironmentRepository([
      new FakeRepository({
        environment: { id: "web:example.com", displayName: "example.com", description: "" },
        bundles: [{ id: "web:example.com#one", bundleId: "one", environmentId: "web:example.com", repository: "/repo/one", skills: [], mcpServers: [], apps: [], valid: true, errors: [] }],
        errors: [],
      }),
      new FakeRepository({
        environment: null,
        bundles: [{ id: "web:example.com#two", bundleId: "two", environmentId: "web:example.com", repository: "/repo/two", skills: [], mcpServers: [], apps: [], valid: true, errors: [] }],
        errors: [],
      }),
    ]);

    const result = await repository.getBundles("web:example.com");

    expect(result.environment?.id).toBe("web:example.com");
    expect(result.bundles.map((bundle: any) => bundle.bundleId)).toEqual(["one", "two"]);
  });
});
