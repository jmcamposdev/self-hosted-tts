/** Queue and worker lifecycle. */
export const MAX_ATTEMPTS = 3;
export const WORKER_LEASE_MS = 120_000;
export const WORKER_HEARTBEAT_MS = 10_000;
export const WORKER_IDLE_DELAY_MS = 1_000;
export const JANITOR_INTERVAL_MS = 60_000;
export const DAY_MS = 86_400_000;
/** Retention applied by the queue to cancelled/lease-exhausted jobs (independent of RETENTION_DAYS). */
export const TERMINAL_JOB_RETENTION_MS = 7 * DAY_MS;

/** Narration input and output. */
export const NARRATION_TEXT_MAX_CHARS = 30_000;
export const MAX_OUTPUT_SECONDS = 1_800;
export const SEGMENT_MAX_CHARS = 300;
export const SEGMENT_MIN_SENTENCE_CHARS = 50;
export const ENCODER_DURATION_TOLERANCE_SECONDS = 0.08;
export const ALIGNMENT_END_TOLERANCE_SECONDS = 0.001;

/** Voices and reference audio. */
export const VOICE_NAME_MAX_CHARS = 100;
export const REFERENCE_MIN_SECONDS = 5;
export const REFERENCE_MAX_SECONDS = 30.05;
export const MAX_PROFILE_BYTES = 64 * 1024 ** 2;
export const IDEMPOTENCY_KEY_MAX_CHARS = 200;

/** HTTP surface. */
export const API_BODY_LIMIT_BYTES = 512 * 1024;
export const UPLOAD_MAX_BYTES = 25 * 1024 ** 2;
export const RATE_LIMIT_MAX = 120;
export const RATE_LIMIT_WINDOW = "1 minute";
export const READY_ALIGNER_TIMEOUT_MS = 2_000;

/** Subprocess budgets. */
export const FFMPEG_TIMEOUT_MS = 120_000;
export const PREFLIGHT_TIMEOUT_MS = 10_000;
export const KILL_GRACE_MS = 3_000;
export const STDOUT_TAIL_BYTES = 64 * 1024;
export const STDERR_TAIL_BYTES = 16 * 1024;
