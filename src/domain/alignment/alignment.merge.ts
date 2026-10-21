import type { Alignment } from "./alignment.types.js";

export const emptyAlignment = (): Alignment => ({
  characters: [],
  character_start_times_seconds: [],
  character_end_times_seconds: [],
});

/** Appends `chunk` to `target`, shifting its times by `offsetSeconds` (real sample offset). */
export function appendAlignment(
  target: Alignment,
  chunk: Alignment,
  offsetSeconds: number,
): void {
  target.characters.push(...chunk.characters);
  target.character_start_times_seconds.push(
    ...chunk.character_start_times_seconds.map((t) => t + offsetSeconds),
  );
  target.character_end_times_seconds.push(
    ...chunk.character_end_times_seconds.map((t) => t + offsetSeconds),
  );
}
