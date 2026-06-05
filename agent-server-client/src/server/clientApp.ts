import type { FastifyInstance } from "fastify";
import middie from "@fastify/middie";
import fastifyStatic from "@fastify/static";
import { createServer as createViteServer } from "vite";
import path from "node:path";
import { AGENT_CLIENT_ROOT } from "./paths.js";
import { isProduction } from "./serverPaths.js";

export async function registerClientApp(app: FastifyInstance): Promise<void> {
  if (isProduction) {
    const clientDist = path.join(AGENT_CLIENT_ROOT, "dist/client");
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: "/",
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && request.headers.accept?.includes("text/html")) {
        return reply.sendFile("index.html");
      }
      reply.code(404).send({ error: "Not found" });
    });
    return;
  }

  await app.register(middie);
  const vite = await createViteServer({
    root: AGENT_CLIENT_ROOT,
    configFile: path.join(AGENT_CLIENT_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use((request, response, next) => {
    if (request.url?.startsWith("/api/")) return next();
    vite.middlewares(request, response, next);
  });
}
