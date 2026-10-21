import { createReadStream } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ApiContext } from "../api.types.js";
import {
  idParamSchema,
  artifactParamSchema,
} from "#domain/common/params.schema.js";
import { publicJob } from "../presenters/job.presenter.js";

export const jobRoutes =
  (ctx: ApiContext): FastifyPluginAsync =>
  async (fastify) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.get(
      "/v1/jobs/:id",
      {
        schema: {
          params: idParamSchema,
        },
      },
      async (req) => publicJob(ctx.jobs.find(req.params.id)),
    );

    app.post(
      "/v1/jobs/:id/cancel",
      {
        schema: {
          params: idParamSchema,
        },
      },
      async (req) => {
        const updated = ctx.jobs.cancel(req.params.id);
        return publicJob(updated);
      },
    );

    app.delete(
      "/v1/jobs/:id",
      {
        schema: {
          params: idParamSchema,
        },
      },
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

    app.get(
      "/v1/jobs/:id/result",
      {
        schema: {
          params: idParamSchema,
        },
      },
      async (req) => {
        return ctx.jobs.result(req.params.id);
      },
    );

    app.get(
      "/v1/jobs/:id/artifacts/:name",
      {
        schema: {
          params: artifactParamSchema,
        },
      },
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
