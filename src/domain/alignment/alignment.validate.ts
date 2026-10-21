import { ALIGNMENT_END_TOLERANCE_SECONDS } from "../../shared/constants/limits.constants.js";
import { Fault } from "../../shared/errors/fault.js";
import type { Alignment } from "./alignment.types.js";

/** Rejects alignments that do not reproduce `text` or have invalid/non-monotonic timestamps. */
export function validateAlignment(
  alignment: Alignment,
  text: string,
  duration: number,
): void {
  const { characters, character_start_times_seconds: starts } = alignment;
  const ends = alignment.character_end_times_seconds;
  if (
    characters.join("") !== text ||
    !characters.length ||
    characters.length !== starts.length ||
    characters.length !== ends.length
  )
    throw new Fault(
      "ALIGNMENT_INVALID",
      "Alignment does not preserve the original text",
    );
  for (let i = 0; i < characters.length; i++) {
    const start = starts[i],
      end = ends[i];
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      end > duration + ALIGNMENT_END_TOLERANCE_SECONDS ||
      (i > 0 && (start < starts[i - 1] || end < ends[i - 1]))
    )
      throw new Fault(
        "ALIGNMENT_INVALID",
        "Invalid or non-monotonic timestamps",
      );
  }
}
