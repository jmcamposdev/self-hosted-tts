import { z } from "zod";
import { NARRATION_TEXT_MAX_CHARS } from "../../shared/constants/limits.constants.js";
import { settingsSchema } from "../settings/settings.schema.js";

export const narrationSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(NARRATION_TEXT_MAX_CHARS)
      .refine((t) => t.trim().length > 0, "Text must contain speech")
      .refine(
        (t) => !/[[\]]/.test(t),
        "Inline markup is not supported in v1; supply plain narration",
      ),
    voice_settings: settingsSchema.optional(),
  })
  .strict();

export type NarrationRequest = z.infer<typeof narrationSchema>;
