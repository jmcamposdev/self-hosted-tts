/**
 * Single catalog of every error code the service can emit. `status` is the HTTP
 * status when surfaced by the API; `transient` marks failures a job may retry.
 */
export const ERROR_CODES = {
  // Request validation (API)
  INVALID_UPLOAD: { status: 400, transient: false },
  INVALID_SETTINGS: { status: 400, transient: false },
  INVALID_KEY: { status: 400, transient: false },
  VOICE_NOT_FOUND: { status: 404, transient: false },
  JOB_NOT_FOUND: { status: 404, transient: false },
  ARTIFACT_NOT_FOUND: { status: 404, transient: false },
  VOICE_NOT_READY: { status: 409, transient: false },
  VOICE_IN_USE: { status: 409, transient: false },
  RESULT_NOT_READY: { status: 409, transient: false },
  IDEMPOTENCY_CONFLICT: { status: 409, transient: false },
  RESULT_EXPIRED: { status: 410, transient: false },
  QUEUE_FULL: { status: 429, transient: false },
  STORAGE_FULL: { status: 507, transient: false },
  // Ownership and cancellation
  CANCELLED: { status: 409, transient: false },
  LEASE_LOST: { status: 409, transient: false },
  ATTEMPTS_EXHAUSTED: { status: 500, transient: false },
  // Input rejected by the pipeline
  INVALID_REFERENCE: { status: 422, transient: false },
  INVALID_AUDIO: { status: 422, transient: false },
  TEXT_TOKEN_TOO_LONG: { status: 422, transient: false },
  NO_SPEECH: { status: 422, transient: false },
  DURATION_LIMIT: { status: 422, transient: false },
  ALIGNMENT_REJECTED: { status: 422, transient: false },
  // Subprocess / engine
  EXECUTABLE_UNAVAILABLE: { status: 500, transient: false },
  PROCESS_FAILED: { status: 500, transient: false },
  ENGINE_CONFIGURATION: { status: 500, transient: false },
  SYNTHESIS_TRUNCATED: { status: 500, transient: false },
  STAGE_TIMEOUT: { status: 500, transient: true },
  MODEL_INCOMPATIBLE: { status: 500, transient: false },
  INVALID_PROFILE: { status: 500, transient: false },
  PROFILE_MISSING: { status: 500, transient: false },
  // Integrity
  INVALID_PCM: { status: 500, transient: false },
  CHECKPOINT_CORRUPT: { status: 500, transient: false },
  ALIGNMENT_INVALID: { status: 500, transient: false },
  ENCODER_TIMING: { status: 500, transient: false },
  // Dependencies and worker
  ALIGNER_UNAVAILABLE: { status: 503, transient: true },
  ALIGNER_FAILED: { status: 503, transient: true },
  WORKER_STOPPED: { status: 503, transient: true },
  INTERNAL_ERROR: { status: 500, transient: false },
} as const satisfies Record<string, { status: number; transient: boolean }>;
