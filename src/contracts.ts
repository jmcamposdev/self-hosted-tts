import { z } from "zod";

export const settingsSchema = z
  .object({
    speed: z.number().min(0.8).max(1.25).optional(),
    volume: z.number().min(0.5).max(1.5).optional(),
    paragraph_pause_ms: z.number().int().min(0).max(2000).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
  })
  .strict();
export const defaults = { speed: 1.08, volume: 1, paragraph_pause_ms: 250 };
export const narrationSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(30_000)
      .refine((t) => t.trim().length > 0, "Text must contain speech")
      .refine(
        (t) => !/[\[\]]/.test(t),
        "Inline markup is not supported in v1; supply plain narration",
      ),
    voice_settings: settingsSchema.optional(),
  })
  .strict();
export const voicePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    voice_settings: settingsSchema.optional(),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};
export type Word = { word: string; start: number; end: number; score?: number };
export class Fault extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public transient = false,
  ) {
    super(message);
  }
}
export function validateAlignment(
  a: Alignment,
  text: string,
  duration: number,
) {
  if (
    a.characters.join("") !== text ||
    !a.characters.length ||
    a.characters.length !== a.character_start_times_seconds.length ||
    a.characters.length !== a.character_end_times_seconds.length
  )
    throw new Fault(
      "ALIGNMENT_INVALID",
      "Alignment does not preserve the original text",
      500,
    );
  for (let i = 0; i < a.characters.length; i++) {
    const s = a.character_start_times_seconds[i],
      e = a.character_end_times_seconds[i];
    if (
      !Number.isFinite(s) ||
      !Number.isFinite(e) ||
      s < 0 ||
      e < s ||
      e > duration + 0.001 ||
      (i > 0 &&
        (s < a.character_start_times_seconds[i - 1] ||
          e < a.character_end_times_seconds[i - 1]))
    )
      throw new Fault(
        "ALIGNMENT_INVALID",
        "Invalid or non-monotonic timestamps",
        500,
      );
  }
}
