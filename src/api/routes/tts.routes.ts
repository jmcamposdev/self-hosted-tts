import type { FastifyPluginAsync } from "fastify";
import type { ApiContext } from "../api.types.js";
import { narrationSchema } from "../../domain/narration/narration.schema.js";
import { publicJob } from "../presenters/job.presenter.js";
import { ensureFreeSpace } from "../../shared/tools/fs.tools.js";
import { jsonSchema } from "./tools.js";

export const ttsRoutes =
  (ctx: ApiContext): FastifyPluginAsync =>
  async (app) => {
    app.post<{ Params: { id: string } }>(
      "/v1/text-to-speech/:id",
      {
        schema: {
          summary: "Create a narration job",
          body: jsonSchema(narrationSchema),
        },
      },
      async (req, reply) => {
        ensureFreeSpace(
          ctx.config.data,
          ctx.config.minFreeBytes,
          "Insufficient free storage",
        );
        const input = narrationSchema.parse(req.body);
        const idem = req.headers["idempotency-key"];
        const job = ctx.jobs.enqueueNarration(req.params.id, input, idem);

        return reply
          .code(202)
          .send({ ...publicJob(job), status_url: `/v1/jobs/${job.id}` });
      },
    );
  };
