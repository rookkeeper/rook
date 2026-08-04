// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CompositeEnvironmentRepository } from "./CompositeEnvironmentRepository.js";
import { EnvironmentRepository } from "./EnvironmentRepository.js";

class FakeRepository extends EnvironmentRepository {
  writes: string[] = [];

  constructor(private readonly result: any, readonly repositoryId?: string) {
    super();
  }

  async getBundles(): Promise<any> {
    return this.result;
  }

  override async replaceBundleInstructions(_environmentId: string, bundleId: string): Promise<boolean> {
    this.writes.push(bundleId);
    return true;
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

  it("routes writes by repository and bundle identity", async () => {
    const canonical = new FakeRepository({
      environment: { id: "web:example.com", displayName: "example.com", description: "" },
      bundles: [{ id: "web:example.com#personal", bundleId: "personal", environmentId: "web:example.com", repository: "canonical", skills: [], mcpServers: [], apps: [], valid: true, errors: [] }],
      errors: [],
    }, "canonical");
    const personal = new FakeRepository({
      environment: null,
      bundles: [{ id: "web:example.com#personal", bundleId: "personal", environmentId: "web:example.com", repository: "personal", skills: [], mcpServers: [], apps: [], valid: true, errors: [] }],
      errors: [],
    }, "personal");
    const repository = new CompositeEnvironmentRepository([canonical, personal]);

    await repository.replaceBundleInstructions("web:example.com", "personal", "updated", "personal");

    expect(canonical.writes).toEqual([]);
    expect(personal.writes).toEqual(["personal"]);
  });

  it("does not create SQLite personal content for a directory environment", async () => {
    const personal = new FakeRepository({ environment: null, bundles: [], errors: [] }, "personal");
    const repository = new CompositeEnvironmentRepository([personal]);

    expect(await repository.ensurePersonalBundle("dir:/tmp/project")).toBe(false);
  });
});
