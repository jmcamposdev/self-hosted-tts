import type { Alignment, SourceMapping } from "./alignment.types.js";

export interface ProjectedAlignment {
  alignment: Alignment;
  /** Original-text positions whose timing is derived (symbols, digits, smoothed overlaps). */
  derivedPositions: number[];
}

/**
 * Projects the spoken-text timeline onto the ORIGINAL text. Identity spans copy
 * times 1:1; expanded spans (numbers, dates) distribute their characters evenly
 * across the acoustic interval of the expansion and are reported as derived.
 */
export function projectToOriginal(
  spoken: Alignment,
  mappings: SourceMapping[],
  originalText: string,
  derivedSpoken: ReadonlySet<number>,
): ProjectedAlignment {
  const alignment: Alignment = {
    characters: Array.from(originalText),
    character_start_times_seconds: [],
    character_end_times_seconds: [],
  };
  const derivedPositions: number[] = [];
  const starts = spoken.character_start_times_seconds;
  const ends = spoken.character_end_times_seconds;
  for (const map of mappings) {
    if (map.kind === "identity") {
      for (let p = map.source_start; p < map.source_end; p++) {
        const q = map.spoken_start + p - map.source_start;
        alignment.character_start_times_seconds.push(starts[q]);
        alignment.character_end_times_seconds.push(ends[q]);
        if (derivedSpoken.has(q)) derivedPositions.push(p);
      }
    } else {
      const start = starts[map.spoken_start],
        end = ends[map.spoken_end - 1],
        count = map.source_end - map.source_start;
      for (let p = 0; p < count; p++) {
        alignment.character_start_times_seconds.push(
          start + ((end - start) * p) / count,
        );
        alignment.character_end_times_seconds.push(
          start + ((end - start) * (p + 1)) / count,
        );
        derivedPositions.push(map.source_start + p);
      }
    }
  }
  return { alignment, derivedPositions };
}
