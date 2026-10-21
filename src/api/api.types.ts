import type { Configuration } from "../config/config.types.js";
import type { JobKind, JobPhase, JobStatus } from "../domain/job/job.types.js";
import type { Settings } from "../domain/settings/settings.types.js";
import type { VoiceStatus } from "../domain/voice/voice.types.js";
import type { AlignerClient } from "../infra/aligner/aligner-client.js";
import type { Store } from "../persistence/store.js";
import type { JobService } from "./services/job.service.js";
import type { VoiceService } from "./services/voice.service.js";

/** Everything a route needs; built once in `createApi`. */
export interface ApiContext {
  config: Configuration;
  store: Store;
  aligner: AlignerClient;
  voices: VoiceService;
  jobs: JobService;
}

export interface PublicVoice {
  voice_id: string;
  name: string;
  status: VoiceStatus;
  voice_settings: Settings;
  created_at: number;
}

export interface PublicJob {
  job_id: string;
  kind: JobKind;
  voice_id: string;
  status: JobStatus;
  phase: JobPhase;
  progress: { completed: number; total: number };
  attempts: number;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  error: { code: string; message: string | null } | null;
}
