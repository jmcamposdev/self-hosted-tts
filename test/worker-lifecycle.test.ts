import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  writeFile as writeFileAsync,
  mkdir as mkdirAsync,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createTestDir,
  createTestConfig,
  createMockEngineScript,
  createMockAlignerServer,
  insertTestVoice,
} from "./test-helpers.js";
import { LeaseKeeper } from "#worker/lease.js";
import { Janitor } from "#worker/janitor.js";
import { runPreflight } from "#worker/preflight.js";
import { Worker } from "#worker/worker.js";
import { Store } from "#persistence/store.js";
import { JobPurger } from "#infra/storage/job-purger.js";
import { QwenEngine } from "#infra/engine/qwen-engine.js";
import { AlignerClient } from "#infra/aligner/aligner-client.js";
import { voiceDir, jobRoot } from "#infra/storage/storage.paths.js";

test("LeaseKeeper aborts controller when lease heartbeat fails or is lost", async () => {
  const { dir, cleanup } = await createTestDir("tts-lease-test-");
  try {
    const store = new Store(dir);
    insertTestVoice(store, "v-lease", "ready");
    const job = store.jobs.enqueue(
      "tts",
      store.voices.find("v-lease")!,
      { text: "Lease test" },
      5,
    );
    const claimed = store.jobs.claim("worker-lease-owner", 1000)!;

    // Normal lease keeper
    const keeper = new LeaseKeeper(
      store,
      "worker-lease-owner",
      claimed,
      1000,
      50,
    );
    assert.equal(keeper.signal.aborted, false);

    // Expire lease in DB manually to simulate lost lease
    store.db
      .prepare("UPDATE jobs SET token='stale-token' WHERE id=?")
      .run(job.id);

    // Wait for heartbeat tick
    await delay(120);
    assert.equal(keeper.signal.aborted, true);
    keeper.stop();
  } finally {
    await cleanup();
  }
});

test("Janitor sweep physically deletes voice directories and purges expired job directories", async () => {
  const { dir, cleanup } = await createTestDir("tts-janitor-test-");
  try {
    const store = new Store(dir);
    const purger = new JobPurger(store.jobs, dir);
    const janitor = new Janitor(store, purger, dir);

    // 1. Create deleted voice directory on disk
    insertTestVoice(store, "del-v", "ready");
    const vPath = voiceDir(dir, "del-v");
    await mkdirAsync(vPath, { recursive: true });
    await writeFileAsync(join(vPath, "test.txt"), "hello");
    assert.equal(existsSync(vPath), true);

    // Mark deleted in SQLite
    store.voices.markDeleted("del-v");

    // 2. Create expired job directory on disk
    const v = store.voices.find("del-v")!;
    const job = store.jobs.enqueue("tts", v, { text: "Sweep me" }, 5);
    const claimed = store.jobs.claim("worker-sweep", 10000)!;
    const jPath = jobRoot(dir, job.id);
    await mkdirAsync(jPath, { recursive: true });
    await writeFileAsync(join(jPath, "artifact.txt"), "result");
    assert.equal(existsSync(jPath), true);

    store.jobs.finish(claimed, jPath, 1000);
    // Mark expired with past timestamp
    store.db.prepare("UPDATE jobs SET expires_at=1 WHERE id=?").run(job.id);

    // Run sweep
    await janitor.sweep();

    // Verify directories were physically removed from disk
    assert.equal(existsSync(vPath), false);
    assert.equal(existsSync(jPath), false);

    // Verify job was scrubbed
    const scrubbed = store.jobs.find(job.id)!;
    assert.equal(scrubbed.status, "expired");
    assert.equal(scrubbed.request_json, "{}");
  } finally {
    await cleanup();
  }
});

test("runPreflight validates QwenEngine, FFmpeg and AlignerClient health", async () => {
  const { dir, cleanup } = await createTestDir("tts-preflight-test-");
  const alignerMock = await createMockAlignerServer();
  try {
    const bin = await createMockEngineScript(dir);
    const baseDir = join(dir, "models", "base");
    const customDir = join(dir, "models", "custom");
    await mkdirAsync(baseDir, { recursive: true });
    await mkdirAsync(customDir, { recursive: true });
    await writeFileAsync(join(baseDir, "model.safetensors"), Buffer.alloc(10));
    await writeFileAsync(
      join(customDir, "model.safetensors"),
      Buffer.alloc(10),
    );
    await writeFileAsync(
      join(baseDir, "config.json"),
      JSON.stringify({ tts_model_type: "base", tts_model_size: "1b7" }),
    );
    await writeFileAsync(
      join(customDir, "config.json"),
      JSON.stringify({ tts_model_type: "custom_voice", tts_model_size: "1b7" }),
    );

    const engine = new QwenEngine({
      binary: bin,
      cwd: dir,
      baseModel: baseDir,
      customModel: customDir,
      threads: 1,
      stageTimeoutMs: 5000,
    });
    const aligner = new AlignerClient(alignerMock.url, 2000);

    const hash = await runPreflight(engine, aligner);
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);
  } finally {
    await alignerMock.close();
    await cleanup();
  }
});

test("Worker runOne handles empty queue (idle) and stop() signal", async () => {
  const { dir, cleanup } = await createTestDir("tts-worker-lifecycle-");
  const alignerMock = await createMockAlignerServer();
  try {
    const bin = await createMockEngineScript(dir);
    const baseDir = join(dir, "models", "base");
    const customDir = join(dir, "models", "custom");
    await mkdirAsync(baseDir, { recursive: true });
    await mkdirAsync(customDir, { recursive: true });
    await writeFileAsync(join(baseDir, "model.safetensors"), Buffer.alloc(10));
    await writeFileAsync(
      join(customDir, "model.safetensors"),
      Buffer.alloc(10),
    );
    await writeFileAsync(
      join(baseDir, "config.json"),
      JSON.stringify({ tts_model_type: "base", tts_model_size: "1b7" }),
    );
    await writeFileAsync(
      join(customDir, "config.json"),
      JSON.stringify({ tts_model_type: "custom_voice", tts_model_size: "1b7" }),
    );

    const config = createTestConfig(dir, {
      QWEN_BINARY: bin,
      QWEN_CWD: dir,
      BASE_MODEL_DIR: baseDir,
      CUSTOM_MODEL_DIR: customDir,
      ALIGNER_URL: alignerMock.url,
    });

    const worker = new Worker(config);

    // Queue is empty -> runOne returns false
    const ran = await worker.runOne();
    assert.equal(ran, false);

    // stop() flags worker as stopped
    worker.stop();
  } finally {
    await alignerMock.close();
    await cleanup();
  }
});
