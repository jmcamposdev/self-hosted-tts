import type { FastifyPluginAsync } from "fastify";
import type { ApiContext } from "../api.types.js";
import { READY_ALIGNER_TIMEOUT_MS } from "../../shared/constants/limits.constants.js";

export const healthRoutes =
  (ctx: ApiContext): FastifyPluginAsync =>
  async (app) => {
    app.get("/health/live", { schema: { security: [] } }, async () => ({
      status: "ok",
    }));

    app.get(
      "/health/ready",
      { schema: { security: [] } },
      async (_req, reply) => {
        const untilMs = ctx.store.locks.workerLeaseUntil();
        const workerReady = untilMs > Date.now();
        const alignerReady = await ctx.aligner.isHealthy(
          READY_ALIGNER_TIMEOUT_MS,
        );
        const ready = workerReady && alignerReady;

        return reply.code(ready ? 200 : 503).send({
          status: ready ? "ready" : "starting",
          worker: workerReady,
          aligner: alignerReady,
        });
      },
    );
  };
