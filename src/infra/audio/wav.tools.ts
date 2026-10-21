import { readFile } from "node:fs/promises";
import {
  BYTES_PER_SAMPLE,
  SAMPLE_RATE,
  WAV_HEADER_BYTES,
} from "#shared/constants/audio.constants.js";
import { Fault } from "#shared/errors/fault.js";

/** Reads raw s16le PCM, rejecting odd byte counts (truncated samples). */
export async function readPcm(path: string): Promise<Buffer> {
  const bytes = await readFile(path);
  if (bytes.length % BYTES_PER_SAMPLE)
    throw new Fault("INVALID_PCM", "Invalid PCM length");
  return bytes;
}

/** Wraps mono 16-bit PCM in a canonical 44-byte WAV header. */
export function wav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(WAV_HEADER_BYTES);
  h.write("RIFF", 0);
  h.writeUInt32LE(pcm.length + 36, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28);
  h.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
