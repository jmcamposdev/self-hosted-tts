import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { Fault } from "./contracts.js";

export type Voice = {
  id: string;
  name: string;
  status: string;
  defaults_json: string;
  reference_path: string;
  profile_path: string | null;
  created_at: number;
};
export type Job = {
  id: string;
  kind: string;
  status: string;
  voice_id: string;
  request_json: string;
  snapshot_json: string;
  token: string | null;
  lease_until: number | null;
  attempts: number;
  cancel_requested: number;
  purge_requested: number;
  phase: string;
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
};

export class Store {
  db: DatabaseSync;
  private inTransaction = false;
  constructor(data: string) {
    this.db = new DatabaseSync(join(data, "state.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS voices(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,defaults_json TEXT NOT NULL,reference_path TEXT NOT NULL,profile_path TEXT,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,voice_id TEXT NOT NULL,request_json TEXT NOT NULL,snapshot_json TEXT NOT NULL,token TEXT,lease_until INTEGER,attempts INTEGER NOT NULL DEFAULT 0,cancel_requested INTEGER NOT NULL DEFAULT 0,purge_requested INTEGER NOT NULL DEFAULT 0,phase TEXT NOT NULL DEFAULT 'queued',completed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0,error_code TEXT,error_message TEXT,artifact_dir TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER,idem_key TEXT UNIQUE,request_hash TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS job_queue ON jobs(status,created_at);
    CREATE TABLE IF NOT EXISTS chunks(job_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,fingerprint TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(job_id,chunk_index));
    CREATE TABLE IF NOT EXISTS locks(name TEXT PRIMARY KEY,owner TEXT NOT NULL,until_ms INTEGER NOT NULL);
    PRAGMA user_version=1;`);
  }
  transaction<T>(f: () => T): T {
    if (this.inTransaction) return f();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const r = f();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.inTransaction = false;
    }
  }
  voice(id: string) {
    return this.db.prepare("SELECT * FROM voices WHERE id=?").get(id) as
      Voice | undefined;
  }
  job(id: string) {
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as
      Job | undefined;
  }
  enqueue(
    kind: string,
    voice: Voice,
    request: unknown,
    maxQueue: number,
    idem?: string,
  ) {
    const serialized = JSON.stringify(request),
      hash = createHash("sha256")
        .update(kind + voice.id + serialized)
        .digest("hex");
    return this.transaction(() => {
      if (idem) {
        const prior = this.db
          .prepare("SELECT * FROM jobs WHERE idem_key=?")
          .get(idem) as Job | undefined;
        if (prior) {
          if (prior.request_hash !== hash)
            throw new Fault(
              "IDEMPOTENCY_CONFLICT",
              "Key already used with a different request",
              409,
            );
          return prior;
        }
      }
      const count = this.db
        .prepare(
          "SELECT count(*) AS n FROM jobs WHERE status IN ('queued','running')",
        )
        .get()!.n as number;
      if (count >= maxQueue)
        throw new Fault("QUEUE_FULL", "Queue is full", 429);
      const id = randomUUID(),
        now = Date.now();
      this.db
        .prepare(
          "INSERT INTO jobs(id,kind,status,voice_id,request_json,snapshot_json,created_at,updated_at,idem_key,request_hash) VALUES(?,?,'queued',?,?,?,?,?,?,?)",
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
        );
      return this.job(id)!;
    });
  }
  acquire(owner: string, ttl: number) {
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO locks VALUES('worker',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms WHERE locks.until_ms<? OR locks.owner=excluded.owner",
      )
      .run(owner, now + ttl, now);
    return (
      this.db.prepare("SELECT owner FROM locks WHERE name='worker'").get()
        ?.owner === owner
    );
  }
  claim(owner: string, ttl: number) {
    return this.transaction(() => {
      const now = Date.now();
      if (!this.acquire(owner, ttl)) return;
      this.db
        .prepare(
          "UPDATE jobs SET status='cancelled',phase='cancelled',updated_at=?,expires_at=? WHERE status='queued' AND cancel_requested=1",
        )
        .run(now, now + 7 * 86400_000);
      this.db
        .prepare(
          "UPDATE jobs SET status='cancelled',phase='cancelled',updated_at=?,expires_at=? WHERE status='running' AND lease_until<? AND cancel_requested=1",
        )
        .run(now, now + 7 * 86400_000, now);
      this.db
        .prepare(
          "UPDATE jobs SET status='failed',error_code='ATTEMPTS_EXHAUSTED',error_message='Worker lease repeatedly expired',expires_at=?,updated_at=? WHERE status='running' AND lease_until<? AND attempts>=3",
        )
        .run(now + 7 * 86400_000, now, now);
      this.db
        .prepare(
          "UPDATE jobs SET expires_at=? WHERE purge_requested=1 AND status IN ('cancelled','failed')",
        )
        .run(now);
      this.db
        .prepare(
          "UPDATE voices SET status='failed' WHERE status='cloning' AND id IN (SELECT voice_id FROM jobs WHERE kind='clone' AND status IN ('cancelled','failed'))",
        )
        .run();
      const j = this.db
        .prepare(
          "SELECT * FROM jobs WHERE (status='queued' OR (status='running' AND lease_until<?)) AND attempts<3 AND cancel_requested=0 ORDER BY created_at LIMIT 1",
        )
        .get(now) as Job | undefined;
      if (!j) return;
      this.db
        .prepare(
          "UPDATE jobs SET status='running',phase='starting',token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?",
        )
        .run(randomUUID(), now + ttl, now, j.id);
      return this.job(j.id)!;
    });
  }
  owns(j: Job) {
    const row = this.job(j.id);
    return (
      row?.token === j.token &&
      row.status === "running" &&
      !row.cancel_requested &&
      Number(row.lease_until) > Date.now()
    );
  }
  heartbeat(owner: string, j: Job, ttl: number) {
    return this.transaction(() => {
      if (!this.acquire(owner, ttl) || !this.owns(j)) return false;
      this.db
        .prepare(
          "UPDATE jobs SET lease_until=?,updated_at=? WHERE id=? AND token=?",
        )
        .run(Date.now() + ttl, Date.now(), j.id, j.token);
      return true;
    });
  }
  progress(j: Job, phase: string, completed: number, total: number) {
    this.db
      .prepare(
        "UPDATE jobs SET phase=?,completed=?,total=?,updated_at=? WHERE id=? AND token=? AND status='running'",
      )
      .run(phase, completed, total, Date.now(), j.id, j.token);
  }
  chunk(j: Job, index: number) {
    return this.db
      .prepare("SELECT * FROM chunks WHERE job_id=? AND chunk_index=?")
      .get(j.id, index) as { fingerprint: string; path: string } | undefined;
  }
  checkpoint(j: Job, index: number, fingerprint: string, path: string) {
    return this.transaction(() => {
      if (!this.owns(j)) throw new Fault("LEASE_LOST", "Job lease lost", 409);
      this.db
        .prepare("INSERT OR REPLACE INTO chunks VALUES(?,?,?,?)")
        .run(j.id, index, fingerprint, path);
    });
  }
  finish(j: Job, artifactDir: string, retentionMs: number) {
    return this.transaction(() => {
      if (!this.owns(j)) throw new Fault("LEASE_LOST", "Job lease lost", 409);
      this.db
        .prepare(
          "UPDATE jobs SET status='succeeded',phase='complete',completed=total,error_code=NULL,error_message=NULL,artifact_dir=?,lease_until=NULL,expires_at=?,updated_at=? WHERE id=? AND token=?",
        )
        .run(artifactDir, Date.now() + retentionMs, Date.now(), j.id, j.token);
    });
  }
  fail(j: Job, e: unknown, retentionMs: number) {
    const current = this.job(j.id);
    if (current?.token !== j.token || current.status !== "running") return;
    const cancelled = current.cancel_requested === 1;
    const fault =
      e instanceof Fault
        ? e
        : new Fault("INTERNAL_ERROR", "Unexpected worker error", 500);
    const retry = !cancelled && fault.transient && current.attempts < 3;
    this.db
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
        j.id,
        j.token,
      );
  }
}
