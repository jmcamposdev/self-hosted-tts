import { runProcess } from "./infra/process/process-runner.js";
import { inspectEngineStderr } from "./infra/engine/qwen-engine.js";

export { probe } from "./infra/ffmpeg/ffmpeg.js";
export { hashFile } from "./shared/tools/hash.tools.js";
export { readPcm as pcm, wav } from "./infra/audio/wav.tools.js";
export { splitText } from "./domain/text/segmentation.js";
export { wordsFromAlignment } from "./domain/artifacts/words.js";
export { srt } from "./domain/artifacts/subtitles.js";

export async function command(
  bin: string,
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
  cwd?: string,
): Promise<string> {
  return runProcess(bin, args, {
    signal,
    timeoutMs,
    cwd,
    inspectStderr: inspectEngineStderr,
  });
}
