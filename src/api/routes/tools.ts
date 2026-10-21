import { z } from "zod";

export function jsonSchema(s: z.ZodType) {
  const { $schema, ...rest } = z.toJSONSchema(s);
  return rest;
}
