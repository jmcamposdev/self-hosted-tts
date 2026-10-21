import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createTestDir,
  createValidWav,
  createValidQvoice,
  createMockEngineScript,
  createTestConfig,
  insertTestVoice,
} from "./test-helpers.js";
import { assertQvoiceProfile } from "#infra/engine/qvoice.tools.js";
import { ClonePipeline } from "#worker/pipelines/clone.pipeline.js";
import { Store } from "#persistence/store.js";
import { QwenEngine } from "#infra/engine/qwen-engine.js";
import { AlignerClient } from "#infra/aligner/aligner-client.js";
import { Fault } from "#shared/errors/fault.js";
import { voiceProfilePath } from "#infra/storage/storage.paths.js";
import { QVOICE_MAGIC } from "#shared/constants/engine.constants.js";
import { MAX_PROFILE_BYTES } from "#shared/constants/limits.constants.js";

test("assertQvoiceProfile validates magic, hidden size, min and max bytes", () => {
  // Valid profile
  const valid = createValidQvoice();
  assert.doesNotThrow(() => assertQvoiceProfile(valid));

  // Too short
  assert.throws(
    () => assertQvoiceProfile(Buffer.from("short")),
    (e) => e instanceof Fault && e.code === "INVALID_PROFILE",
  );

  // Wrong magic
  const badMagic = createValidQvoice();
  badMagic.write("FAIL", 0, 4, "ascii");
  assert.throws(
    () => assertQvoiceProfile(badMagic),
    (e) => e instanceof Fault && e.code === "INVALID_PROFILE",
  );

  // Wrong hidden size
  const badHidden = createValidQvoice(1024);
  assert.throws(
    () => assertQvoiceProfile(badHidden),
    (e) => e instanceof Fault && e.code === "INVALID_PROFILE",
  );

  // Max profile bytes boundary
  const oversized = Buffer.alloc(MAX_PROFILE_BYTES + 1);
  oversized.write(QVOICE_MAGIC, 0, 4, "ascii");
  oversized.writeUInt32LE(2048, 8);
  assert.throws(
    () => assertQvoiceProfile(oversized),
    (e) => e instanceof Fault && e.code === "INVALID_PROFILE",
  );
});

test("ClonePipeline successfully generates profile and metadata for valid reference", async () => {
  const { dir, cleanup } = await createTestDir("tts-clone-test-");
  try {
    const bin = await createMockEngineScript(dir);
    const config = createTestConfig(dir, {
      QWEN_BINARY: bin,
      QWEN_CWD: dir,
    });
    const store = new Store(dir);
    const engine = new QwenEngine({
      binary: bin,
      cwd: dir,
      baseModel: dir,
      customModel: dir,
      threads: 1,
      stageTimeoutMs: 5000,
    });
    const aligner = new AlignerClient("http://127.0.0.1:9999", 5000);

    const pipeline = new ClonePipeline({
      config,
      store,
      engine,
      aligner,
      engineHash: "engine-hash-test",
    });

    const voiceId = "voice-clone-1";
    const refWav = createValidWav(5); // 5 seconds duration
    const refPath = join(dir, "ref.wav");
    await writeFile(refPath, refWav);

    await mkdir(join(dir, "voices", voiceId), { recursive: true });
    insertTestVoice(store, voiceId, "cloning");
    store.db
      .prepare("UPDATE voices SET reference_path=? WHERE id=?")
      .run(refPath, voiceId);

    const voice = store.voices.find(voiceId)!;
    store.jobs.enqueue("clone", voice, {}, 10);
    const job = store.jobs.claim("test-worker", 60000)!;
    const attemptDir = join(dir, "jobs", job.id, "att-1");
    await mkdir(attemptDir, { recursive: true });

    await pipeline.run({
      job,
      dir: attemptDir,
      signal: new AbortController().signal,
    });

    // Check voice is now ready and profile_path exists
    const updatedVoice = store.voices.find(voiceId)!;
    assert.equal(updatedVoice.status, "ready");
    assert.ok(updatedVoice.profile_path);
    assert.equal(
      updatedVoice.profile_path,
      voiceProfilePath(dir, voiceId, job.token!),
    );

    // Check clone metadata in attemptDir
    const metaPath = join(attemptDir, "metadata.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    assert.equal(meta.voice_id, voiceId);
    assert.equal(meta.engine_sha256, "engine-hash-test");
    assert.ok(meta.reference_duration_seconds >= 4.9);
    assert.ok(meta.profile_sha256);
  } finally {
    await cleanup();
  }
});

test("ClonePipeline rejects reference audio that is too short (< 3s)", async () => {
  const { dir, cleanup } = await createTestDir("tts-clone-short-");
  try {
    const bin = await createMockEngineScript(dir);
    const config = createTestConfig(dir, {
      QWEN_BINARY: bin,
      QWEN_CWD: dir,
    });
    const store = new Store(dir);
    const engine = new QwenEngine({
      binary: bin,
      cwd: dir,
      baseModel: dir,
      customModel: dir,
      threads: 1,
      stageTimeoutMs: 5000,
    });
    const aligner = new AlignerClient("http://127.0.0.1:9999", 5000);
    const pipeline = new ClonePipeline({
      config,
      store,
      engine,
      aligner,
      engineHash: "test",
    });

    const voiceId = "short-voice";
    const shortWav = createValidWav(1.5); // 1.5 seconds is < 3.0s minimum
    const refPath = join(dir, "short.wav");
    await writeFile(refPath, shortWav);

    insertTestVoice(store, voiceId, "cloning");
    store.db
      .prepare("UPDATE voices SET reference_path=? WHERE id=?")
      .run(refPath, voiceId);
    const job = store.jobs.enqueue(
      "clone",
      store.voices.find(voiceId)!,
      {},
      10,
    );

    await assert.rejects(
      pipeline.run({
        job,
        dir: join(dir, "attempt"),
        signal: new AbortController().signal,
      }),
      (e) =>
        e instanceof Fault &&
        e.code === "INVALID_REFERENCE" &&
        e.message.includes("5–30 seconds"),
    );
  } finally {
    await cleanup();
  }
});

test("ClonePipeline rejects non-audio or corrupt reference file", async () => {
  const { dir, cleanup } = await createTestDir("tts-clone-corrupt-");
  try {
    const bin = await createMockEngineScript(dir);
    const config = createTestConfig(dir, {
      QWEN_BINARY: bin,
      QWEN_CWD: dir,
    });
    const store = new Store(dir);
    const engine = new QwenEngine({
      binary: bin,
      cwd: dir,
      baseModel: dir,
      customModel: dir,
      threads: 1,
      stageTimeoutMs: 5000,
    });
    const aligner = new AlignerClient("http://127.0.0.1:9999", 5000);
    const pipeline = new ClonePipeline({
      config,
      store,
      engine,
      aligner,
      engineHash: "test",
    });

    const voiceId = "corrupt-voice";
    const corruptPath = join(dir, "corrupt.wav");
    await writeFile(corruptPath, Buffer.from("not audio content"));

    insertTestVoice(store, voiceId, "cloning");
    store.db
      .prepare("UPDATE voices SET reference_path=? WHERE id=?")
      .run(corruptPath, voiceId);
    const job = store.jobs.enqueue(
      "clone",
      store.voices.find(voiceId)!,
      {},
      10,
    );

    await assert.rejects(
      pipeline.run({
        job,
        dir: join(dir, "attempt"),
        signal: new AbortController().signal,
      }),
      (e) =>
        e instanceof Fault &&
        e.code === "INVALID_REFERENCE" &&
        e.message.includes("cannot be decoded"),
    );
  } finally {
    await cleanup();
  }
});
