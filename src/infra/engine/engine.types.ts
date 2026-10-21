export interface EngineSettings {
  binary: string;
  cwd: string;
  baseModel: string;
  customModel: string;
  threads: number;
  stageTimeoutMs: number;
}

export interface CloneProfileInput {
  referenceWav: string;
  voiceName: string;
  outputPath: string;
  signal: AbortSignal;
}

export interface SynthesizeInput {
  profilePath: string;
  text: string;
  /** Already offset per fragment (job seed + fragment index). */
  seed: number;
  speed: number;
  outputPath: string;
  signal: AbortSignal;
}
