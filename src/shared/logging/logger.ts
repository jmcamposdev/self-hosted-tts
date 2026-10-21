import type { JobKind } from "../../domain/job/job.types.js";

/** Structured, secret-free worker events (one JSON object per line on stdout). */
export type WorkerEvent =
  | { event: "worker_ready"; engine_sha256: string; threads: number }
  | { event: "job_started"; job_id: string; kind: JobKind; attempt: number }
  | { event: "job_completed"; job_id: string }
  | { event: "job_failed"; job_id: string; code: string };

export function logEvent(event: WorkerEvent): void {
  console.log(JSON.stringify(event));
}
