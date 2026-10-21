export type VoiceStatus = "cloning" | "ready" | "failed" | "deleted";

/** A cloned voice as stored in SQLite. `defaults_json` holds serialized `Settings`. */
export interface Voice {
  id: string;
  name: string;
  status: VoiceStatus;
  defaults_json: string;
  reference_path: string;
  profile_path: string | null;
  created_at: number;
}
