import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createTestDir } from "./test-helpers.js";
import { migrate } from "#persistence/migrations.js";
import { Store } from "#persistence/store.js";
import { DEFAULT_SETTINGS } from "#domain/settings/settings.schema.js";

test("migrations runner applies schemas up to v2 and is idempotent", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    // Initial run
    migrate(sqlite);
    const v1 = (
      sqlite.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    assert.equal(v1, 2);

    // Verify tables exist
    const tables = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map((t) => t.name);
    assert.ok(tables.includes("voices"));
    assert.ok(tables.includes("jobs"));
    assert.ok(tables.includes("chunks"));
    assert.ok(tables.includes("locks"));

    // Verify request_id column exists
    const cols = (
      sqlite.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]
    ).map((c) => c.name);
    assert.ok(cols.includes("request_id"));

    // Idempotent re-run
    migrate(sqlite);
    const v2 = (
      sqlite.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    assert.equal(v2, 2);
  } finally {
    sqlite.close();
  }
});

test("LockRepository handles lease acquisition, renewals, takeover and release", async () => {
  const { dir, cleanup } = await createTestDir("tts-lock-test-");
  try {
    const store = new Store(dir);

    // Initial acquire
    assert.equal(store.locks.acquire("owner-1", 1000), true);
    assert.ok(store.locks.workerLeaseUntil() > Date.now());

    // Same owner renews
    assert.equal(store.locks.acquire("owner-1", 1000), true);

    // Competing owner rejected
    assert.equal(store.locks.acquire("owner-2", 1000), false);

    // Release by owner
    store.locks.release("owner-1");
    assert.equal(store.locks.workerLeaseUntil(), 0);

    // New owner can now acquire immediately
    assert.equal(store.locks.acquire("owner-2", 1000), true);

    // Expired lease takeover
    store.db
      .prepare("UPDATE locks SET until_ms=? WHERE name='worker'")
      .run(Date.now() - 50);
    assert.equal(store.locks.acquire("owner-3", 1000), true);
    assert.equal(store.locks.acquire("owner-2", 1000), false);
  } finally {
    await cleanup();
  }
});

test("VoiceRepository handles catalog lifecycle, soft delete, failIfCloning and listDeletedIds", async () => {
  const { dir, cleanup } = await createTestDir("tts-voice-repo-");
  try {
    const store = new Store(dir);

    // Insert cloning voice 1
    store.voices.insertCloning({
      id: "voice-1",
      name: "Alpha Voice",
      defaultsJson: JSON.stringify(DEFAULT_SETTINGS),
      referencePath: "/tmp/ref.wav",
      createdAt: Date.now(),
    });

    const v1 = store.voices.find("voice-1");
    assert.ok(v1);
    assert.equal(v1.status, "cloning");
    assert.equal(store.voices.count(), 1);

    // markReady on cloning voice
    store.voices.markReady("voice-1", "/profiles/v1.qvoice");
    assert.equal(store.voices.find("voice-1")!.status, "ready");
    assert.equal(
      store.voices.find("voice-1")!.profile_path,
      "/profiles/v1.qvoice",
    );

    // failIfCloning does nothing when ready
    store.voices.failIfCloning("voice-1");
    assert.equal(store.voices.find("voice-1")!.status, "ready");

    // Insert cloning voice 2 and test failIfCloning
    store.voices.insertCloning({
      id: "voice-2",
      name: "Beta Voice",
      defaultsJson: JSON.stringify(DEFAULT_SETTINGS),
      referencePath: "/tmp/ref2.wav",
      createdAt: Date.now(),
    });
    store.voices.failIfCloning("voice-2");
    assert.equal(store.voices.find("voice-2")!.status, "failed");

    // Update voice name
    store.voices.update(
      "voice-1",
      "Updated Name",
      JSON.stringify(DEFAULT_SETTINGS),
    );
    assert.equal(store.voices.find("voice-1")!.name, "Updated Name");

    // Soft delete
    store.voices.markDeleted("voice-1");
    store.voices.markDeleted("voice-2");
    assert.equal(store.voices.find("voice-1")!.status, "deleted");
    assert.equal(store.voices.listActive().length, 0);

    const deletedIds = store.voices.listDeletedIds();
    assert.ok(deletedIds.includes("voice-1"));
    assert.ok(deletedIds.includes("voice-2"));
  } finally {
    await cleanup();
  }
});

test("JobRepository handles cancellation, scrub, expiration and hasActiveForVoice", async () => {
  const { dir, cleanup } = await createTestDir("tts-job-repo-");
  try {
    const store = new Store(dir);
    store.voices.insertCloning({
      id: "voice-j",
      name: "Voice J",
      defaultsJson: JSON.stringify(DEFAULT_SETTINGS),
      referencePath: "/tmp/ref.wav",
      createdAt: Date.now(),
    });
    const v = store.voices.find("voice-j")!;

    // Enqueue
    const job = store.jobs.enqueue(
      "tts",
      v,
      { text: "Hello" },
      5,
      undefined,
      "req-123",
    );
    assert.equal(job.request_id, "req-123");
    assert.equal(job.status, "queued");

    // hasActiveForVoice
    assert.equal(store.jobs.hasActiveForVoice("voice-j"), true);

    // Request cancel for queued job
    store.jobs.requestCancel(job.id);
    assert.equal(store.jobs.find(job.id)!.cancel_requested, 1);

    // Claim, progress, finish and scrub
    const job2 = store.jobs.enqueue("tts", v, { text: "World" }, 5);
    const claimed = store.jobs.claim("worker-test", 10000)!;
    assert.equal(claimed.id, job2.id);

    store.jobs.progress(claimed, "synthesizing", 1, 2);
    assert.equal(store.jobs.find(job2.id)!.phase, "synthesizing");
    assert.equal(store.jobs.find(job2.id)!.completed, 1);

    store.jobs.finish(claimed, "/artifacts/job2", 5000);
    assert.equal(store.jobs.find(job2.id)!.status, "succeeded");

    // markExpired and scrub
    store.jobs.markExpired(job2.id);
    assert.equal(store.jobs.find(job2.id)!.status, "expired");

    store.jobs.scrub(job2.id);
    assert.equal(store.jobs.find(job2.id)!.request_json, "{}");
    assert.equal(store.jobs.find(job2.id)!.snapshot_json, "{}");

    // List expired
    store.db
      .prepare("UPDATE jobs SET expires_at=? WHERE id=?")
      .run(Date.now() - 1000, job.id);
    const expiredList = store.jobs.listExpired(Date.now());
    assert.ok(expiredList.some((j) => j.id === job.id));
  } finally {
    await cleanup();
  }
});

test("ChunkRepository stores, finds and deletes fragment checkpoints under lease", async () => {
  const { dir, cleanup } = await createTestDir("tts-chunk-repo-");
  try {
    const store = new Store(dir);
    store.voices.insertCloning({
      id: "voice-c",
      name: "Voice C",
      defaultsJson: JSON.stringify(DEFAULT_SETTINGS),
      referencePath: "/tmp/ref.wav",
      createdAt: Date.now(),
    });
    store.jobs.enqueue("tts", store.voices.find("voice-c")!, { text: "1" }, 5);
    const job = store.jobs.claim("worker-chunk", 60000)!;

    // Non-existent chunk
    assert.equal(store.chunks.find(job, 0), undefined);

    // Save checkpoint
    store.chunks.checkpoint(job, 0, "fp-chunk-0", "/path/chunk-0");
    const c0 = store.chunks.find(job, 0);
    assert.ok(c0);
    assert.equal(c0.fingerprint, "fp-chunk-0");
    assert.equal(c0.path, "/path/chunk-0");

    // Overwrite same index
    store.chunks.checkpoint(job, 0, "fp-chunk-0-updated", "/path/chunk-0-up");
    const c0Up = store.chunks.find(job, 0);
    assert.equal(c0Up?.fingerprint, "fp-chunk-0-updated");

    // Delete for job
    store.chunks.deleteForJob(job.id);
    assert.equal(store.chunks.find(job, 0), undefined);
  } finally {
    await cleanup();
  }
});
