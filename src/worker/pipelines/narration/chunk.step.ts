import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { validateAlignment } from "#domain/alignment/alignment.validate.js";
import type { Segment } from "#domain/alignment/alignment.types.js";
import type { Job } from "#domain/job/job.types.js";
import type { ResolvedSettings } from "#domain/settings/settings.types.js";
import type { AlignResponse } from "#infra/aligner/aligner.types.js";
import { applyGain, probe, toRawPcm } from "#infra/ffmpeg/ffmpeg.js";
import type { WorkerDeps } from "../pipeline.types.js";
import {
  chunkFingerprint,
  loadCheckpoint,
  writeChunkRecord,
} from "./checkpoint.js";

export interface ChunkInput {
  job: Job;
  index: number;
  total: number;
  segment: Segment;
  settings: ResolvedSettings;
  /** Job seed plus fragment index. */
  seed: number;
  profilePath: string;
  profileHash: string;
  /** Attempt directory; the fragment lives in `chunk-<index>` inside it. */
  dir: string;
  signal: AbortSignal;
}

export interface ChunkResult {
  /** Directory holding `audio.pcm` (may belong to an earlier attempt). */
  chunkDir: string;
  aligned: AlignResponse;
}

/** Produces one aligned fragment, reusing a valid checkpoint when its fingerprint matches. */
export class ChunkStep {
  constructor(private readonly deps: WorkerDeps) {}

  async run(input: ChunkInput): Promise<ChunkResult> {
    const { store, engine, aligner } = this.deps;
    const { job, index, total, segment, settings, signal } = input;
    const fingerprint = chunkFingerprint({
      text: segment.text,
      settings,
      seed: input.seed,
      engineHash: this.deps.engineHash,
      profileSha256: input.profileHash,
    });
    const reused = await loadCheckpoint(
      store.chunks.find(job, index),
      fingerprint,
    );
    if (reused) return { chunkDir: reused.dir, aligned: reused.aligned };

    const chunkDir = join(input.dir, `chunk-${index}`);
    await mkdir(chunkDir, { recursive: true });
    const engineOut = join(chunkDir, "engine.wav"),
      finalOut = join(chunkDir, "audio.wav");
    store.jobs.progress(job, "synthesizing", index, total);
    await engine.synthesize({
      profilePath: input.profilePath,
      text: segment.text,
      seed: input.seed,
      speed: settings.speed,
      outputPath: engineOut,
      signal,
    });
    await applyGain(engineOut, finalOut, settings.volume, signal);
    store.jobs.progress(job, "aligning", index, total);
    const aligned = await aligner.align(finalOut, segment.text, signal);
    validateAlignment(
      aligned.alignment,
      segment.text,
      (await probe(finalOut, signal)).duration,
    );
    await toRawPcm(finalOut, join(chunkDir, "audio.pcm"), signal);
    await writeChunkRecord(chunkDir, aligned);
    store.chunks.checkpoint(job, index, fingerprint, chunkDir);
    await rm(engineOut, { force: true });
    return { chunkDir, aligned };
  }
}
