import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** Streaming SHA-256 of a file (safe for the engine binary and large PCM). */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const block of createReadStream(path)) hash.update(block);
  return hash.digest("hex");
}
