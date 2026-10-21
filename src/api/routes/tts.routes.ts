import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ApiContext } from "../api.types.js";
import { narrationSchema } from "#domain/narration/narration.schema.js";
import { idParamSchema } from "#domain/common/params.schema.js";
import { publicJob } from "../presenters/job.presenter.js";
import { ensureFreeSpace } from "#shared/tools/fs.tools.js";

export const ttsRoutes =
  (ctx: ApiContext): FastifyPluginAsync =>
  async (fastify) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/v1/text-to-speech/:id",
      {
        schema: {
          summary: "Create a narration job",
          params: idParamSchema,
          body: narrationSchema,
        },
      },
      async (req, reply) => {
        ensureFreeSpace(
          ctx.config.data,
          ctx.config.minFreeBytes,
          "Insufficient free storage",
        );
        const idem = req.headers["idempotency-key"];
        const job = ctx.jobs.enqueueNarration(req.params.id, req.body, idem);

        return reply
          .code(202)
          .send({ ...publicJob(job), status_url: `/v1/jobs/${job.id}` });
      },
    );
  };
