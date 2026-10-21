import { z } from "zod";

/** Optional numeric env var: unset/empty uses the fallback; anything else must be valid. */
const numberVar = (fallback: number, rule: (n: z.ZodNumber) => z.ZodNumber) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === "" ? fallback : Number(v),
    )
    .pipe(rule(z.number()));

const text = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v) => v || fallback);

/** Validated view of the process environment (fails fast on malformed numbers). */
export const environmentSchema = z.object({
  DATA_DIR: text("storage"),
  API_KEY_FILE: z.string().optional(),
  API_KEY: z.string().optional(),
  PORT: numberVar(8080, (n) => n.int().min(1).max(65535)),
  HOST: text("127.0.0.1"),
  BASE_MODEL_DIR: text("models/base"),
  CUSTOM_MODEL_DIR: text("models/custom"),
  QWEN_BINARY: text("/opt/qwen/qwen_tts"),
  QWEN_CWD: text("/opt/qwen"),
  ALIGNER_URL: text("http://127.0.0.1:8081"),
  TTS_THREADS: numberVar(4, (n) => n.int().min(1)),
  MAX_QUEUE: numberVar(100, (n) => n.int().min(0)),
  MIN_FREE_BYTES: numberVar(2 * 1024 ** 3, (n) => n.min(0)),
  RETENTION_DAYS: numberVar(7, (n) => n.positive()),
  STAGE_TIMEOUT_SECONDS: numberVar(1800, (n) => n.positive()),
});
