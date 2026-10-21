import { sha256 } from "../../shared/tools/hash.tools.js";
import { DEFAULT_SETTINGS } from "./settings.schema.js";
import type { ResolvedSettings, Settings } from "./settings.types.js";

/** Precedence: defaults < voice defaults < request. Key order feeds the checkpoint fingerprint. */
export function resolveSettings(
  voiceDefaultsJson: string,
  requested?: Settings,
): ResolvedSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(JSON.parse(voiceDefaultsJson) as Settings),
    ...requested,
  };
}

/** Explicit seed, or a stable one derived from the job id. */
export const deriveSeed = (settings: ResolvedSettings, jobId: string): number =>
  settings.seed ?? parseInt(sha256(jobId).slice(0, 7), 16);
