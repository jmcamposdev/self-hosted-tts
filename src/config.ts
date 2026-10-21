import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function configuration(env = process.env) {
  process.umask(0o077);
  const data = resolve(env.DATA_DIR || "storage");
  mkdirSync(data, { recursive: true });
  const key = env.API_KEY_FILE
    ? readFileSync(env.API_KEY_FILE, "utf8").trim()
    : env.API_KEY?.trim();
  if (!key || key.length < 32)
    throw new Error(
      "Configure API_KEY_FILE or API_KEY with at least 32 characters",
    );
  return {
    data,
    key,
    port: Number(env.PORT || 8080),
    host: env.HOST || "127.0.0.1",
    baseModel: resolve(env.BASE_MODEL_DIR || "models/base"),
    customModel: resolve(env.CUSTOM_MODEL_DIR || "models/custom"),
    engine: env.QWEN_BINARY || "/opt/qwen/qwen_tts",
    engineCwd: env.QWEN_CWD || "/opt/qwen",
    aligner: env.ALIGNER_URL || "http://127.0.0.1:8081",
    threads: Number(env.TTS_THREADS || 4),
    maxQueue: Number(env.MAX_QUEUE || 100),
    minFreeBytes: Number(env.MIN_FREE_BYTES || 2 * 1024 ** 3),
    retentionMs: Number(env.RETENTION_DAYS || 7) * 86400_000,
    leaseMs: 120_000,
    heartbeatMs: 10_000,
    stageTimeoutMs: Number(env.STAGE_TIMEOUT_SECONDS || 1800) * 1000,
  };
}
export type Configuration = ReturnType<typeof configuration>;
