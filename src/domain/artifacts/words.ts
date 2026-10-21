import type { Alignment, Word } from "../alignment/alignment.types.js";

/** Derives whitespace-delimited word timings from the character alignment. */
export function wordsFromAlignment(alignment: Alignment): Word[] {
  const words: Word[] = [];
  const text = alignment.characters.join("");
  let pos = 0,
    utf16Offset = 0;
  for (const m of text.matchAll(/\S+/gu)) {
    while (utf16Offset < m.index) {
      utf16Offset += alignment.characters[pos].length;
      pos++;
    }
    const n = Array.from(m[0]).length;
    words.push({
      word: m[0],
      start: alignment.character_start_times_seconds[pos],
      end: alignment.character_end_times_seconds[pos + n - 1],
    });
  }
  return words;
}
