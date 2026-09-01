// @vitest-environment node
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerEnvironmentRoutes } from "./environmentRoutes.js";
import type { EnvironmentManager } from "../services/EnvironmentManager.js";
import type { EnvironmentIdentifier } from "../../location/EnvironmentIdentifier.js";
import type { LocationRegistrar } from "../../location/LocationRegistrar.js";

describe("POST /api/environments/decision", () => {
  let app: FastifyInstance;
  let decideEnvironment: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    decideEnvironment = vi.fn();
    app = Fastify();
    await registerEnvironmentRoutes(
      app,
      { decideEnvironment } as unknown as EnvironmentManager,
      {} as unknown as EnvironmentIdentifier,
      {} as unknown as LocationRegistrar,
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function postDecision(body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/environments/decision", payload: body });
  }

  it("records a session accept for a bundle hash", async () => {
    const response = await postDecision({ environmentId: "web:example.com", bundleHash: "hash-1", decision: "accept", sessionId: "session-1" });
    expect(response.statusCode).toBe(200);
    expect(decideEnvironment).toHaveBeenCalledWith("web:example.com", "accept", "hash-1", "session-1");
  });

  it("rejects an accept without a bundle hash instead of dropping it silently", async () => {
    const response = await postDecision({ environmentId: "web:example.com", decision: "accept", sessionId: "session-1" });
    expect(response.statusCode).toBe(400);
    expect(decideEnvironment).not.toHaveBeenCalled();
  });

  it("rejects an ignore without a bundle hash", async () => {
    const response = await postDecision({ environmentId: "web:example.com", decision: "ignore", sessionId: "session-1" });
    expect(response.statusCode).toBe(400);
    expect(decideEnvironment).not.toHaveBeenCalled();
  });

  it("rejects a permanent decision without a bundle hash", async () => {
    const response = await postDecision({ environmentId: "web:example.com", decision: "approve" });
    expect(response.statusCode).toBe(400);
    expect(decideEnvironment).not.toHaveBeenCalled();
  });
});
