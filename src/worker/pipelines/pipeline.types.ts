import type { Configuration } from "#config/config.types.js";
import type { Job, JobKind } from "#domain/job/job.types.js";
import type { AlignerClient } from "#infra/aligner/aligner-client.js";
import type { QwenEngine } from "#infra/engine/qwen-engine.js";
import type { Store } from "#persistence/store.js";

/** Collaborators shared by every pipeline. `engineHash` is set during preflight. */
export interface WorkerDeps {
  config: Configuration;
  store: Store;
  engine: QwenEngine;
  aligner: AlignerClient;
  engineHash: string;
}

/** What a pipeline receives for one claimed job attempt. */
export interface JobContext {
  job: Job;
  /** Per-attempt work directory (already created). */
  dir: string;
  /** Aborts on cancellation, lease loss or worker shutdown. */
  signal: AbortSignal;
}

/** One kind of job. Add a new job type by implementing this and registering it in `Worker`. */
export interface JobPipeline {
  readonly kind: JobKind;
  run(context: JobContext): Promise<void>;
}
