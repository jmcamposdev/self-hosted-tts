import type {
  Alignment,
  SourceMapping,
} from "../../domain/alignment/alignment.types.js";

/**
 * HTTP contract with `alignment_service` (mirrors alignment_service/schemas.py;
 * change both together).
 */
export interface NormalizeResponse {
  original_text: string;
  spoken_text: string;
  mappings: SourceMapping[];
}

export interface AlignedWord {
  word: string;
  start: number;
  end: number;
  score: number;
}

export interface AlignResponse {
  alignment: Alignment;
  words: AlignedWord[];
  /** Spoken-text positions whose timing was derived rather than measured. */
  derived_positions: number[];
  duration_seconds: number;
  method: string;
  model_revision: string;
  frame_seconds: number;
  mean_word_confidence: number;
}
