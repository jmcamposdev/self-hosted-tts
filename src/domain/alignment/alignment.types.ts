/** ElevenLabs-style per-character alignment: the only shape written to alignment.json. */
export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface Word {
  word: string;
  start: number;
  end: number;
  score?: number;
}

/** Text segment sent to the engine (offsets are code points in the spoken text). */
export interface Segment {
  text: string;
  start: number;
  end: number;
  pauseMs: number;
}

/** Maps a span of the original text to the span actually spoken. */
export interface SourceMapping {
  source_start: number;
  source_end: number;
  spoken_start: number;
  spoken_end: number;
  kind: "identity" | "expanded";
}

export interface ChunkSummary {
  index: number;
  source: "ctc";
  duration_seconds: number;
  offset_seconds: number;
  confidence: number;
  frame_seconds: number;
  model_revision: string;
}
