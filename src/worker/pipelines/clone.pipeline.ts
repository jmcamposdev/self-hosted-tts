import { copyFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CloneMetadata } from "#domain/artifacts/metadata.types.js";
import { parseSnapshot } from "#domain/job/job.tools.js";
import { assertQvoiceProfile } from "#infra/engine/qvoice.tools.js";
import { probe, toReferenceWav } from "#infra/ffmpeg/ffmpeg.js";
import { voiceProfilePath } from "#infra/storage/storage.paths.js";
import {
  REFERENCE_MAX_SECONDS,
  REFERENCE_MIN_SECONDS,
} from "#shared/constants/limits.constants.js";
import { Fault } from "#shared/errors/fault.js";
import { writeJson } from "#shared/tools/fs.tools.js";
import { hashFile } from "#shared/tools/hash.tools.js";
import type { JobContext, JobPipeline, WorkerDeps } from "./pipeline.types.js";

/** Turns an uploaded reference into a stored `.qvoice` profile and marks the voice ready. */
export class ClonePipeline implements JobPipeline {
  readonly kind = "clone" as const;
  constructor(private readonly deps: WorkerDeps) {}

  async run({ job, dir, signal }: JobContext): Promise<void> {
    const { store, engine, config } = this.deps;
    const voice = parseSnapshot(job);
    store.jobs.progress(job, "validating_reference", 0, 1);
    let duration: number;
    try {
      duration = (await probe(voice.reference_path, signal)).duration;
    } catch {
      throw new Fault("INVALID_REFERENCE", "Reference audio cannot be decoded");
    }
    if (duration < REFERENCE_MIN_SECONDS || duration > REFERENCE_MAX_SECONDS)
      throw new Fault(
        "INVALID_REFERENCE",
        "Reference must contain 5–30 seconds of audio",
      );
    const referenceWav = join(dir, "reference.wav"),
      profile = join(dir, "profile.qvoice");
    await toReferenceWav(voice.reference_path, referenceWav, signal);
    store.jobs.progress(job, "cloning", 0, 1);
    await engine.cloneProfile({
      referenceWav,
      voiceName: voice.name,
      outputPath: profile,
      signal,
    });
    assertQvoiceProfile(await readFile(profile));
    const final = voiceProfilePath(config.data, voice.id, job.token!);
    await copyFile(profile, final);
    const metadata: CloneMetadata = {
      voice_id: voice.id,
      reference_duration_seconds: duration,
      profile_sha256: await hashFile(final),
      engine_sha256: this.deps.engineHash,
    };
    await writeJson(join(dir, "metadata.json"), metadata);
    try {
      store.transaction(() => {
        if (!store.jobs.owns(job)) throw new Fault("LEASE_LOST", "Lease lost");
        store.voices.markReady(voice.id, final);
        store.jobs.finish(job, dir, config.retentionMs);
      });
    } catch (e) {
      await rm(final, { force: true });
      throw e;
    }
  }
}
