import type { ChunkCheckpoint, Job } from "#domain/job/job.types.js";
import { Fault } from "#shared/errors/fault.js";
import type { Database } from "../database.js";
import type { JobRepository } from "./job.repository.js";

export class ChunkRepository {
  constructor(
    private readonly db: Database,
    private readonly jobs: JobRepository,
  ) {}

  find(job: Job, index: number): ChunkCheckpoint | undefined {
    return this.db.sqlite
      .prepare("SELECT * FROM chunks WHERE job_id=? AND chunk_index=?")
      .get(job.id, index) as ChunkCheckpoint | undefined;
  }

  /** Persists a completed fragment; fenced so a stale worker cannot write. */
  checkpoint(job: Job, index: number, fingerprint: string, path: string): void {
    this.db.transaction(() => {
      if (!this.jobs.owns(job)) throw new Fault("LEASE_LOST", "Job lease lost");
      this.db.sqlite
        .prepare("INSERT OR REPLACE INTO chunks VALUES(?,?,?,?)")
        .run(job.id, index, fingerprint, path);
    });
  }

  deleteForJob(jobId: string): void {
    this.db.sqlite.prepare("DELETE FROM chunks WHERE job_id=?").run(jobId);
  }
}
