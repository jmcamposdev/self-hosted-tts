import {
  SAMPLE_RATE,
  BYTES_PER_SAMPLE,
  BYTES_PER_SECOND,
} from "../../../shared/constants/audio.constants.js";
import { MAX_OUTPUT_SECONDS } from "../../../shared/constants/limits.constants.js";
import {
  appendAlignment,
  emptyAlignment,
} from "../../../domain/alignment/alignment.merge.js";
import type {
  Alignment,
  ChunkSummary,
  Segment,
} from "../../../domain/alignment/alignment.types.js";
import { validateAlignment } from "../../../domain/alignment/alignment.validate.js";
import type { AlignResponse } from "../../../infra/aligner/aligner.types.js";
import { Fault } from "../../../shared/errors/fault.js";

/**
 * Concatenates fragments into one master timeline. Offsets use the real number
 * of samples written (including paragraph silences), never estimated durations.
 */
export class NarrationAssembler {
  readonly alignment: Alignment = emptyAlignment();
  /** Spoken-text positions whose timing is derived. */
  readonly derived = new Set<number>();
  readonly summaries: ChunkSummary[] = [];
  private readonly parts: Buffer[] = [];
  private samples = 0;

  get durationSeconds(): number {
    return this.samples / SAMPLE_RATE;
  }

  get pcm(): Buffer {
    return Buffer.concat(this.parts);
  }

  add(
    index: number,
    segment: Segment,
    aligned: AlignResponse,
    audio: Buffer,
  ): void {
    const offset = this.durationSeconds;
    validateAlignment(
      aligned.alignment,
      segment.text,
      audio.length / BYTES_PER_SECOND,
    );
    appendAlignment(this.alignment, aligned.alignment, offset);
    aligned.derived_positions.forEach((p) =>
      this.derived.add(segment.start + p),
    );
    this.parts.push(audio);
    this.samples += audio.length / BYTES_PER_SAMPLE;
    const silence = Buffer.alloc(
      Math.round((segment.pauseMs * SAMPLE_RATE) / 1000) * BYTES_PER_SAMPLE,
    );
    this.parts.push(silence);
    this.samples += silence.length / BYTES_PER_SAMPLE;
    this.summaries.push({
      index,
      source: "ctc",
      duration_seconds: audio.length / BYTES_PER_SECOND,
      offset_seconds: offset,
      confidence: aligned.mean_word_confidence,
      frame_seconds: aligned.frame_seconds,
      model_revision: aligned.model_revision,
    });
    if (this.durationSeconds > MAX_OUTPUT_SECONDS)
      throw new Fault(
        "DURATION_LIMIT",
        "Narration exceeds the 30 minute output limit",
      );
  }
}
