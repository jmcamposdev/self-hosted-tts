import type { JobKind } from "#domain/job/job.types.js";

/** Structured, secret-free worker events (one JSON object per line on stdout). */
export type WorkerEvent =
  | { event: "worker_ready"; engine_sha256: string; threads: number }
  | {
      event: "job_started";
      job_id: string;
      kind: JobKind;
      attempt: number;
      request_id?: string | null;
    }
  | { event: "job_completed"; job_id: string; request_id?: string | null }
  | {
      event: "job_failed";
      job_id: string;
      code: string;
      request_id?: string | null;
    };

export function logEvent(event: WorkerEvent): void {
  console.log(JSON.stringify(event));
}
