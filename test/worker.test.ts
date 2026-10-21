import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { configuration } from "#config.js";
import { Worker } from "#worker.js";
import { defaults, validateAlignment } from "#contracts.js";
import { wav } from "#media.js";

// This test uses explicit synthetic backend doubles. It verifies orchestration,
// output paths, sample offsets and recovery; it does NOT evaluate TTS or CTC quality.
test("worker persists aligned chunks and resumes after aligner failure without regenerating completed speech", async () => {
  const data = await mkdtemp(join(tmpdir(), "tts-worker-"));
  let alignCalls = 0;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const input = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    if (req.url === "/normalize") {
      res.end(
        JSON.stringify({
          original_text: input.text,
          spoken_text: input.text,
          mappings: [
            {
              source_start: 0,
              source_end: Array.from(input.text).length,
              spoken_start: 0,
              spoken_end: Array.from(input.text).length,
              kind: "identity",
            },
          ],
        }),
      );
      return;
    }
    alignCalls++;
    if (alignCalls === 2) {
      res.statusCode = 503;
      res.end("{}");
      return;
    }
    const chars = Array.from(input.text) as string[];
    res.end(
      JSON.stringify({
        alignment: {
          characters: chars,
          character_start_times_seconds: chars.map(
            (_, i) => (i / chars.length) * 2,
          ),
          character_end_times_seconds: chars.map(
            (_, i) => ((i + 1) / chars.length) * 2,
          ),
        },
        words: [],
        derived_positions: [],
        duration_seconds: 2,
        method: "synthetic-test-double",
        model_revision: "test",
        frame_seconds: 0.02,
        mean_word_confidence: 1,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const bin = join(data, "engine.mjs"),
    log = join(data, "engine-calls.log");
  // Require an explicit output path; the real engine defaults to the read-only
  // installation directory when this argument is omitted.
  await writeFile(
    bin,
    `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst args=process.argv.slice(2),i=args.indexOf('-o');\nif(i<0)process.exit(2);\nfs.writeFileSync(args[i+1],Buffer.from('${wav(Buffer.alloc(2 * 48000, 4)).toString("base64")}','base64'));\nfs.appendFileSync(${JSON.stringify(log)},'invoked\\n');\nprocess.stderr.write('Frame 10/1100; EOS at frame 25\\n');\n`,
    { mode: 0o700 },
  );
  const config = configuration({
    DATA_DIR: data,
    API_KEY: "test-only-key-with-at-least-32-characters",
    MIN_FREE_BYTES: "0",
    ALIGNER_URL: `http://127.0.0.1:${address.port}`,
    QWEN_BINARY: bin,
    QWEN_CWD: data,
  });
  const worker = new Worker(config);
  worker.engineHash = "synthetic-test-engine";
  try {
    await mkdir(join(data, "voices", "v"), { recursive: true });
    const profile = join(data, "voices", "v", "profile.qvoice");
    await writeFile(profile, "synthetic-test-profile");
    worker.store.db
      .prepare(
        "INSERT INTO voices VALUES('v','Test','ready',?,'/reference',?,?)",
      )
      .run(JSON.stringify(defaults), profile, Date.now());
    const text = "Hola, primera frase.\n\nÚltima frase.";
    const j = worker.store.enqueue(
      "tts",
      worker.store.voice("v")!,
      { text },
      100,
    );
    await worker.runOne();
    assert.equal(worker.store.job(j.id)!.status, "queued");
    assert.equal(worker.store.job(j.id)!.error_code, "ALIGNER_FAILED");
    assert.ok(worker.store.chunk(worker.store.job(j.id)!, 0));
    await worker.runOne();
    const complete = worker.store.job(j.id)!;
    assert.equal(complete.status, "succeeded");
    assert.equal(complete.error_code, null);
    assert.equal(complete.attempts, 2);
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 3);
    const a = JSON.parse(
      await readFile(join(complete.artifact_dir!, "alignment.json"), "utf8"),
    );
    validateAlignment(a, text, 4.25);
    const metadata = JSON.parse(
      await readFile(join(complete.artifact_dir!, "metadata.json"), "utf8"),
    );
    assert.equal(metadata.duration_seconds, 4.25);
    assert.equal(metadata.segments.length, 2);
    assert.ok(
      (await readFile(join(complete.artifact_dir!, "audio.opus"))).length > 0,
    );
    worker.store.db
      .prepare("UPDATE jobs SET expires_at=1 WHERE id=?")
      .run(j.id);
    await worker.cleanup();
    assert.equal(worker.store.job(j.id)!.status, "expired");
    assert.equal(worker.store.job(j.id)!.request_json, "{}");
    await assert.rejects(readFile(join(complete.artifact_dir!, "audio.wav")));
  } finally {
    server.close();
    worker.store.db.close();
    await rm(data, { recursive: true, force: true });
  }
});
