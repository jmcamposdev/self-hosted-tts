import { z } from "zod";

export const idParamSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const artifactParamSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
