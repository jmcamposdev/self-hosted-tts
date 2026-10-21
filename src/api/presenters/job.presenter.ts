import type { Job } from "#domain/job/job.types.js";
import type { PublicJob } from "../api.types.js";

export const publicJob = (j: Job): PublicJob => ({
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
  error: j.error_code ? { code: j.error_code, message: j.error_message } : null,
  request_id: j.request_id ?? null,
});
