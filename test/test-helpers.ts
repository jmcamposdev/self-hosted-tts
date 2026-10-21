import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wav } from "#infra/audio/wav.tools.js";
import {
  QVOICE_MAGIC,
  QVOICE_HIDDEN_SIZE,
} from "#shared/constants/engine.constants.js";
import { configuration } from "#config.js";
import type { Configuration } from "#config/config.types.js";
import { Store } from "#persistence/store.js";
import { DEFAULT_SETTINGS } from "#domain/settings/settings.schema.js";

/** Creates an isolated temporary directory with an automatic cleanup helper. */
export async function createTestDir(prefix = "tts-test-"): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Creates a 16-bit mono PCM WAV buffer of specified duration. */
export function createValidWav(
  durationSeconds = 1,
  sampleRate = 24000,
): Buffer {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const pcm = Buffer.alloc(numSamples * 2, 0);
  return wav(pcm, sampleRate);
}

/** Creates a valid `.qvoice` binary profile buffer compatible with the 1.7B engine. */
export function createValidQvoice(
  hiddenSize = QVOICE_HIDDEN_SIZE,
  payloadBytes = 32,
): Buffer {
  const buf = Buffer.alloc(24 + payloadBytes);
  buf.write(QVOICE_MAGIC, 0, 4, "ascii");
  buf.writeUInt32LE(hiddenSize, 8);
  buf.fill(0x42, 24);
  return buf;
}

export interface MockAlignerOptions {
  normalizeError?: boolean;
  alignError?: boolean;
  failAttempts?: number;
  unhealthy?: boolean;
}

/** Spawns an in-memory HTTP server mimicking the alignment service. */
export async function createMockAlignerServer(
  options: MockAlignerOptions = {},
): Promise<{
  server: Server;
  url: string;
  calls: { normalize: number; align: number; health: number };
  close: () => Promise<void>;
}> {
  const calls = { normalize: 0, align: 0, health: 0 };
  let currentAttempt = 0;

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("content-type", "application/json");

    if (req.url === "/health") {
      calls.health++;
      if (options.unhealthy) {
        res.statusCode = 503;
        res.end(JSON.stringify({ status: "unhealthy" }));
      } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: "healthy" }));
      }
      return;
    }

    if (req.url === "/normalize") {
      calls.normalize++;
      if (options.normalizeError) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "normalize failed" }));
        return;
      }
      const data = JSON.parse(body);
      const text = data.text || "";
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          original_text: text,
          spoken_text: text,
          mappings: [
            {
              source_start: 0,
              source_end: Array.from(text).length,
              spoken_start: 0,
              spoken_end: Array.from(text).length,
              kind: "identity",
            },
          ],
        }),
      );
      return;
    }

    if (req.url === "/align") {
      calls.align++;
      currentAttempt++;
      if (
        options.alignError ||
        (options.failAttempts && currentAttempt <= options.failAttempts)
      ) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "align service unavailable" }));
        return;
      }
      const data = JSON.parse(body);
      const chars = Array.from(data.text || "") as string[];
      const duration = 2.0;
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          alignment: {
            characters: chars,
            character_start_times_seconds: chars.map(
              (_, i) => (i / Math.max(1, chars.length)) * duration,
            ),
            character_end_times_seconds: chars.map(
              (_, i) => ((i + 1) / Math.max(1, chars.length)) * duration,
            ),
          },
          words: [],
          derived_positions: [],
          duration_seconds: duration,
          method: "wav2vec2-es-ctc",
          model_revision: "test",
          frame_seconds: 0.02,
          mean_word_confidence: 1,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    calls,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

export interface MockEngineOptions {
  fail?: boolean;
  failOnClone?: boolean;
  failStderr?: string;
  outputWav?: Buffer;
}

/** Writes an executable Node script to `binPath` that acts as the C engine executable. */
export async function createMockEngineScript(
  dir: string,
  options: MockEngineOptions = {},
): Promise<string> {
  const binPath = join(dir, "mock-qwen-tts.mjs");
  const wavBase64 = (options.outputWav || createValidWav(1)).toString("base64");
  const profileBase64 = createValidQvoice().toString("base64");
  const failStderr = options.failStderr || "synthetic engine failure";

  const scriptContent = `#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);

if (args.includes('--caps')) {
  process.stdout.write('qwen_tts 1.7B caps: dotprod=1 openblas=1\\n');
  process.exit(0);
}

if (args.includes('--self-test')) {
  process.stdout.write('Self-test passed\\n');
  process.exit(0);
}

// Clone mode: --ref-audio <ref> ... --save-voice <out>
const saveVoiceIdx = args.indexOf('--save-voice');
if (saveVoiceIdx >= 0) {
  ${
    options.fail || options.failOnClone
      ? `process.stderr.write(${JSON.stringify(failStderr)} + '\\n'); process.exit(1);`
      : `
  const outPath = args[saveVoiceIdx + 1];
  fs.writeFileSync(outPath, Buffer.from('${profileBase64}', 'base64'));
  process.exit(0);
  `
  }
}

// Synthesis mode: -o <out>
const outIdx = args.indexOf('-o');
if (outIdx >= 0) {
  ${
    options.fail
      ? `process.stderr.write(${JSON.stringify(failStderr)} + '\\n'); process.exit(1);`
      : `
  const outPath = args[outIdx + 1];
  fs.writeFileSync(outPath, Buffer.from('${wavBase64}', 'base64'));
  process.stderr.write('Frame 10/100; EOS at frame 25\\n');
  process.exit(0);
  `
  }
}

process.exit(0);
`;

  await writeFile(binPath, scriptContent, { mode: 0o755 });
  return binPath;
}

/** Prepares a test Configuration object with sane defaults. */
export function createTestConfig(
  dataDir: string,
  overrides: Record<string, string> = {},
): Configuration {
  return configuration({
    DATA_DIR: dataDir,
    API_KEY: "test-only-key-with-at-least-32-characters",
    MIN_FREE_BYTES: "0",
    ...overrides,
  });
}

/** Inserts a test voice directly into the store SQLite database. */
export function insertTestVoice(
  store: Store,
  id: string,
  status: "ready" | "cloning" | "deleted" = "ready",
  profilePath?: string,
): void {
  store.db
    .prepare(
      "INSERT INTO voices(id,name,status,defaults_json,reference_path,profile_path,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "Test Voice",
      status,
      JSON.stringify(DEFAULT_SETTINGS),
      "/tmp/reference.wav",
      profilePath || null,
      Date.now(),
    );
}
