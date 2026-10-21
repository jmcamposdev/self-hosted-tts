import { z } from "zod";
import { VOICE_NAME_MAX_CHARS } from "#shared/constants/limits.constants.js";
import { settingsSchema } from "#domain/settings/settings.schema.js";

export const voicePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(VOICE_NAME_MAX_CHARS).optional(),
    voice_settings: settingsSchema.optional(),
  })
  .strict();

export type VoicePatch = z.infer<typeof voicePatchSchema>;
