import type { Voice } from "#domain/voice/voice.types.js";
import type { PublicVoice } from "../api.types.js";

export const publicVoice = (v: Voice): PublicVoice => ({
  voice_id: v.id,
  name: v.name,
  status: v.status,
  voice_settings: JSON.parse(v.defaults_json),
  created_at: v.created_at,
});
