import { rm } from "node:fs/promises";
import { voiceDir } from "../infra/storage/storage.paths.js";
import type { JobPurger } from "../infra/storage/job-purger.js";
import type { Store } from "../persistence/store.js";

/** Periodic physical cleanup of deleted voices and expired job artifacts. */
export class Janitor {
  constructor(
    private readonly store: Store,
    private readonly purger: JobPurger,
    private readonly data: string,
  ) {}

  async sweep(): Promise<void> {
    for (const id of this.store.voices.listDeletedIds())
      await rm(voiceDir(this.data, id), { recursive: true, force: true });
    for (const job of this.store.jobs.listExpired(Date.now()))
      await this.purger.purge(job.id);
  }
}
