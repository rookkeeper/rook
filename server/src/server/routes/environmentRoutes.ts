import type { FastifyInstance } from "fastify";
import type { EnvironmentManager } from "../environment/EnvironmentManager.js";
import type { EnvironmentDecision } from "../environment/types.js";

export async function registerEnvironmentRoutes(app: FastifyInstance, environmentManager: EnvironmentManager): Promise<void> {
  app.post<{ Body: { id?: unknown; metadata?: unknown; canonicalSourceUrl?: unknown; sourceName?: unknown } }>("/api/environments/register", async (request, reply) => {
    const id = request.body?.id;
    if (typeof id !== "string" || !id.trim()) {
      reply.code(400).send({ error: "Missing environment id" });
      return;
    }

    const metadata = request.body?.metadata;
    if (metadata !== undefined && (typeof metadata !== "object" || metadata === null || Array.isArray(metadata))) {
      reply.code(400).send({ error: "Invalid metadata" });
      return;
    }

    const canonicalSourceUrl = typeof request.body?.canonicalSourceUrl === "string" ? request.body.canonicalSourceUrl : undefined;
    const sourceName = typeof request.body?.sourceName === "string" ? request.body.sourceName : undefined;

    await environmentManager.registerAvailableEnvironment(
      { id: id.trim(), metadata: (metadata ?? {}) as Record<string, unknown> },
      { ...(canonicalSourceUrl ? { canonicalSourceUrl } : {}), ...(sourceName ? { sourceName } : {}) },
    );
    return { ok: true, id: id.trim() };
  });

  app.post<{ Body: { id?: unknown } }>("/api/environments/unavailable", async (request, reply) => {
    const id = request.body?.id;
    if (typeof id !== "string" || !id.trim()) {
      reply.code(400).send({ error: "Missing environment id" });
      return;
    }
    environmentManager.markUnavailable(id.trim());
    return { ok: true };
  });

  app.post<{ Body: { environmentId?: unknown; decision?: unknown } }>("/api/environments/decision", async (request, reply) => {
    const environmentId = request.body?.environmentId;
    const decision = request.body?.decision;
    if (typeof environmentId !== "string" || !environmentId.trim()) {
      reply.code(400).send({ error: "Missing environmentId" });
      return;
    }
    if (decision !== "accept" && decision !== "approve" && decision !== "ignore" && decision !== "reject") {
      reply.code(400).send({ error: "Invalid decision" });
      return;
    }
    environmentManager.decideEnvironment(environmentId.trim(), decision as EnvironmentDecision);
    return { ok: true };
  });

  app.get<{ Querystring: { environmentId?: string } }>("/api/environments/preview", async (request, reply) => {
    const environmentId = typeof request.query.environmentId === "string" ? request.query.environmentId.trim() : "";
    if (!environmentId) {
      reply.code(400).send({ error: "Missing environmentId" });
      return;
    }
    const skills = await environmentManager.getSkillPreviews(environmentId);
    return { environmentId, skills };
  });
}
