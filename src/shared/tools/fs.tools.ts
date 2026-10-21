import { statfsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Fault } from "../errors/fault.js";

export const writeJson = (path: string, value: unknown): Promise<void> =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n");

/** Throws STORAGE_FULL when the volume holding `dir` has less than `minFreeBytes` available. */
export function ensureFreeSpace(
  dir: string,
  minFreeBytes: number,
  message = "Insufficient free disk space",
): void {
  const stats = statfsSync(dir);
  if (stats.bavail * stats.bsize < minFreeBytes)
    throw new Fault("STORAGE_FULL", message);
}
