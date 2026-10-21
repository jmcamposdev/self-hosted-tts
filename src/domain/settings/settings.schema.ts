import { z } from "zod";

export const settingsSchema = z
  .object({
    speed: z.number().min(0.8).max(1.25).optional(),
    volume: z.number().min(0.5).max(1.5).optional(),
    paragraph_pause_ms: z.number().int().min(0).max(2000).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
  })
  .strict();

export const DEFAULT_SETTINGS = {
  speed: 1.08,
  volume: 1,
  paragraph_pause_ms: 250,
} as const;
