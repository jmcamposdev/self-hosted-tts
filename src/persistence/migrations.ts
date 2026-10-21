import type { DatabaseSync } from "node:sqlite";

/**
 * Ordered, append-only schema migrations. `PRAGMA user_version` is the number
 * of migrations applied. NEVER edit an applied migration: add a new one.
 */
const MIGRATIONS: readonly string[] = [
  // v1: initial schema.
  `CREATE TABLE IF NOT EXISTS voices(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,defaults_json TEXT NOT NULL,reference_path TEXT NOT NULL,profile_path TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,voice_id TEXT NOT NULL,request_json TEXT NOT NULL,snapshot_json TEXT NOT NULL,token TEXT,lease_until INTEGER,attempts INTEGER NOT NULL DEFAULT 0,cancel_requested INTEGER NOT NULL DEFAULT 0,purge_requested INTEGER NOT NULL DEFAULT 0,phase TEXT NOT NULL DEFAULT 'queued',completed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0,error_code TEXT,error_message TEXT,artifact_dir TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER,idem_key TEXT UNIQUE,request_hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS job_queue ON jobs(status,created_at);
CREATE TABLE IF NOT EXISTS chunks(job_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,fingerprint TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(job_id,chunk_index));
CREATE TABLE IF NOT EXISTS locks(name TEXT PRIMARY KEY,owner TEXT NOT NULL,until_ms INTEGER NOT NULL);`,
];

export function migrate(sqlite: DatabaseSync): void {
  const row = sqlite.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let v = Number(row.user_version); v < MIGRATIONS.length; v++) {
    sqlite.exec(`${MIGRATIONS[v]}\nPRAGMA user_version=${v + 1};`);
  }
}
