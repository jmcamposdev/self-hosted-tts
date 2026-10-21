import Fastify from "fastify";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { createReadStream, statfsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { configuration, type Configuration } from "./config.js";
import { Store, type Job, type Voice } from "./store.js";
import {
  Fault,
  defaults,
  settingsSchema,
  narrationSchema,
  voicePatchSchema,
} from "./contracts.js";

const artifacts: Record<string, string> = {
  "audio.opus": "audio/ogg",
  "audio.wav": "audio/wav",
  "alignment.json": "application/json",
  "words.json": "application/json",
  "metadata.json": "application/json",
  "subtitles.srt": "application/x-subrip",
};
function publicVoice(v: Voice) {
  return {
    voice_id: v.id,
    name: v.name,
    status: v.status,
    voice_settings: JSON.parse(v.defaults_json),
    created_at: v.created_at,
  };
}
function publicJob(j: Job) {
  return {
    job_id: j.id,
    kind: j.kind,
    voice_id: j.voice_id,
    status: j.status,
    phase: j.phase,
    progress: { completed: j.completed, total: j.total },
    attempts: j.attempts,
    created_at: j.created_at,
    updated_at: j.updated_at,
    expires_at: j.expires_at,
    error: j.error_code
      ? { code: j.error_code, message: j.error_message }
      : null,
  };
}
function jsonSchema(s: z.ZodType) {
  const { $schema, ...rest } = z.toJSONSchema(s);
  return rest;
}

export async function createApi(config: Configuration) {
  const store = new Store(config.data);
  const app = Fastify({
    bodyLimit: 512 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
    logger: {
      level: "info",
      redact: ["req.headers.authorization", "req.headers.xi-api-key"],
    },
  });
  app.addHook("onClose", async () => {
    store.db.close();
  });
  app.addHook("onRequest", async (req, reply) => {
    if (
      req.url.split("?")[0].startsWith("/docs") ||
      req.url.startsWith("/health/")
    )
      return;
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const alt = req.headers["xi-api-key"];
    const provided = bearer || (typeof alt === "string" ? alt : "");
    const a = Buffer.from(provided),
      b = Buffer.from(config.key);
    if (
      (bearer && alt && bearer !== alt) ||
      a.length !== b.length ||
      !timingSafeEqual(a, b)
    )
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "A valid API key is required",
        },
      });
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    allowList: (req) => req.url.startsWith("/health/"),
  });
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 ** 2, files: 1, fields: 2, parts: 3 },
    throwFileSizeLimit: true,
  });
  await app.register(swagger, {
    transformObject: (document) => {
      const swaggerObject =
        "openapiObject" in document
          ? document.openapiObject
          : document.swaggerObject;
      const operation = swaggerObject.paths?.["/v1/voices"]?.post;
      if (operation)
        Object.assign(operation, {
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["name", "audio"],
                  properties: {
                    name: { type: "string", maxLength: 100 },
                    audio: { type: "string", format: "binary" },
                    voice_settings: {
                      type: "string",
                      description:
                        "Optional JSON object with speed, volume, paragraph_pause_ms and seed",
                    },
                  },
                },
              },
            },
          },
        });
      return swaggerObject;
    },
    openapi: {
      info: {
        title: "Self Hosted TTS",
        version: "0.1.0",
        description:
          "Private asynchronous Spanish TTS. Jobs require both audio and alignment to succeed.",
      },
      components: {
        securitySchemes: { apiKey: { type: "http", scheme: "bearer" } },
      },
      security: [{ apiKey: [] }],
    },
  });
  await app.register(swaggerUI, { routePrefix: "/docs" });
  app.setErrorHandler((e, req, reply) => {
    if (e instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request",
          issues: e.issues,
        },
      });
    if (e instanceof Fault)
      return reply
        .code(e.status)
        .send({ error: { code: e.code, message: e.message } });
    const status = (e as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply.code(status).send({
        error: {
          code: "INVALID_REQUEST",
          message:
            status === 413 ? "Upload or request too large" : "Invalid request",
        },
      });
    req.log.error({ err: e }, "API failure");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
    });
  });
  function space() {
    const s = statfsSync(config.data);
    if (s.bavail * s.bsize < config.minFreeBytes)
      throw new Fault("STORAGE_FULL", "Insufficient free storage", 507);
  }
  function findVoice(id: string) {
    const v = store.voice(id);
    if (!v || v.status === "deleted")
      throw new Fault("VOICE_NOT_FOUND", "Voice not found", 404);
    return v;
  }
  function findJob(id: string) {
    const j = store.job(id);
    if (!j) throw new Fault("JOB_NOT_FOUND", "Job not found", 404);
    return j;
  }
  function available(j: Job) {
    if (j.status === "expired" || (j.expires_at && j.expires_at <= Date.now()))
      throw new Fault("RESULT_EXPIRED", "Result has expired", 410);
    if (j.status !== "succeeded" || !j.artifact_dir)
      throw new Fault("RESULT_NOT_READY", "Job has no completed result", 409);
    return j.artifact_dir;
  }
  app.get("/health/live", { schema: { security: [] } }, async () => ({
    status: "ok",
  }));
  app.get(
    "/health/ready",
    { schema: { security: [] } },
    async (_req, reply) => {
      const worker = store.db
        .prepare("SELECT until_ms FROM locks WHERE name='worker'")
        .get();
      let aligner = false;
      try {
        aligner = (
          await fetch(config.aligner + "/health", {
            signal: AbortSignal.timeout(2000),
          })
        ).ok;
      } catch {}
      const ready = Number(worker?.until_ms) > Date.now() && aligner;
      return reply.code(ready ? 200 : 503).send({
        status: ready ? "ready" : "starting",
        worker: Number(worker?.until_ms) > Date.now(),
        aligner,
      });
    },
  );
  app.get("/v1/voices", async () => ({
    voices: (
      store.db
        .prepare(
          "SELECT * FROM voices WHERE status!='deleted' ORDER BY created_at",
        )
        .all() as Voice[]
    ).map(publicVoice),
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
      space();
      let audio: Buffer | undefined;
      let name = "";
      let settings = {};
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "audio")
            throw new Fault(
              "INVALID_UPLOAD",
              "Expected an audio file field named audio",
            );
          audio = await part.toBuffer();
        } else if (part.fieldname === "name") name = String(part.value).trim();
        else if (part.fieldname === "voice_settings") {
          try {
            settings = settingsSchema.parse(JSON.parse(String(part.value)));
          } catch {
            throw new Fault("INVALID_SETTINGS", "Invalid voice_settings JSON");
          }
        } else throw new Fault("INVALID_UPLOAD", "Unknown form field");
      }
      if (!audio?.length || !name || name.length > 100)
        throw new Fault(
          "INVALID_UPLOAD",
          "Provide a name (1–100 characters) and an audio file",
        );
      const id = randomUUID(),
        dir = join(config.data, "voices", id);
      await mkdir(dir, { recursive: true });
      const reference = join(dir, "reference.upload");
      await writeFile(reference, audio, { flag: "wx" });
      try {
        const j = store.transaction(() => {
          store.db
            .prepare("INSERT INTO voices VALUES(?,?,'cloning',?,?,NULL,?)")
            .run(
              id,
              name,
              JSON.stringify({ ...defaults, ...settings }),
              reference,
              Date.now(),
            );
          return store.enqueue("clone", store.voice(id)!, {}, config.maxQueue);
        });
        return reply.code(202).send({
          ...publicVoice(store.voice(id)!),
          job_id: j.id,
          status_url: `/v1/jobs/${j.id}`,
        });
      } catch (e) {
        await rm(dir, { recursive: true, force: true });
        throw e;
      }
    },
  );
  app.get<{ Params: { id: string } }>("/v1/voices/:id", async (req) =>
    publicVoice(findVoice(req.params.id)),
  );
  app.patch<{ Params: { id: string } }>(
    "/v1/voices/:id",
    { schema: { body: jsonSchema(voicePatchSchema) } },
    async (req) => {
      const input = voicePatchSchema.parse(req.body),
        v = findVoice(req.params.id);
      store.db
        .prepare("UPDATE voices SET name=?,defaults_json=? WHERE id=?")
        .run(
          input.name || v.name,
          JSON.stringify({
            ...JSON.parse(v.defaults_json),
            ...input.voice_settings,
          }),
          v.id,
        );
      return publicVoice(findVoice(v.id));
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/v1/voices/:id",
    async (req, reply) => {
      const v = findVoice(req.params.id);
      store.transaction(() => {
        const active = store.db
          .prepare(
            "SELECT id FROM jobs WHERE voice_id=? AND status IN ('queued','running')",
          )
          .get(v.id);
        if (active)
          throw new Fault(
            "VOICE_IN_USE",
            "Cancel or finish active jobs before deleting the voice",
            409,
          );
        store.db
          .prepare("UPDATE voices SET status='deleted' WHERE id=?")
          .run(v.id);
      });
      await rm(join(config.data, "voices", v.id), {
        recursive: true,
        force: true,
      });
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/text-to-speech/:id",
    {
      schema: {
        summary: "Create a narration job",
        body: jsonSchema(narrationSchema),
      },
    },
    async (req, reply) => {
      space();
      const input = narrationSchema.parse(req.body),
        v = findVoice(req.params.id);
      if (v.status !== "ready")
        throw new Fault("VOICE_NOT_READY", "Voice is not ready", 409);
      const idem = req.headers["idempotency-key"];
      if (idem && (typeof idem !== "string" || idem.length > 200))
        throw new Fault(
          "INVALID_KEY",
          "Idempotency-Key must be at most 200 characters",
        );
      const j = store.enqueue(
        "tts",
        v,
        input,
        config.maxQueue,
        idem as string | undefined,
      );
      return reply
        .code(202)
        .send({ ...publicJob(j), status_url: `/v1/jobs/${j.id}` });
    },
  );
  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req) =>
    publicJob(findJob(req.params.id)),
  );
  app.post<{ Params: { id: string } }>("/v1/jobs/:id/cancel", async (req) => {
    const j = findJob(req.params.id);
    if (["queued", "running"].includes(j.status))
      store.db
        .prepare("UPDATE jobs SET cancel_requested=1,updated_at=? WHERE id=?")
        .run(Date.now(), j.id);
    return publicJob(findJob(j.id));
  });
  app.delete<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    const j = findJob(req.params.id);
    if (["queued", "running"].includes(j.status)) {
      store.db
        .prepare(
          "UPDATE jobs SET cancel_requested=1,purge_requested=1,expires_at=?,updated_at=? WHERE id=?",
        )
        .run(Date.now(), Date.now(), j.id);
      return reply
        .code(202)
        .send({ job_id: j.id, status: "cancellation_requested" });
    }
    store.db
      .prepare(
        "UPDATE jobs SET status='expired',artifact_dir=NULL,request_json='{}',snapshot_json='{}',expires_at=?,updated_at=? WHERE id=?",
      )
      .run(Date.now(), Date.now(), j.id);
    await rm(join(config.data, "jobs", j.id), { recursive: true, force: true });
    store.db.prepare("DELETE FROM chunks WHERE job_id=?").run(j.id);
    store.db.prepare("UPDATE jobs SET expires_at=NULL WHERE id=?").run(j.id);
    return reply.code(204).send();
  });
  app.get<{ Params: { id: string } }>("/v1/jobs/:id/result", async (req) => {
    const j = findJob(req.params.id);
    available(j);
    if (j.kind === "clone")
      return { job_id: j.id, voice: publicVoice(findVoice(j.voice_id)) };
    return {
      job_id: j.id,
      expires_at: j.expires_at,
      artifacts: Object.fromEntries(
        Object.keys(artifacts).map((name) => [
          name,
          `/v1/jobs/${j.id}/artifacts/${name}`,
        ]),
      ),
    };
  });
  app.get<{ Params: { id: string; name: string } }>(
    "/v1/jobs/:id/artifacts/:name",
    async (req, reply) => {
      const j = findJob(req.params.id),
        dir = available(j),
        name = req.params.name;
      if (!artifacts[name] || j.kind !== "tts")
        throw new Fault("ARTIFACT_NOT_FOUND", "Artifact not found", 404);
      const path = join(dir, name);
      try {
        await stat(path);
      } catch {
        throw new Fault("ARTIFACT_NOT_FOUND", "Artifact not found", 404);
      }
      reply
        .header("Cache-Control", "private, no-store")
        .header("Content-Disposition", `attachment; filename="${name}"`)
        .type(artifacts[name]);
      return reply.send(createReadStream(path));
    },
  );
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = configuration();
  const app = await createApi(config);
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.once(sig, () => void app.close());
  await app.listen({ port: config.port, host: config.host });
}
