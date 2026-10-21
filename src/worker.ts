import { randomUUID, createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
  stat,
} from "node:fs/promises";
import { statfsSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { configuration, type Configuration } from "./config.js";
import { Store, type Job, type Voice } from "./store.js";
import {
  Fault,
  defaults,
  validateAlignment,
  type Alignment,
  type Settings,
} from "./contracts.js";
import {
  command,
  probe,
  hashFile,
  pcm,
  wav,
  splitText,
  wordsFromAlignment,
  srt,
} from "./media.js";

type Normalized = {
  original_text: string;
  spoken_text: string;
  mappings: {
    source_start: number;
    source_end: number;
    spoken_start: number;
    spoken_end: number;
    kind: string;
  }[];
};
type Aligned = {
  alignment: Alignment;
  words: { word: string; start: number; end: number; score: number }[];
  derived_positions: number[];
  duration_seconds: number;
  method: string;
  model_revision: string;
  frame_seconds: number;
  mean_word_confidence: number;
};
const fingerprint = (s: string) => createHash("sha256").update(s).digest("hex");
const json = async (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n");
async function internal<T>(
  config: Configuration,
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch(config.aligner + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(config.stageTimeoutMs),
      ]),
    });
  } catch {
    throw new Fault(
      "ALIGNER_UNAVAILABLE",
      "Alignment service unavailable or timed out",
      503,
      true,
    );
  }
  if (!r.ok) {
    const detail = (await r.json().catch(() => ({}))) as { detail?: unknown };
    throw new Fault(
      r.status === 422 ? "ALIGNMENT_REJECTED" : "ALIGNER_FAILED",
      r.status === 422
        ? typeof detail.detail === "string"
          ? detail.detail.slice(0, 300)
          : "Text normalization or alignment rejected"
        : "Alignment service failed",
      r.status === 422 ? 422 : 503,
      r.status !== 422,
    );
  }
  return (await r.json()) as T;
}

export class Worker {
  store: Store;
  owner = randomUUID();
  stopped = false;
  current?: AbortController;
  engineHash = "";
  constructor(public config: Configuration) {
    this.store = new Store(config.data);
  }
  async preflight() {
    for (const path of [
      this.config.engine,
      join(this.config.baseModel, "model.safetensors"),
      join(this.config.customModel, "model.safetensors"),
    ])
      await access(path);
    for (const [path, kind] of [
      [this.config.baseModel, "base"],
      [this.config.customModel, "custom_voice"],
    ] as const) {
      const cfg = JSON.parse(await readFile(join(path, "config.json"), "utf8"));
      if (cfg.tts_model_type !== kind || cfg.tts_model_size !== "1b7")
        throw new Fault(
          "MODEL_INCOMPATIBLE",
          "Expected Qwen3-TTS 1.7B Base and CustomVoice",
          500,
        );
    }
    this.engineHash = await hashFile(this.config.engine);
    await command("ffmpeg", ["-version"], new AbortController().signal, 10000);
    const health = await fetch(this.config.aligner + "/health", {
      signal: AbortSignal.timeout(10000),
    });
    if (!health.ok)
      throw new Fault(
        "ALIGNER_UNAVAILABLE",
        "Alignment model not ready",
        503,
        true,
      );
  }
  async clone(j: Job, dir: string, signal: AbortSignal) {
    const voice = JSON.parse(j.snapshot_json) as Voice;
    this.store.progress(j, "validating_reference", 0, 1);
    let info;
    try {
      info = await probe(voice.reference_path, signal);
    } catch {
      throw new Fault(
        "INVALID_REFERENCE",
        "Reference audio cannot be decoded",
        422,
      );
    }
    if (info.duration < 5 || info.duration > 30.05)
      throw new Fault(
        "INVALID_REFERENCE",
        "Reference must contain 5–30 seconds of audio",
        422,
      );
    const ref = join(dir, "reference.wav"),
      profile = join(dir, "profile.qvoice");
    await command(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-i",
        voice.reference_path,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "24000",
        "-c:a",
        "pcm_s16le",
        ref,
      ],
      signal,
      120000,
    );
    this.store.progress(j, "cloning", 0, 1);
    await command(
      this.config.engine,
      [
        "-d",
        this.config.baseModel,
        "--ref-audio",
        ref,
        "-l",
        "Spanish",
        "--int8",
        "-j",
        String(this.config.threads),
        "--voice-name",
        voice.name,
        "--save-voice",
        profile,
      ],
      signal,
      this.config.stageTimeoutMs,
      this.config.engineCwd,
    );
    const buf = await readFile(profile);
    if (
      buf.length < 24 ||
      buf.toString("ascii", 0, 4) !== "QVCE" ||
      buf.readUInt32LE(8) !== 2048 ||
      buf.length > 64 * 1024 ** 2
    )
      throw new Fault(
        "INVALID_PROFILE",
        "Cloned profile is incompatible with 1.7B",
        500,
      );
    const final = join(
      this.config.data,
      "voices",
      voice.id,
      `profile-${j.token}.qvoice`,
    );
    await copyFile(profile, final);
    await json(join(dir, "metadata.json"), {
      voice_id: voice.id,
      reference_duration_seconds: info.duration,
      profile_sha256: await hashFile(final),
      engine_sha256: this.engineHash,
    });
    try {
      this.store.transaction(() => {
        if (!this.store.owns(j))
          throw new Fault("LEASE_LOST", "Lease lost", 409);
        this.store.db
          .prepare(
            "UPDATE voices SET status='ready',profile_path=? WHERE id=? AND status='cloning'",
          )
          .run(final, voice.id);
        this.store.finish(j, dir, this.config.retentionMs);
      });
    } catch (e) {
      await rm(final, { force: true });
      throw e;
    }
  }
  async narration(j: Job, dir: string, signal: AbortSignal) {
    const voice = JSON.parse(j.snapshot_json) as Voice,
      request = JSON.parse(j.request_json) as {
        text: string;
        voice_settings?: Settings;
      };
    if (!voice.profile_path)
      throw new Fault("PROFILE_MISSING", "Voice profile is missing", 500);
    const profileHash = await hashFile(voice.profile_path);
    const settings = {
      ...defaults,
      ...JSON.parse(voice.defaults_json),
      ...request.voice_settings,
    } as Required<Settings>;
    const seed = settings.seed ?? parseInt(fingerprint(j.id).slice(0, 7), 16);
    this.store.progress(j, "normalizing", 0, 0);
    const normalized = await internal<Normalized>(
      this.config,
      "/normalize",
      { text: request.text },
      signal,
    );
    const segments = splitText(
      normalized.spoken_text,
      settings.paragraph_pause_ms,
    );
    const combined: Alignment = {
      characters: [],
      character_start_times_seconds: [],
      character_end_times_seconds: [],
    };
    const derived = new Set<number>(),
      pcmParts: Buffer[] = [];
    let samples = 0;
    const chunkMeta: unknown[] = [];
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted || !this.store.owns(j))
        throw new Fault("CANCELLED", "Job cancelled or lease lost", 409);
      const free = statfsSync(this.config.data);
      if (free.bavail * free.bsize < this.config.minFreeBytes)
        throw new Fault("STORAGE_FULL", "Insufficient free disk space", 507);
      const seg = segments[i];
      const fp = fingerprint(
        JSON.stringify({
          text: seg.text,
          settings,
          seed: seed + i,
          engine: this.engineHash,
          profile_sha256: profileHash,
          alignment_protocol: "es-ctc-v2-word-delimiters",
        }),
      );
      const cached = this.store.chunk(j, i);
      let chunkDir = join(dir, `chunk-${i}`),
        aligned: Aligned;
      if (
        cached?.fingerprint === fp &&
        existsSync(join(cached.path, "chunk.json")) &&
        existsSync(join(cached.path, "audio.pcm"))
      ) {
        chunkDir = cached.path;
        const record = JSON.parse(
          await readFile(join(chunkDir, "chunk.json"), "utf8"),
        );
        if (record.pcm_sha256 !== (await hashFile(join(chunkDir, "audio.pcm"))))
          throw new Fault(
            "CHECKPOINT_CORRUPT",
            "Saved audio checksum mismatch",
            500,
          );
        aligned = record.aligned;
      } else {
        await mkdir(chunkDir, { recursive: true });
        const engineOut = join(chunkDir, "engine.wav"),
          finalOut = join(chunkDir, "audio.wav");
        this.store.progress(j, "synthesizing", i, segments.length);
        await command(
          this.config.engine,
          [
            "-d",
            this.config.customModel,
            "--load-voice",
            voice.profile_path,
            "--icl-only",
            "-l",
            "Spanish",
            "--int8",
            "-j",
            String(this.config.threads),
            "--seed",
            String((seed + i) % 2147483648),
            "--temperature",
            "1.0",
            "--max-tokens",
            "1100",
            "--text",
            seg.text,
            "--rate",
            String(settings.speed),
            "-o",
            engineOut,
          ],
          signal,
          this.config.stageTimeoutMs,
          this.config.engineCwd,
        );
        // Apply user gain with a limiter before alignment. No gain is applied by
        // the C engine, whose volume operation would hard-clip boosted samples.
        await command(
          "ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-i",
            engineOut,
            "-af",
            `volume=${settings.volume},alimiter=limit=0.98:level=false:latency=true`,
            "-ac",
            "1",
            "-ar",
            "24000",
            "-c:a",
            "pcm_s16le",
            finalOut,
          ],
          signal,
          120000,
        );
        this.store.progress(j, "aligning", i, segments.length);
        aligned = await internal<Aligned>(
          this.config,
          "/align",
          { path: finalOut, text: seg.text },
          signal,
        );
        const duration = (await probe(finalOut, signal)).duration;
        validateAlignment(aligned.alignment, seg.text, duration);
        await command(
          "ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-i",
            finalOut,
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            "24000",
            join(chunkDir, "audio.pcm"),
          ],
          signal,
          120000,
        );
        await json(join(chunkDir, "chunk.json"), {
          aligned,
          pcm_sha256: await hashFile(join(chunkDir, "audio.pcm")),
        });
        this.store.checkpoint(j, i, fp, chunkDir);
        await rm(engineOut, { force: true });
      }
      const audio = await pcm(join(chunkDir, "audio.pcm"));
      const offset = samples / 24000;
      validateAlignment(aligned.alignment, seg.text, audio.length / 48000);
      combined.characters.push(...aligned.alignment.characters);
      combined.character_start_times_seconds.push(
        ...aligned.alignment.character_start_times_seconds.map(
          (t) => t + offset,
        ),
      );
      combined.character_end_times_seconds.push(
        ...aligned.alignment.character_end_times_seconds.map((t) => t + offset),
      );
      aligned.derived_positions.forEach((p) => derived.add(seg.start + p));
      pcmParts.push(audio);
      samples += audio.length / 2;
      const silence = Buffer.alloc(Math.round(seg.pauseMs * 24) * 2);
      pcmParts.push(silence);
      samples += silence.length / 2;
      chunkMeta.push({
        index: i,
        source: "ctc",
        duration_seconds: audio.length / 48000,
        offset_seconds: offset,
        confidence: aligned.mean_word_confidence,
        frame_seconds: aligned.frame_seconds,
        model_revision: aligned.model_revision,
      });
      if (samples / 24000 > 1800)
        throw new Fault(
          "DURATION_LIMIT",
          "Narration exceeds the 30 minute output limit",
          422,
        );
      this.store.progress(j, "assembling", i + 1, segments.length);
    }
    validateAlignment(combined, normalized.spoken_text, samples / 24000);
    const a: Alignment = {
        characters: Array.from(request.text),
        character_start_times_seconds: [],
        character_end_times_seconds: [],
      },
      projected: number[] = [];
    for (const map of normalized.mappings) {
      if (map.kind === "identity")
        for (let p = map.source_start; p < map.source_end; p++) {
          const q = map.spoken_start + p - map.source_start;
          a.character_start_times_seconds.push(
            combined.character_start_times_seconds[q],
          );
          a.character_end_times_seconds.push(
            combined.character_end_times_seconds[q],
          );
          if (derived.has(q)) projected.push(p);
        }
      else {
        const start = combined.character_start_times_seconds[map.spoken_start],
          end = combined.character_end_times_seconds[map.spoken_end - 1],
          count = map.source_end - map.source_start;
        for (let p = 0; p < count; p++) {
          a.character_start_times_seconds.push(
            start + ((end - start) * p) / count,
          );
          a.character_end_times_seconds.push(
            start + ((end - start) * (p + 1)) / count,
          );
          projected.push(map.source_start + p);
        }
      }
    }
    validateAlignment(a, request.text, samples / 24000);
    const words = wordsFromAlignment(a);
    await writeFile(join(dir, "audio.wav"), wav(Buffer.concat(pcmParts)));
    await command(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-i",
        join(dir, "audio.wav"),
        "-c:a",
        "libopus",
        "-b:a",
        "64k",
        "-application",
        "audio",
        join(dir, "audio.opus"),
      ],
      signal,
      120000,
    );
    const encoded = await probe(join(dir, "audio.opus"), signal);
    if (Math.abs(encoded.duration - samples / 24000) > 0.08)
      throw new Fault(
        "ENCODER_TIMING",
        "Encoded audio duration diverges from master",
        500,
      );
    await json(join(dir, "alignment.json"), a);
    await json(join(dir, "words.json"), words);
    await writeFile(join(dir, "subtitles.srt"), srt(words));
    await json(join(dir, "metadata.json"), {
      schema_version: 1,
      job_id: j.id,
      voice_id: voice.id,
      voice_name: voice.name,
      voice_profile_sha256: profileHash,
      settings: { ...settings, seed },
      model: "Qwen3-TTS-12Hz-1.7B-CustomVoice",
      engine_commit: "ef339be58a778b062e1c14382347964552eae007",
      engine_sha256: this.engineHash,
      duration_seconds: samples / 24000,
      sample_rate: 24000,
      alignment: {
        method: "wav2vec2-es-ctc",
        derived_character_positions: projected,
        original_text_preserved: true,
      },
      segments: chunkMeta,
      audio_sha256: await hashFile(join(dir, "audio.opus")),
    });
    this.store.finish(j, dir, this.config.retentionMs);
  }
  async cleanup() {
    const deletedVoices = this.store.db
      .prepare("SELECT id FROM voices WHERE status='deleted'")
      .all() as { id: string }[];
    for (const v of deletedVoices)
      await rm(join(this.config.data, "voices", v.id), {
        recursive: true,
        force: true,
      });
    const expired = this.store.db
      .prepare(
        "SELECT * FROM jobs WHERE expires_at<=? AND status NOT IN ('running','queued')",
      )
      .all(Date.now()) as Job[];
    for (const j of expired) {
      this.store.db
        .prepare(
          "UPDATE jobs SET status='expired',artifact_dir=NULL WHERE id=?",
        )
        .run(j.id);
      await rm(join(this.config.data, "jobs", j.id), {
        recursive: true,
        force: true,
      });
      this.store.db.prepare("DELETE FROM chunks WHERE job_id=?").run(j.id);
      this.store.db
        .prepare(
          "UPDATE jobs SET expires_at=NULL,request_json='{}',snapshot_json='{}' WHERE id=?",
        )
        .run(j.id);
    }
  }
  async runOne() {
    const j = this.store.claim(this.owner, this.config.leaseMs);
    if (!j) return false;
    const controller = new AbortController();
    this.current = controller;
    const timer = setInterval(() => {
      try {
        if (!this.store.heartbeat(this.owner, j, this.config.leaseMs))
          controller.abort();
      } catch {
        controller.abort();
      }
    }, this.config.heartbeatMs);
    const dir = join(this.config.data, "jobs", j.id, String(j.token));
    console.log(
      JSON.stringify({
        event: "job_started",
        job_id: j.id,
        kind: j.kind,
        attempt: j.attempts,
      }),
    );
    try {
      await mkdir(dir, { recursive: true });
      if (j.kind === "clone") await this.clone(j, dir, controller.signal);
      else await this.narration(j, dir, controller.signal);
      console.log(JSON.stringify({ event: "job_completed", job_id: j.id }));
    } catch (e) {
      const error = this.stopped
        ? new Fault(
            "WORKER_STOPPED",
            "Worker stopped; resuming from checkpoints",
            503,
            true,
          )
        : e;
      this.store.fail(j, error, this.config.retentionMs);
      if (
        j.kind === "clone" &&
        ["failed", "cancelled"].includes(this.store.job(j.id)?.status || "")
      )
        this.store.db
          .prepare(
            "UPDATE voices SET status='failed' WHERE id=? AND status='cloning'",
          )
          .run(j.voice_id);
      console.log(
        JSON.stringify({
          event: "job_failed",
          job_id: j.id,
          code: error instanceof Fault ? error.code : "INTERNAL_ERROR",
        }),
      );
    } finally {
      clearInterval(timer);
      this.current = undefined;
    }
    return true;
  }
  async run() {
    await this.preflight();
    console.log(
      JSON.stringify({
        event: "worker_ready",
        engine_sha256: this.engineHash,
        threads: this.config.threads,
      }),
    );
    let lastCleanup = 0;
    while (!this.stopped) {
      if (Date.now() - lastCleanup > 60_000) {
        await this.cleanup();
        lastCleanup = Date.now();
      }
      if (!(await this.runOne())) await delay(1000);
    }
    this.store.db
      .prepare("DELETE FROM locks WHERE name='worker' AND owner=?")
      .run(this.owner);
    this.store.db.close();
  }
  stop() {
    this.stopped = true;
    this.current?.abort();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const worker = new Worker(configuration());
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.once(sig, () => worker.stop());
  await worker.run();
}
