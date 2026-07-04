import type { FastifyInstance } from "fastify";
import type { EnvironmentManager } from "../environment/EnvironmentManager.js";

export async function registerDiagnosticRoutes(
  app: FastifyInstance,
  environmentManager: EnvironmentManager,
): Promise<void> {
  app.get("/api/diagnostics/environments", async () => {
    const environments = environmentManager.diagnosticSnapshot();
    return {
      environments,
      counts: {
        total: environments.length,
        active: environments.filter((environment) => environment.status === "active").length,
        recent: environments.filter((environment) => environment.status === "recent").length,
      },
    };
  });
}
