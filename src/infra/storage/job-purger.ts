import { rm } from "node:fs/promises";
import type { JobRepository } from "../../persistence/repositories/job.repository.js";
import { jobRoot } from "./storage.paths.js";

/** Physically deletes a finished job. Shared by DELETE /v1/jobs/:id and the janitor. */
export class JobPurger {
  constructor(
    private readonly jobs: JobRepository,
    private readonly data: string,
  ) {}

  async purge(jobId: string): Promise<void> {
    this.jobs.markExpired(jobId);
    await rm(jobRoot(this.data, jobId), { recursive: true, force: true });
    this.jobs.scrub(jobId);
  }
}
