import type { AlignerClient } from "#infra/aligner/aligner-client.js";
import type { QwenEngine } from "#infra/engine/qwen-engine.js";
import { assertFfmpegAvailable } from "#infra/ffmpeg/ffmpeg.js";

/** Fails fast when binaries, models, FFmpeg or the aligner are not ready. Returns the engine SHA-256. */
export async function runPreflight(
  engine: QwenEngine,
  aligner: AlignerClient,
): Promise<string> {
  const engineHash = await engine.preflight();
  await assertFfmpegAvailable();
  await aligner.assertHealthy();
  return engineHash;
}
