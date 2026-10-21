import {
  SEGMENT_MAX_CHARS,
  SEGMENT_MIN_SENTENCE_CHARS,
} from "#shared/constants/limits.constants.js";
import { Fault } from "#shared/errors/fault.js";
import type { Segment } from "#domain/alignment/alignment.types.js";

const HAS_SPEECH = /[\p{L}\p{N}]/u;
const PARAGRAPH_BREAK = /\n\s*\n/u;

/**
 * Splits spoken text into engine-sized segments without dropping or altering a
 * single character: concatenating `segment.text` always reproduces the input.
 */
export function splitText(text: string, paragraphPauseMs: number): Segment[] {
  const chars = Array.from(text),
    segments: Segment[] = [];
  let cursor = 0;
  while (cursor < chars.length) {
    let end = Math.min(cursor + SEGMENT_MAX_CHARS, chars.length);
    const slice = chars.slice(cursor, end).join("");
    const paragraph = Array.from(slice.matchAll(/\n\s*\n/gu)).find((m) =>
      HAS_SPEECH.test(slice.slice(0, m.index)),
    );
    if (paragraph) {
      end =
        cursor +
        Array.from(slice.slice(0, paragraph.index + paragraph[0].length))
          .length;
    } else if (end < chars.length) {
      end = findBoundary(chars, cursor, end);
    }
    const t = chars.slice(cursor, end).join("");
    if (!HAS_SPEECH.test(t)) {
      if (segments.length) {
        segments.at(-1)!.text += t;
        segments.at(-1)!.end = end;
      } else
        throw new Fault(
          "NO_SPEECH",
          "A segment contains no spoken words; remove excessive leading whitespace",
        );
    } else
      segments.push({
        text: t,
        start: cursor,
        end,
        pauseMs: PARAGRAPH_BREAK.test(t) ? paragraphPauseMs : 0,
      });
    cursor = end;
  }
  if (segments.length) segments.at(-1)!.pauseMs = 0;
  return segments;
}

/** Prefers a sentence end, falls back to whitespace; fails on an over-long single word. */
function findBoundary(chars: string[], cursor: number, end: number): number {
  for (let i = end - 1; i > cursor + SEGMENT_MIN_SENTENCE_CHARS; i--)
    if (/[.!?;]/u.test(chars[i]) && /\s/u.test(chars[i + 1] || ""))
      return i + 1;
  for (let i = end - 1; i > cursor; i--) if (/\s/u.test(chars[i])) return i + 1;
  throw new Fault(
    "TEXT_TOKEN_TOO_LONG",
    `A single word exceeds ${SEGMENT_MAX_CHARS} characters`,
  );
}
