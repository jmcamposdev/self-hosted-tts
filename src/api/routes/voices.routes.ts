import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ApiContext } from "../api.types.js";
import { publicVoice } from "../presenters/voice.presenter.js";
import { voicePatchSchema } from "#domain/voice/voice.schema.js";
import { settingsSchema } from "#domain/settings/settings.schema.js";
import { idParamSchema } from "#domain/common/params.schema.js";
import { Fault } from "#shared/errors/fault.js";
import { ensureFreeSpace } from "#shared/tools/fs.tools.js";

export const voiceRoutes =
  (ctx: ApiContext): FastifyPluginAsync =>
  async (fastify) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.get("/v1/voices", async () => ({
      voices: ctx.voices.list().map(publicVoice),
    }));

    app.post(
      "/v1/voices",
      {
        schema: {
          summary:
            "Clone a voice (multipart: name, audio; optional voice_settings JSON)",
          consumes: ["multipart/form-data"],
        },
      },
      async (req, reply) => {
        ensureFreeSpace(
          ctx.config.data,
          ctx.config.minFreeBytes,
          "Insufficient free storage",
        );
        let audio: Buffer | undefined;
        let name = "";
        let settings = {};

        for await (const part of req.parts()) {
          if (part.type === "file") {
            if (part.fieldname !== "audio") {
              throw new Fault(
                "INVALID_UPLOAD",
                "Expected an audio file field named audio",
              );
            }
            audio = await part.toBuffer();
          } else if (part.fieldname === "name") {
            name = String(part.value).trim();
          } else if (part.fieldname === "voice_settings") {
            try {
              settings = settingsSchema.parse(JSON.parse(String(part.value)));
            } catch {
              throw new Fault(
                "INVALID_SETTINGS",
                "Invalid voice_settings JSON",
              );
            }
          } else {
            throw new Fault("INVALID_UPLOAD", "Unknown form field");
          }
        }

        if (!audio?.length || !name || name.length > 100) {
          throw new Fault(
            "INVALID_UPLOAD",
            "Provide a name (1–100 characters) and an audio file",
          );
        }

        const { voice, job } = await ctx.voices.create({
          name,
          audio,
          settings,
        });
        return reply.code(202).send({
          ...publicVoice(voice),
          job_id: job.id,
          status_url: `/v1/jobs/${job.id}`,
        });
      },
    );

    app.get(
      "/v1/voices/:id",
      {
        schema: {
          params: idParamSchema,
        },
      },
      async (req) => publicVoice(ctx.voices.find(req.params.id)),
    );

    app.patch(
      "/v1/voices/:id",
      {
        schema: {
          params: idParamSchema,
          body: voicePatchSchema,
        },
      },
      async (req) => {
        const updated = ctx.voices.patch(req.params.id, req.body);
        return publicVoice(updated);
      },
    );

    app.delete(
      "/v1/voices/:id",
      {
        schema: {
          params: idParamSchema,
        },
      },
      async (req, reply) => {
        await ctx.voices.remove(req.params.id);
        return reply.code(204).send();
      },
    );
  };
