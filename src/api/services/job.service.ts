import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Configuration } from "#config/config.types.js";
import {
  ARTIFACT_MIME,
  ARTIFACT_NAMES,
  isArtifactName,
} from "#domain/artifacts/artifacts.js";
import { isActive } from "#domain/job/job.tools.js";
import type { Job } from "#domain/job/job.types.js";
import type { NarrationRequest } from "#domain/narration/narration.schema.js";
import type { JobPurger } from "#infra/storage/job-purger.js";
import type { Store } from "#persistence/store.js";
import { IDEMPOTENCY_KEY_MAX_CHARS } from "#shared/constants/limits.constants.js";
import { Fault } from "#shared/errors/fault.js";
import { publicVoice } from "../presenters/voice.presenter.js";
import type { VoiceService } from "./voice.service.js";

export interface ArtifactFile {
  path: string;
  name: string;
  mime: string;
}

/** Job use cases: enqueue narrations, inspect, cancel, delete and serve results. */
export class JobService {
  constructor(
    private readonly store: Store,
    private readonly config: Configuration,
    private readonly voices: VoiceService,
    private readonly purger: JobPurger,
  ) {}

  find(id: string): Job {
    const job = this.store.jobs.find(id);
    if (!job) throw new Fault("JOB_NOT_FOUND", "Job not found");
    return job;
  }

  enqueueNarration(
    voiceId: string,
    request: NarrationRequest,
    idempotencyKey: string | string[] | undefined,
  ): Job {
    const voice = this.voices.find(voiceId);
    if (voice.status !== "ready")
      throw new Fault("VOICE_NOT_READY", "Voice is not ready");
    if (
      idempotencyKey &&
      (typeof idempotencyKey !== "string" ||
        idempotencyKey.length > IDEMPOTENCY_KEY_MAX_CHARS)
    )
      throw new Fault(
        "INVALID_KEY",
        `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_CHARS} characters`,
      );
    return this.store.jobs.enqueue(
      "tts",
      voice,
      request,
      this.config.maxQueue,
      idempotencyKey || undefined,
    );
  }

  cancel(id: string): Job {
    const job = this.find(id);
    if (isActive(job)) this.store.jobs.requestCancel(job.id);
    return this.find(job.id);
  }

  /** Active jobs are cancelled then purged by the worker; finished ones are purged now. */
  async remove(id: string): Promise<"cancellation_requested" | "deleted"> {
    const job = this.find(id);
    if (isActive(job)) {
      this.store.jobs.requestPurge(job.id);
      return "cancellation_requested";
    }
    await this.purger.purge(job.id);
    return "deleted";
  }

  result(id: string) {
    const job = this.find(id);
    this.assertAvailable(job);
    if (job.kind === "clone")
      return {
        job_id: job.id,
        voice: publicVoice(this.voices.find(job.voice_id)),
      };
    return {
      job_id: job.id,
      expires_at: job.expires_at,
      artifacts: Object.fromEntries(
        ARTIFACT_NAMES.map((name) => [
          name,
          `/v1/jobs/${job.id}/artifacts/${name}`,
        ]),
      ),
    };
  }

  async artifact(id: string, name: string): Promise<ArtifactFile> {
    const job = this.find(id),
      dir = this.assertAvailable(job);
    if (!isArtifactName(name) || job.kind !== "tts")
      throw new Fault("ARTIFACT_NOT_FOUND", "Artifact not found");
    const path = join(dir, name);
    try {
      await stat(path);
    } catch {
      throw new Fault("ARTIFACT_NOT_FOUND", "Artifact not found");
    }
    return { path, name, mime: ARTIFACT_MIME[name] };
  }

  /** Returns the artifact directory of a succeeded, unexpired job. */
  private assertAvailable(job: Job): string {
    if (
      job.status === "expired" ||
      (job.expires_at && job.expires_at <= Date.now())
    )
      throw new Fault("RESULT_EXPIRED", "Result has expired");
    if (job.status !== "succeeded" || !job.artifact_dir)
      throw new Fault("RESULT_NOT_READY", "Job has no completed result");
    return job.artifact_dir;
  }
}
