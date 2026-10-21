import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createTestDir,
  createValidWav,
  createMockEngineScript,
  createMockAlignerServer,
} from "./test-helpers.js";
import { QwenEngine, inspectEngineStderr } from "#infra/engine/qwen-engine.js";
import { AlignerClient } from "#infra/aligner/aligner-client.js";
import { readPcm, wav } from "#infra/audio/wav.tools.js";
import {
  assertFfmpegAvailable,
  encodeOpus,
  probe,
  applyGain,
  toRawPcm,
} from "#infra/ffmpeg/ffmpeg.js";
import { runProcess } from "#infra/process/process-runner.js";
import { Fault } from "#shared/errors/fault.js";

test("inspectEngineStderr correctly detects and classifies runtime failure signatures", () => {
  // Normal output returns undefined
  assert.equal(inspectEngineStderr("Frame 1/10; EOS at frame 8\n"), undefined);

  // Engine configuration warning
  const config = inspectEngineStderr(
    "Warning: parameter speed ignored; unsupported",
  );
  assert.ok(config instanceof Fault && config.code === "ENGINE_CONFIGURATION");

  const errConfig = inspectEngineStderr("ERROR: unsupported format");
  assert.ok(
    errConfig instanceof Fault && errConfig.code === "ENGINE_CONFIGURATION",
  );

  // Truncated speech
  const truncated = inspectEngineStderr("Frame 10/100; generation stopped");
  assert.ok(
    truncated instanceof Fault && truncated.code === "SYNTHESIS_TRUNCATED",
  );
});

test("QwenEngine preflight, synthesize and error inspection", async () => {
  const { dir, cleanup } = await createTestDir("tts-engine-infra-");
  try {
    const bin = await createMockEngineScript(dir);
    const baseDir = join(dir, "models", "base");
    const customDir = join(dir, "models", "custom");
    await mkdir(baseDir, { recursive: true });
    await mkdir(customDir, { recursive: true });
    await writeFile(join(baseDir, "model.safetensors"), Buffer.alloc(100));
    await writeFile(join(customDir, "model.safetensors"), Buffer.alloc(100));
    await writeFile(
      join(baseDir, "config.json"),
      JSON.stringify({ tts_model_type: "base", tts_model_size: "1b7" }),
    );
    await writeFile(
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

    // Preflight returns binary hash
    const hash = await engine.preflight();
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);

    // Incompatible model throws MODEL_INCOMPATIBLE
    await writeFile(
      join(baseDir, "config.json"),
      JSON.stringify({ tts_model_type: "wrong", tts_model_size: "1b7" }),
    );
    await assert.rejects(
      engine.preflight(),
      (e) => e instanceof Fault && e.code === "MODEL_INCOMPATIBLE",
    );

    // Synthesize writes output wav
    const outWav = join(dir, "synth-out.wav");
    await engine.synthesize({
      profilePath: join(dir, "dummy.qvoice"),
      text: "Hola mundo",
      seed: 12345,
      speed: 1.0,
      outputPath: outWav,
      signal: new AbortController().signal,
    });

    const info = await probe(outWav, new AbortController().signal);
    assert.ok(info.duration > 0);
  } finally {
    await cleanup();
  }
});

test("AlignerClient handles normalize, align, healthy, 5xx failures and timeouts", async () => {
  const alignerMock = await createMockAlignerServer();
  try {
    const client = new AlignerClient(alignerMock.url, 2000);

    // Health
    assert.equal(await client.isHealthy(2000), true);
    await assert.doesNotReject(() => client.assertHealthy());

    // Normalize
    const norm = await client.normalize(
      "Texto a normalizar",
      new AbortController().signal,
    );
    assert.equal(norm.original_text, "Texto a normalizar");
    assert.equal(norm.spoken_text, "Texto a normalizar");

    // Align
    const alignRes = await client.align(
      "/dummy/path.wav",
      "Texto",
      new AbortController().signal,
    );
    assert.equal(alignRes.duration_seconds, 2.0);
    assert.ok(alignRes.alignment.characters.length > 0);
  } finally {
    await alignerMock.close();
  }

  // Test unreachable aligner
  const deadClient = new AlignerClient("http://127.0.0.1:54321", 500);
  assert.equal(await deadClient.isHealthy(500), false);
  await assert.rejects(
    () => deadClient.assertHealthy(),
    (e) => e instanceof Fault && e.code === "ALIGNER_UNAVAILABLE",
  );
  await assert.rejects(
    () => deadClient.normalize("x", new AbortController().signal),
    (e) => e instanceof Fault && e.code === "ALIGNER_UNAVAILABLE",
  );
});

test("readPcm and wav tools validate headers and byte alignments", async () => {
  const { dir, cleanup } = await createTestDir("tts-wav-test-");
  try {
    const pcm = Buffer.alloc(4800, 1);
    const validWav = wav(pcm, 24000);
    assert.equal(validWav.readUInt32LE(24), 24000); // Sample rate at offset 24
    assert.equal(validWav.readUInt16LE(22), 1); // Channels at offset 22

    // Write odd length PCM
    const oddPath = join(dir, "odd.pcm");
    await writeFile(oddPath, Buffer.alloc(15));
    await assert.rejects(
      readPcm(oddPath),
      (e) => e instanceof Fault && e.code === "INVALID_PCM",
    );

    // Write valid PCM
    const evenPath = join(dir, "even.pcm");
    await writeFile(evenPath, pcm);
    const read = await readPcm(evenPath);
    assert.equal(read.length, pcm.length);
  } finally {
    await cleanup();
  }
});

test("FFmpeg operations: assertAvailable, toRawPcm, applyGain, encodeOpus", async () => {
  await assert.doesNotReject(() => assertFfmpegAvailable());

  const { dir, cleanup } = await createTestDir("tts-ffmpeg-test-");
  try {
    const inputWav = join(dir, "input.wav");
    await writeFile(inputWav, createValidWav(1.0));

    // Probe
    const info = await probe(inputWav, new AbortController().signal);
    assert.ok(Math.abs(info.duration - 1.0) < 0.05);
    assert.equal(info.streams[0]?.channels, 1);

    // toRawPcm
    const rawPcm = join(dir, "raw.pcm");
    await toRawPcm(inputWav, rawPcm, new AbortController().signal);
    const rawBytes = await readPcm(rawPcm);
    assert.ok(rawBytes.length > 0);

    // applyGain
    const gainedWav = join(dir, "gain.wav");
    await applyGain(inputWav, gainedWav, 1.2, new AbortController().signal);
    const gainInfo = await probe(gainedWav, new AbortController().signal);
    assert.ok(gainInfo.duration > 0);

    // encodeOpus
    const opusPath = join(dir, "out.opus");
    await encodeOpus(inputWav, opusPath, new AbortController().signal);
    const opusInfo = await probe(opusPath, new AbortController().signal);
    assert.ok(Math.abs(opusInfo.duration - 1.0) < 0.1);
  } finally {
    await cleanup();
  }
});

test("processRunner handles timeout, signal cancellation, and exit codes", async () => {
  const signal = new AbortController().signal;

  // Normal command
  const out = await runProcess(
    process.execPath,
    ["-e", "console.log('runner-ok')"],
    {
      signal,
      timeoutMs: 2000,
    },
  );
  assert.equal(out.trim(), "runner-ok");

  // Non-zero exit code
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.exit(42)"], {
      signal,
      timeoutMs: 2000,
    }),
    (e) => e instanceof Fault && e.code === "PROCESS_FAILED",
  );

  // AbortSignal
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      signal: ac.signal,
      timeoutMs: 5000,
    }),
  );
});
