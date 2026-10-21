import { createReadStream } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import type { ApiContext } from "../api.types.js";
import { publicJob } from "../presenters/job.presenter.js";

export const jobRoutes =
  (ctx: ApiContext): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req) =>
      publicJob(ctx.jobs.find(req.params.id)),
    );

    app.post<{ Params: { id: string } }>("/v1/jobs/:id/cancel", async (req) => {
      const updated = ctx.jobs.cancel(req.params.id);
      return publicJob(updated);
    });

    app.delete<{ Params: { id: string } }>(
      "/v1/jobs/:id",
      async (req, reply) => {
        const status = await ctx.jobs.remove(req.params.id);
        if (status === "cancellation_requested") {
          return reply.code(202).send({
            job_id: req.params.id,
            status: "cancellation_requested",
          });
        }
        return reply.code(204).send();
      },
    );

    app.get<{ Params: { id: string } }>("/v1/jobs/:id/result", async (req) => {
      return ctx.jobs.result(req.params.id);
    });

    app.get<{ Params: { id: string; name: string } }>(
      "/v1/jobs/:id/artifacts/:name",
      async (req, reply) => {
        const file = await ctx.jobs.artifact(req.params.id, req.params.name);
        reply
          .header("Cache-Control", "private, no-store")
          .header("Content-Disposition", `attachment; filename="${file.name}"`)
          .type(file.mime);
        return reply.send(createReadStream(file.path));
      },
    );
  };
