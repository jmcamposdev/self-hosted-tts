export type JobKind = "clone" | "tts";

export type JobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";

export type JobPhase =
  | "queued"
  | "starting"
  | "validating_reference"
  | "cloning"
  | "normalizing"
  | "synthesizing"
  | "aligning"
  | "assembling"
  | "retrying"
  | "complete"
  | "failed"
  | "cancelled";

/**
 * A queued unit of work as stored in SQLite. `request_json` and `snapshot_json`
 * are immutable captures taken at enqueue time; read them with `parseSnapshot`
 * and `parseRequest` from `job.tools.ts`.
 */
export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  voice_id: string;
  request_json: string;
  snapshot_json: string;
  /** Fencing token of the current lease; changes on every claim. */
  token: string | null;
  lease_until: number | null;
  attempts: number;
  cancel_requested: number;
  purge_requested: number;
  phase: JobPhase;
  completed: number;
  total: number;
  error_code: string | null;
  error_message: string | null;
  artifact_dir: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  idem_key: string | null;
  request_hash: string;
}

/** Durable per-fragment checkpoint used to resume narration after a failure. */
export interface ChunkCheckpoint {
  fingerprint: string;
  path: string;
}
