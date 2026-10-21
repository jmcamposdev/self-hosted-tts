import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export interface AuthPluginOptions {
  key: string;
}

const authPluginCallback: FastifyPluginAsync<AuthPluginOptions> = async (
  app,
  options,
) => {
  app.addHook("onRequest", async (req, reply) => {
    if (
      req.url.split("?")[0].startsWith("/docs") ||
      req.url.startsWith("/health/")
    ) {
      return;
    }

    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const alt = req.headers["xi-api-key"];
    const provided = bearer || (typeof alt === "string" ? alt : "");

    const a = Buffer.from(provided);
    const b = Buffer.from(options.key);

    if (
      (bearer && alt && bearer !== alt) ||
      a.length !== b.length ||
      !timingSafeEqual(a, b)
    ) {
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "A valid API key is required",
        },
      });
    }
  });
};

export const authPlugin = fp(authPluginCallback, {
  name: "auth-plugin",
});
