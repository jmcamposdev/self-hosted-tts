import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { configuration } from "../src/config.js";
import { Worker } from "../src/worker.js";
import { defaults } from "../src/contracts.js";
import { wav } from "../src/media.js";

// Characterization (golden) test. It pins the externally observable output of a
// narration job: alignment projection onto the ORIGINAL text (identity and
// expanded numbers), words, SRT, metadata shape and the chunk fingerprint.
// The refactor must keep this file passing WITHOUT editing the golden values.
// Regenerate deliberately with UPDATE_GOLDEN=1.
const GOLDEN = join(import.meta.dirname, "golden", "narration.json");

const TEXT = "Año 1945 fin.\n\nOtra vez.";
const NUMBER = "mil novecientos cuarenta y cinco";

test("golden: narration artifacts, projection and checkpoint fingerprint", async () => {
  const data = await mkdtemp(join(tmpdir(), "tts-golden-"));
  const alignedTexts: string[] = [];
  const source = Array.from(TEXT);
  const head = "Año ".length;
  const mappings = [
    {
      source_start: 0,
      source_end: head,
      spoken_start: 0,
      spoken_end: head,
      kind: "identity",
    },
    {
      source_start: head,
      source_end: head + 4,
      spoken_start: head,
      spoken_end: head + NUMBER.length,
      kind: "expanded",
    },
    {
      source_start: head + 4,
      source_end: source.length,
      spoken_start: head + NUMBER.length,
      spoken_end: head + NUMBER.length + (source.length - head - 4),
      kind: "identity",
    },
  ];
  const spoken = `Año ${NUMBER}${source.slice(head + 4).join("")}`;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const input = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    if (req.url === "/normalize") {
      res.end(
        JSON.stringify({
          original_text: input.text,
          spoken_text: spoken,
          mappings,
        }),
      );
      return;
    }
    alignedTexts.push(input.text);
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
        derived_positions: [1],
        duration_seconds: 2,
        method: "synthetic-test-double",
        model_revision: "test",
        frame_seconds: 0.02,
        mean_word_confidence: 0.5,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const bin = join(data, "engine.mjs");
  await writeFile(
    bin,
    `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst args=process.argv.slice(2),i=args.indexOf('-o');\nif(i<0)process.exit(2);\nfs.writeFileSync(args[i+1],Buffer.from('${wav(Buffer.alloc(2 * 48000, 4)).toString("base64")}','base64'));\nprocess.stderr.write('Frame 10/1100; EOS at frame 25\\n');\n`,
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
    const job = worker.store.enqueue(
      "tts",
      worker.store.voice("v")!,
      { text: TEXT, voice_settings: { seed: 42 } },
      100,
    );
    await worker.runOne();
    const done = worker.store.job(job.id)!;
    assert.equal(done.status, "succeeded");
    const read = async (name: string) =>
      readFile(join(done.artifact_dir!, name), "utf8");
    const metadata = JSON.parse(await read("metadata.json"));
    delete metadata.job_id;
    delete metadata.audio_sha256; // Opus bytes depend on the local FFmpeg build.
    const chunk = worker.store.chunk(done, 0)!;
    const actual = {
      alignment: JSON.parse(await read("alignment.json")),
      words: JSON.parse(await read("words.json")),
      subtitles: await read("subtitles.srt"),
      metadata,
      chunk_fingerprints: [0, 1].map(
        (i) => worker.store.chunk(done, i)!.fingerprint,
      ),
      aligned_texts: alignedTexts,
      files: [
        "audio.opus",
        "audio.wav",
        "alignment.json",
        "words.json",
        "subtitles.srt",
        "metadata.json",
      ].filter((n) => existsSync(join(done.artifact_dir!, n))),
      chunk_fingerprint_is_sha256: /^[0-9a-f]{64}$/.test(chunk.fingerprint),
      wav_sha256: createHash("sha256")
        .update(await readFile(join(done.artifact_dir!, "audio.wav")))
        .digest("hex"),
    };
    if (process.env.UPDATE_GOLDEN) {
      await mkdir(join(import.meta.dirname, "golden"), { recursive: true });
      await writeFile(GOLDEN, JSON.stringify(actual, null, 2) + "\n");
    }
    assert.deepEqual(actual, JSON.parse(await readFile(GOLDEN, "utf8")));
  } finally {
    server.close();
    worker.store.db.close();
    await rm(data, { recursive: true, force: true });
  }
});
