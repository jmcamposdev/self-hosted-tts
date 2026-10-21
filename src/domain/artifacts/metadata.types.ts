import type { ChunkSummary } from "../alignment/alignment.types.js";
import type { ResolvedSettings } from "../settings/settings.types.js";

/** `metadata.json` of a narration job (schema_version 1). */
export interface NarrationMetadata {
  schema_version: 1;
  job_id: string;
  voice_id: string;
  voice_name: string;
  voice_profile_sha256: string;
  settings: ResolvedSettings & { seed: number };
  model: string;
  engine_commit: string;
  engine_sha256: string;
  duration_seconds: number;
  sample_rate: number;
  alignment: {
    method: string;
    derived_character_positions: number[];
    original_text_preserved: true;
  };
  segments: ChunkSummary[];
  audio_sha256: string;
}

/** `metadata.json` of a clone job. */
export interface CloneMetadata {
  voice_id: string;
  reference_duration_seconds: number;
  profile_sha256: string;
  engine_sha256: string;
}
