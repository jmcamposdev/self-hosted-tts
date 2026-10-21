import Fastify from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import type { Configuration } from "../config/config.types.js";
import { Store } from "../persistence/store.js";
import { AlignerClient } from "../infra/aligner/aligner-client.js";
import { JobPurger } from "../infra/storage/job-purger.js";
import { VoiceService } from "./services/voice.service.js";
import { JobService } from "./services/job.service.js";
import type { ApiContext } from "./api.types.js";
import { authPlugin } from "./plugins/auth.plugin.js";
import { errorHandlerPlugin } from "./plugins/error-handler.plugin.js";
import { openapiPlugin } from "./plugins/openapi.plugin.js";
import { healthRoutes } from "./routes/health.routes.js";
import { voiceRoutes } from "./routes/voices.routes.js";
import { ttsRoutes } from "./routes/tts.routes.js";
import { jobRoutes } from "./routes/jobs.routes.js";
import {
  API_BODY_LIMIT_BYTES,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
  UPLOAD_MAX_BYTES,
} from "../shared/constants/limits.constants.js";

export async function createApi(config: Configuration) {
  const store = new Store(config.data);
  const aligner = new AlignerClient(config.aligner, config.stageTimeoutMs);
  const purger = new JobPurger(store.jobs, config.data);
  const voices = new VoiceService(store, config);
  const jobs = new JobService(store, config, voices, purger);

  const ctx: ApiContext = {
    config,
    store,
    aligner,
    voices,
    jobs,
  };

  const app = Fastify({
    bodyLimit: API_BODY_LIMIT_BYTES,
    ajv: { customOptions: { removeAdditional: false } },
    logger: {
      level: "info",
      redact: ["req.headers.authorization", "req.headers.xi-api-key"],
    },
  });

  app.addHook("onClose", async () => {
    store.close();
  });

  await app.register(authPlugin, { key: config.key });
  await app.register(rateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
    allowList: (req) => req.url.startsWith("/health/"),
  });
  await app.register(multipart, {
    limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 2, parts: 3 },
    throwFileSizeLimit: true,
  });
  await app.register(openapiPlugin);
  await app.register(errorHandlerPlugin);

  await app.register(healthRoutes(ctx));
  await app.register(voiceRoutes(ctx));
  await app.register(ttsRoutes(ctx));
  await app.register(jobRoutes(ctx));

  return app;
}
