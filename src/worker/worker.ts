import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { Configuration } from "#config/config.types.js";
import type { JobKind } from "#domain/job/job.types.js";
import { AlignerClient } from "#infra/aligner/aligner-client.js";
import { QwenEngine } from "#infra/engine/qwen-engine.js";
import { JobPurger } from "#infra/storage/job-purger.js";
import { jobAttemptDir } from "#infra/storage/storage.paths.js";
import { Store } from "#persistence/store.js";
import {
  JANITOR_INTERVAL_MS,
  WORKER_IDLE_DELAY_MS,
} from "#shared/constants/limits.constants.js";
import { Fault } from "#shared/errors/fault.js";
import { logEvent } from "#shared/logging/logger.js";
import { Janitor } from "./janitor.js";
import { LeaseKeeper } from "./lease.js";
import { ClonePipeline } from "./pipelines/clone.pipeline.js";
import { NarrationPipeline } from "./pipelines/narration/narration.pipeline.js";
import type { JobPipeline, WorkerDeps } from "./pipelines/pipeline.types.js";
import { runPreflight } from "./preflight.js";

/**
 * The single compute worker: claims one job at a time under a renewable lease,
 * dispatches it to the pipeline for its kind and records the outcome.
 */
export class Worker {
  readonly store: Store;
  readonly owner = randomUUID();
  private stopped = false;
  private current?: AbortController;
  private readonly deps: WorkerDeps;
  private readonly pipelines: Record<JobKind, JobPipeline>;
  private readonly janitor: Janitor;

  constructor(readonly config: Configuration) {
    this.store = new Store(config.data);
    this.deps = {
      config,
      store: this.store,
      engine: new QwenEngine({
        binary: config.engine,
        cwd: config.engineCwd,
        baseModel: config.baseModel,
        customModel: config.customModel,
        threads: config.threads,
        stageTimeoutMs: config.stageTimeoutMs,
      }),
      aligner: new AlignerClient(config.aligner, config.stageTimeoutMs),
      engineHash: "",
    };
    this.pipelines = {
      clone: new ClonePipeline(this.deps),
      tts: new NarrationPipeline(this.deps),
    };
    this.janitor = new Janitor(
      this.store,
      new JobPurger(this.store.jobs, config.data),
      config.data,
    );
  }

  get db() {
    return this.store.database.sqlite;
  }

  get engineHash(): string {
    return this.deps.engineHash;
  }
  set engineHash(value: string) {
    this.deps.engineHash = value;
  }

  async preflight(): Promise<void> {
    this.deps.engineHash = await runPreflight(
      this.deps.engine,
      this.deps.aligner,
    );
  }

  cleanup(): Promise<void> {
    return this.janitor.sweep();
  }

  /** Claims and processes at most one job. Returns false when the queue is idle. */
  async runOne(): Promise<boolean> {
    const { config, store } = this;
    const job = store.jobs.claim(this.owner, config.leaseMs);
    if (!job) return false;
    const lease = new LeaseKeeper(
      store,
      this.owner,
      job,
      config.leaseMs,
      config.heartbeatMs,
    );
    this.current = lease.controller;
    logEvent({
      event: "job_started",
      job_id: job.id,
      kind: job.kind,
      attempt: job.attempts,
      request_id: job.request_id,
    });
    try {
      const dir = jobAttemptDir(config.data, job.id, job.token!);
      await mkdir(dir, { recursive: true });
      await this.pipelines[job.kind].run({ job, dir, signal: lease.signal });
      logEvent({
        event: "job_completed",
        job_id: job.id,
        request_id: job.request_id,
      });
    } catch (e) {
      const error = this.stopped
        ? new Fault(
            "WORKER_STOPPED",
            "Worker stopped; resuming from checkpoints",
          )
        : e;
      store.jobs.fail(job, error, config.retentionMs);
      if (
        job.kind === "clone" &&
        ["failed", "cancelled"].includes(store.jobs.find(job.id)?.status || "")
      )
        store.voices.failIfCloning(job.voice_id);
      logEvent({
        event: "job_failed",
        job_id: job.id,
        code: error instanceof Fault ? error.code : "INTERNAL_ERROR",
        request_id: job.request_id,
      });
    } finally {
      lease.stop();
      this.current = undefined;
    }
    return true;
  }

  async run(): Promise<void> {
    await this.preflight();
    logEvent({
      event: "worker_ready",
      engine_sha256: this.deps.engineHash,
      threads: this.config.threads,
    });
    let lastCleanup = 0;
    while (!this.stopped) {
      if (Date.now() - lastCleanup > JANITOR_INTERVAL_MS) {
        await this.cleanup();
        lastCleanup = Date.now();
      }
      if (!(await this.runOne())) await delay(WORKER_IDLE_DELAY_MS);
    }
    this.store.locks.release(this.owner);
    this.store.close();
  }

  stop(): void {
    this.stopped = true;
    this.current?.abort();
  }
}
