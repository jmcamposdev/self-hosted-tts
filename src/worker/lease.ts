import type { Job } from "#domain/job/job.types.js";
import type { Store } from "#persistence/store.js";

/**
 * Renews the worker lock and job lease on an interval. When the lease is lost
 * (or renewal fails) the shared AbortController fires so running stages stop.
 */
export class LeaseKeeper {
  readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;

  constructor(
    store: Store,
    owner: string,
    job: Job,
    leaseMs: number,
    heartbeatMs: number,
  ) {
    this.timer = setInterval(() => {
      try {
        if (!store.jobs.heartbeat(owner, job, leaseMs)) this.controller.abort();
      } catch {
        this.controller.abort();
      }
    }, heartbeatMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
