import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DAY_MS,
  WORKER_HEARTBEAT_MS,
  WORKER_LEASE_MS,
} from "../shared/constants/limits.constants.js";
import { environmentSchema } from "./config.schema.js";
import type { Configuration } from "./config.types.js";

export function loadConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): Configuration {
  process.umask(0o077);
  const parsed = environmentSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      "Invalid environment: " +
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
    );
  const e = parsed.data;
  const data = resolve(e.DATA_DIR);
  mkdirSync(data, { recursive: true });
  const key = e.API_KEY_FILE
    ? readFileSync(e.API_KEY_FILE, "utf8").trim()
    : e.API_KEY?.trim();
  if (!key || key.length < 32)
    throw new Error(
      "Configure API_KEY_FILE or API_KEY with at least 32 characters",
    );
  return {
    data,
    key,
    port: e.PORT,
    host: e.HOST,
    baseModel: resolve(e.BASE_MODEL_DIR),
    customModel: resolve(e.CUSTOM_MODEL_DIR),
    engine: e.QWEN_BINARY,
    engineCwd: e.QWEN_CWD,
    aligner: e.ALIGNER_URL,
    threads: e.TTS_THREADS,
    maxQueue: e.MAX_QUEUE,
    minFreeBytes: e.MIN_FREE_BYTES,
    retentionMs: e.RETENTION_DAYS * DAY_MS,
    leaseMs: WORKER_LEASE_MS,
    heartbeatMs: WORKER_HEARTBEAT_MS,
    stageTimeoutMs: e.STAGE_TIMEOUT_SECONDS * 1000,
  };
}
