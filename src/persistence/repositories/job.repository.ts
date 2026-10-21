import { createHash, randomUUID } from "node:crypto";
import type { Job, JobKind } from "#domain/job/job.types.js";
import type { Voice } from "#domain/voice/voice.types.js";
import {
  MAX_ATTEMPTS,
  TERMINAL_JOB_RETENTION_MS,
} from "#shared/constants/limits.constants.js";
import { Fault } from "#shared/errors/fault.js";
import type { Database } from "../database.js";
import type { LockRepository } from "./lock.repository.js";
import type { VoiceRepository } from "./voice.repository.js";

/**
 * Durable job queue. Every mutation made by a worker is fenced by the job's
 * `token` and lease, so a worker that lost its lease can never publish results.
 */
export class JobRepository {
  constructor(
    private readonly db: Database,
    private readonly locks: LockRepository,
    private readonly voices: VoiceRepository,
  ) {}

  find(id: string): Job | undefined {
    return this.db.sqlite.prepare("SELECT * FROM jobs WHERE id=?").get(id) as
      Job | undefined;
  }

  /** Enqueues a job with an immutable voice snapshot; idempotent per `idem` key. */
  enqueue(
    kind: JobKind,
    voice: Voice,
    request: unknown,
    maxQueue: number,
    idem?: string,
    requestId?: string,
  ): Job {
    const serialized = JSON.stringify(request),
      hash = createHash("sha256")
        .update(kind + voice.id + serialized)
        .digest("hex");
    return this.db.transaction(() => {
      if (idem) {
        const prior = this.db.sqlite
          .prepare("SELECT * FROM jobs WHERE idem_key=?")
          .get(idem) as Job | undefined;
        if (prior) {
          if (prior.request_hash !== hash)
            throw new Fault(
              "IDEMPOTENCY_CONFLICT",
              "Key already used with a different request",
            );
          return prior;
        }
      }
      const count = this.db.sqlite
        .prepare(
          "SELECT count(*) AS n FROM jobs WHERE status IN ('queued','running')",
        )
        .get()!.n as number;
      if (count >= maxQueue) throw new Fault("QUEUE_FULL", "Queue is full");
      const id = randomUUID(),
        now = Date.now();
      this.db.sqlite
        .prepare(
          "INSERT INTO jobs(id,kind,status,voice_id,request_json,snapshot_json,created_at,updated_at,idem_key,request_hash,request_id) VALUES(?,?,'queued',?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          kind,
          voice.id,
          serialized,
          JSON.stringify(voice),
          now,
          now,
          idem || null,
          hash,
          requestId || null,
        );
      return this.find(id)!;
    });
  }

  /**
   * Takes the worker lock, settles cancelled/exhausted jobs and leases the next
   * runnable one (new fencing token, attempts+1). Returns undefined when idle.
   */
  claim(owner: string, ttlMs: number): Job | undefined {
    return this.db.transaction(() => {
      const now = Date.now();
      if (!this.locks.acquire(owner, ttlMs)) return;
      const retained = now + TERMINAL_JOB_RETENTION_MS;
      this.db.sqlite
        .prepare(
          "UPDATE jobs SET status='cancelled',phase='cancelled',updated_at=?,expires_at=? WHERE status='queued' AND cancel_requested=1",
        )
        .run(now, retained);
      this.db.sqlite
        .prepare(
          "UPDATE jobs SET status='cancelled',phase='cancelled',updated_at=?,expires_at=? WHERE status='running' AND lease_until<? AND cancel_requested=1",
        )
        .run(now, retained, now);
      this.db.sqlite
        .prepare(
          `UPDATE jobs SET status='failed',error_code='ATTEMPTS_EXHAUSTED',error_message='Worker lease repeatedly expired',expires_at=?,updated_at=? WHERE status='running' AND lease_until<? AND attempts>=${MAX_ATTEMPTS}`,
        )
        .run(retained, now, now);
      this.db.sqlite
        .prepare(
          "UPDATE jobs SET expires_at=? WHERE purge_requested=1 AND status IN ('cancelled','failed')",
        )
        .run(now);
      this.voices.failOrphanedCloning();
      const next = this.db.sqlite
        .prepare(
          `SELECT * FROM jobs WHERE (status='queued' OR (status='running' AND lease_until<?)) AND attempts<${MAX_ATTEMPTS} AND cancel_requested=0 ORDER BY created_at LIMIT 1`,
        )
        .get(now) as Job | undefined;
      if (!next) return;
      this.db.sqlite
        .prepare(
          "UPDATE jobs SET status='running',phase='starting',token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?",
        )
        .run(randomUUID(), now + ttlMs, now, next.id);
      return this.find(next.id)!;
    });
  }

  /** True while `job`'s token is current, running, not cancelled and within its lease. */
  owns(job: Job): boolean {
    const row = this.find(job.id);
    return (
      row?.token === job.token &&
      row.status === "running" &&
      !row.cancel_requested &&
      Number(row.lease_until) > Date.now()
    );
  }

  /** Renews the worker lock and job lease; false means the lease was lost. */
  heartbeat(owner: string, job: Job, ttlMs: number): boolean {
    return this.db.transaction(() => {
      if (!this.locks.acquire(owner, ttlMs) || !this.owns(job)) return false;
      this.db.sqlite
        .prepare(
          "UPDATE jobs SET lease_until=?,updated_at=? WHERE id=? AND token=?",
        )
        .run(Date.now() + ttlMs, Date.now(), job.id, job.token);
      return true;
    });
  }

  progress(
    job: Job,
    phase: Job["phase"],
    completed: number,
    total: number,
  ): void {
    this.db.sqlite
      .prepare(
        "UPDATE jobs SET phase=?,completed=?,total=?,updated_at=? WHERE id=? AND token=? AND status='running'",
      )
      .run(phase, completed, total, Date.now(), job.id, job.token);
  }

  /** Marks success. Callers needing atomicity with other writes wrap it in `db.transaction`. */
  finish(job: Job, artifactDir: string, retentionMs: number): void {
    this.db.transaction(() => {
      if (!this.owns(job)) throw new Fault("LEASE_LOST", "Job lease lost");
      this.db.sqlite
        .prepare(
          "UPDATE jobs SET status='succeeded',phase='complete',completed=total,error_code=NULL,error_message=NULL,artifact_dir=?,lease_until=NULL,expires_at=?,updated_at=? WHERE id=? AND token=?",
        )
        .run(
          artifactDir,
          Date.now() + retentionMs,
          Date.now(),
          job.id,
          job.token,
        );
    });
  }

  /** Records a failure: requeues transient faults while attempts remain, honours cancel/purge. */
  fail(job: Job, error: unknown, retentionMs: number): void {
    const current = this.find(job.id);
    if (current?.token !== job.token || current.status !== "running") return;
    const cancelled = current.cancel_requested === 1;
    const fault =
      error instanceof Fault
        ? error
        : new Fault("INTERNAL_ERROR", "Unexpected worker error");
    const retry =
      !cancelled && fault.transient && current.attempts < MAX_ATTEMPTS;
    this.db.sqlite
      .prepare(
        "UPDATE jobs SET status=?,phase=?,error_code=?,error_message=?,lease_until=NULL,expires_at=?,updated_at=? WHERE id=? AND token=?",
      )
      .run(
        cancelled ? "cancelled" : retry ? "queued" : "failed",
        cancelled ? "cancelled" : retry ? "retrying" : "failed",
        cancelled ? "CANCELLED" : fault.code,
        cancelled ? "Cancelled by user" : `${current.phase}: ${fault.message}`,
        retry ? null : Date.now() + (current.purge_requested ? 0 : retentionMs),
        Date.now(),
        job.id,
        job.token,
      );
  }

  hasActiveForVoice(voiceId: string): boolean {
    return !!this.db.sqlite
      .prepare(
        "SELECT id FROM jobs WHERE voice_id=? AND status IN ('queued','running')",
      )
      .get(voiceId);
  }

  requestCancel(id: string): void {
    this.db.sqlite
      .prepare("UPDATE jobs SET cancel_requested=1,updated_at=? WHERE id=?")
      .run(Date.now(), id);
  }

  /** Cancel and schedule immediate physical deletion of an active job. */
  requestPurge(id: string): void {
    const now = Date.now();
    this.db.sqlite
      .prepare(
        "UPDATE jobs SET cancel_requested=1,purge_requested=1,expires_at=?,updated_at=? WHERE id=?",
      )
      .run(now, now, id);
  }

  /** Finished jobs whose retention has elapsed. */
  listExpired(now: number): Job[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM jobs WHERE expires_at<=? AND status NOT IN ('running','queued')",
      )
      .all(now) as unknown as Job[];
  }

  /** Step 1 of purge: downloads are refused immediately. */
  markExpired(id: string): void {
    this.db.sqlite
      .prepare(
        "UPDATE jobs SET status='expired',artifact_dir=NULL,updated_at=? WHERE id=?",
      )
      .run(Date.now(), id);
  }

  /** Step 2 of purge: drop checkpoints and the captured script/settings. */
  scrub(id: string): void {
    this.db.transaction(() => {
      this.db.sqlite.prepare("DELETE FROM chunks WHERE job_id=?").run(id);
      this.db.sqlite
        .prepare(
          "UPDATE jobs SET expires_at=NULL,request_json='{}',snapshot_json='{}' WHERE id=?",
        )
        .run(id);
    });
  }
}
