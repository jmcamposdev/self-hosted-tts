import { projectToOriginal } from "../../../domain/alignment/alignment.project.js";
import { validateAlignment } from "../../../domain/alignment/alignment.validate.js";
import { parseRequest, parseSnapshot } from "../../../domain/job/job.tools.js";
import {
  deriveSeed,
  resolveSettings,
} from "../../../domain/settings/settings.tools.js";
import { splitText } from "../../../domain/text/segmentation.js";
import { readPcm } from "../../../infra/audio/wav.tools.js";
import { Fault } from "../../../shared/errors/fault.js";
import { ensureFreeSpace } from "../../../shared/tools/fs.tools.js";
import { hashFile } from "../../../shared/tools/hash.tools.js";
import { join } from "node:path";
import type { JobContext, JobPipeline, WorkerDeps } from "../pipeline.types.js";
import { NarrationAssembler } from "./assemble.step.js";
import { ChunkStep } from "./chunk.step.js";
import { PublishStep } from "./publish.step.js";

/**
 * normalize → split → (synthesize → gain → align → checkpoint) per fragment →
 * assemble → project onto the original text → publish.
 */
export class NarrationPipeline implements JobPipeline {
  readonly kind = "tts" as const;
  private readonly chunkStep: ChunkStep;
  private readonly publishStep: PublishStep;

  constructor(private readonly deps: WorkerDeps) {
    this.chunkStep = new ChunkStep(deps);
    this.publishStep = new PublishStep(deps);
  }

  async run({ job, dir, signal }: JobContext): Promise<void> {
    const { store, config, aligner } = this.deps;
    const voice = parseSnapshot(job),
      request = parseRequest(job);
    if (!voice.profile_path)
      throw new Fault("PROFILE_MISSING", "Voice profile is missing");
    const profileHash = await hashFile(voice.profile_path);
    const settings = resolveSettings(
      voice.defaults_json,
      request.voice_settings,
    );
    const seed = deriveSeed(settings, job.id);

    store.jobs.progress(job, "normalizing", 0, 0);
    const normalized = await aligner.normalize(request.text, signal);
    const segments = splitText(
      normalized.spoken_text,
      settings.paragraph_pause_ms,
    );

    const assembler = new NarrationAssembler();
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted || !store.jobs.owns(job))
        throw new Fault("CANCELLED", "Job cancelled or lease lost");
      ensureFreeSpace(config.data, config.minFreeBytes);
      const segment = segments[i];
      const { chunkDir, aligned } = await this.chunkStep.run({
        job,
        index: i,
        total: segments.length,
        segment,
        settings,
        seed: seed + i,
        profilePath: voice.profile_path,
        profileHash,
        dir,
        signal,
      });
      assembler.add(
        i,
        segment,
        aligned,
        await readPcm(join(chunkDir, "audio.pcm")),
      );
      store.jobs.progress(job, "assembling", i + 1, segments.length);
    }

    validateAlignment(
      assembler.alignment,
      normalized.spoken_text,
      assembler.durationSeconds,
    );
    const { alignment, derivedPositions } = projectToOriginal(
      assembler.alignment,
      normalized.mappings,
      request.text,
      assembler.derived,
    );
    validateAlignment(alignment, request.text, assembler.durationSeconds);
    await this.publishStep.run({
      job,
      voice,
      dir,
      signal,
      pcm: assembler.pcm,
      durationSeconds: assembler.durationSeconds,
      alignment,
      derivedPositions,
      settings,
      seed,
      profileHash,
      segments: assembler.summaries,
    });
  }
}
