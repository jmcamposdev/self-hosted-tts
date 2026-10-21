import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Alignment,
  ChunkSummary,
} from "../../../domain/alignment/alignment.types.js";
import type { NarrationMetadata } from "../../../domain/artifacts/metadata.types.js";
import { srt } from "../../../domain/artifacts/subtitles.js";
import { wordsFromAlignment } from "../../../domain/artifacts/words.js";
import type { Job } from "../../../domain/job/job.types.js";
import type { ResolvedSettings } from "../../../domain/settings/settings.types.js";
import type { Voice } from "../../../domain/voice/voice.types.js";
import { wav } from "../../../infra/audio/wav.tools.js";
import { encodeOpus, probe } from "../../../infra/ffmpeg/ffmpeg.js";
import { SAMPLE_RATE } from "../../../shared/constants/audio.constants.js";
import {
  ALIGNMENT_METHOD,
  ENGINE_COMMIT,
  METADATA_SCHEMA_VERSION,
  MODEL_LABEL,
} from "../../../shared/constants/engine.constants.js";
import { ENCODER_DURATION_TOLERANCE_SECONDS } from "../../../shared/constants/limits.constants.js";
import { Fault } from "../../../shared/errors/fault.js";
import { writeJson } from "../../../shared/tools/fs.tools.js";
import { hashFile } from "../../../shared/tools/hash.tools.js";
import type { WorkerDeps } from "../pipeline.types.js";

export interface PublishInput {
  job: Job;
  voice: Voice;
  dir: string;
  signal: AbortSignal;
  pcm: Buffer;
  durationSeconds: number;
  /** Alignment over the ORIGINAL text. */
  alignment: Alignment;
  derivedPositions: number[];
  settings: ResolvedSettings;
  seed: number;
  profileHash: string;
  segments: ChunkSummary[];
}

/** Writes every artifact and atomically marks the job succeeded (fenced by the lease). */
export class PublishStep {
  constructor(private readonly deps: WorkerDeps) {}

  async run(input: PublishInput): Promise<void> {
    const { dir, signal, job } = input;
    const words = wordsFromAlignment(input.alignment);
    await writeFile(join(dir, "audio.wav"), wav(input.pcm));
    await encodeOpus(join(dir, "audio.wav"), join(dir, "audio.opus"), signal);
    const encoded = await probe(join(dir, "audio.opus"), signal);
    if (
      Math.abs(encoded.duration - input.durationSeconds) >
      ENCODER_DURATION_TOLERANCE_SECONDS
    )
      throw new Fault(
        "ENCODER_TIMING",
        "Encoded audio duration diverges from master",
      );
    await writeJson(join(dir, "alignment.json"), input.alignment);
    await writeJson(join(dir, "words.json"), words);
    await writeFile(join(dir, "subtitles.srt"), srt(words));
    const metadata: NarrationMetadata = {
      schema_version: METADATA_SCHEMA_VERSION,
      job_id: job.id,
      voice_id: input.voice.id,
      voice_name: input.voice.name,
      voice_profile_sha256: input.profileHash,
      settings: { ...input.settings, seed: input.seed },
      model: MODEL_LABEL,
      engine_commit: ENGINE_COMMIT,
      engine_sha256: this.deps.engineHash,
      duration_seconds: input.durationSeconds,
      sample_rate: SAMPLE_RATE,
      alignment: {
        method: ALIGNMENT_METHOD,
        derived_character_positions: input.derivedPositions,
        original_text_preserved: true,
      },
      segments: input.segments,
      audio_sha256: await hashFile(join(dir, "audio.opus")),
    };
    await writeJson(join(dir, "metadata.json"), metadata);
    this.deps.store.jobs.finish(job, dir, this.deps.config.retentionMs);
  }
}
