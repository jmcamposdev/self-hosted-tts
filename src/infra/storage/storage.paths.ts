import { join } from "node:path";

/** Filesystem layout under DATA_DIR. Only this module knows these names. */
export const voiceDir = (data: string, voiceId: string) =>
  join(data, "voices", voiceId);

export const voiceReferencePath = (data: string, voiceId: string) =>
  join(voiceDir(data, voiceId), "reference.upload");

export const voiceProfilePath = (
  data: string,
  voiceId: string,
  token: string,
) => join(voiceDir(data, voiceId), `profile-${token}.qvoice`);

export const jobRoot = (data: string, jobId: string) =>
  join(data, "jobs", jobId);

/** Per-attempt work directory (the fencing token isolates retries). */
export const jobAttemptDir = (data: string, jobId: string, token: string) =>
  join(jobRoot(data, jobId), token);
