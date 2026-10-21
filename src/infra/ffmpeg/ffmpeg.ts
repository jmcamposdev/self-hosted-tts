import {
  SAMPLE_RATE,
  OPUS_BITRATE,
} from "../../shared/constants/audio.constants.js";
import {
  FFMPEG_TIMEOUT_MS,
  PREFLIGHT_TIMEOUT_MS,
} from "../../shared/constants/limits.constants.js";
import { Fault } from "../../shared/errors/fault.js";
import { runProcess } from "../process/process-runner.js";
import type { MediaInfo } from "./ffmpeg.types.js";

const BASE = ["-v", "error", "-nostdin", "-y"];
const MONO_24K = ["-ac", "1", "-ar", String(SAMPLE_RATE)];

const ffmpeg = (args: string[], signal: AbortSignal) =>
  runProcess("ffmpeg", [...BASE, ...args], {
    signal,
    timeoutMs: FFMPEG_TIMEOUT_MS,
  }).then(() => undefined);

export async function assertFfmpegAvailable(): Promise<void> {
  await runProcess("ffmpeg", ["-version"], {
    signal: new AbortController().signal,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });
}

/** Duration and stream facts of a media file; throws INVALID_AUDIO without a finite duration. */
export async function probe(
  path: string,
  signal: AbortSignal,
): Promise<MediaInfo> {
  const out = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,sample_rate,channels",
      "-of",
      "json",
      path,
    ],
    { signal, timeoutMs: FFMPEG_TIMEOUT_MS },
  );
  const data = JSON.parse(out),
    duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Fault("INVALID_AUDIO", "Audio has no finite duration");
  return { duration, streams: data.streams };
}

/** Normalizes an uploaded reference to mono 24 kHz PCM WAV (first audio stream). */
export const toReferenceWav = (
  input: string,
  output: string,
  signal: AbortSignal,
) =>
  ffmpeg(
    ["-i", input, "-map", "0:a:0", ...MONO_24K, "-c:a", "pcm_s16le", output],
    signal,
  );

/**
 * Applies user gain with a limiter before alignment. The C engine's own volume
 * operation would hard-clip boosted samples, so it is never used.
 */
export const applyGain = (
  input: string,
  output: string,
  volume: number,
  signal: AbortSignal,
) =>
  ffmpeg(
    [
      "-i",
      input,
      "-af",
      `volume=${volume},alimiter=limit=0.98:level=false:latency=true`,
      ...MONO_24K,
      "-c:a",
      "pcm_s16le",
      output,
    ],
    signal,
  );

/** Raw signed 16-bit little-endian mono PCM used for gapless assembly. */
export const toRawPcm = (input: string, output: string, signal: AbortSignal) =>
  ffmpeg(["-i", input, "-f", "s16le", ...MONO_24K, output], signal);

export const encodeOpus = (
  input: string,
  output: string,
  signal: AbortSignal,
) =>
  ffmpeg(
    [
      "-i",
      input,
      "-c:a",
      "libopus",
      "-b:a",
      OPUS_BITRATE,
      "-application",
      "audio",
      output,
    ],
    signal,
  );
