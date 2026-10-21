import type { NarrationRequest } from "../narration/narration.schema.js";
import type { Voice } from "../voice/voice.types.js";
import type { Job } from "./job.types.js";

/** The voice exactly as it was when the job was enqueued. */
export const parseSnapshot = (job: Job): Voice =>
  JSON.parse(job.snapshot_json) as Voice;

export const parseRequest = (job: Job): NarrationRequest =>
  JSON.parse(job.request_json) as NarrationRequest;

export const isActive = (job: Pick<Job, "status">): boolean =>
  job.status === "queued" || job.status === "running";
