import type { Database } from "../database.js";

/** Single global lock that allows exactly one compute worker. */
export class LockRepository {
  constructor(private readonly db: Database) {}

  /** Takes or renews the worker lock when free, expired or already ours. */
  acquire(owner: string, ttlMs: number): boolean {
    const now = Date.now();
    this.db.sqlite
      .prepare(
        "INSERT INTO locks VALUES('worker',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms WHERE locks.until_ms<? OR locks.owner=excluded.owner",
      )
      .run(owner, now + ttlMs, now);
    const row = this.db.sqlite
      .prepare("SELECT owner FROM locks WHERE name='worker'")
      .get() as { owner: string } | undefined;
    return row?.owner === owner;
  }

  release(owner: string): void {
    this.db.sqlite
      .prepare("DELETE FROM locks WHERE name='worker' AND owner=?")
      .run(owner);
  }

  /** Expiry (epoch ms) of the current worker lease, if any. */
  workerLeaseUntil(): number {
    const row = this.db.sqlite
      .prepare("SELECT until_ms FROM locks WHERE name='worker'")
      .get() as { until_ms: number } | undefined;
    return Number(row?.until_ms || 0);
  }
}
