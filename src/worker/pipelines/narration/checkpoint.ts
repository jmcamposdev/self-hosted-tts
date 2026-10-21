import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChunkCheckpoint } from "#domain/job/job.types.js";
import type { ResolvedSettings } from "#domain/settings/settings.types.js";
import type { AlignResponse } from "#infra/aligner/aligner.types.js";
import { ALIGNMENT_PROTOCOL } from "#shared/constants/engine.constants.js";
import { Fault } from "#shared/errors/fault.js";
import { writeJson } from "#shared/tools/fs.tools.js";
import { hashFile, sha256 } from "#shared/tools/hash.tools.js";

/** Content of `chunk.json` stored next to a fragment's `audio.pcm`. */
export interface ChunkRecord {
  aligned: AlignResponse;
  pcm_sha256: string;
}

export interface FingerprintInput {
  text: string;
  /** Settings exactly as resolved (before seed derivation): key order is part of the hash. */
  settings: ResolvedSettings;
  /** Job seed plus fragment index. */
  seed: number;
  engineHash: string;
  profileSha256: string;
}

/**
 * Identity of a fragment's inputs. A stored checkpoint is reused only when this
 * matches; changing the field set or order invalidates every saved fragment.
 */
export function chunkFingerprint(input: FingerprintInput): string {
  return sha256(
    JSON.stringify({
      text: input.text,
      settings: input.settings,
      seed: input.seed,
      engine: input.engineHash,
      profile_sha256: input.profileSha256,
      alignment_protocol: ALIGNMENT_PROTOCOL,
    }),
  );
}

/** Returns the reusable fragment for `fingerprint`, or undefined; throws if its audio is corrupt. */
export async function loadCheckpoint(
  cached: ChunkCheckpoint | undefined,
  fingerprint: string,
): Promise<{ dir: string; aligned: AlignResponse } | undefined> {
  if (
    cached?.fingerprint !== fingerprint ||
    !existsSync(join(cached.path, "chunk.json")) ||
    !existsSync(join(cached.path, "audio.pcm"))
  )
    return undefined;
  const record = JSON.parse(
    await readFile(join(cached.path, "chunk.json"), "utf8"),
  ) as ChunkRecord;
  if (record.pcm_sha256 !== (await hashFile(join(cached.path, "audio.pcm"))))
    throw new Fault("CHECKPOINT_CORRUPT", "Saved audio checksum mismatch");
  return { dir: cached.path, aligned: record.aligned };
}

export async function writeChunkRecord(
  chunkDir: string,
  aligned: AlignResponse,
): Promise<void> {
  const record: ChunkRecord = {
    aligned,
    pcm_sha256: await hashFile(join(chunkDir, "audio.pcm")),
  };
  await writeJson(join(chunkDir, "chunk.json"), record);
}
