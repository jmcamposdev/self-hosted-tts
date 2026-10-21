import type { Word } from "../alignment/alignment.types.js";

const MAX_CUE_CHARS = 42;
const MAX_CUE_SECONDS = 6;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function timestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

/** Renders SubRip cues: at most 42 characters / 6 s per cue, flushing at sentence ends. */
export function srt(words: Word[]): string {
  const cues: string[] = [];
  let group: Word[] = [];
  const flush = () => {
    if (!group.length) return;
    const end = Math.max(group.at(-1)!.end, group[0].start + 0.001);
    cues.push(
      `${cues.length + 1}\n${timestamp(group[0].start)} --> ${timestamp(end)}\n${group.map((w) => w.word).join(" ")}\n`,
    );
    group = [];
  };
  for (const word of words) {
    if (
      group.length &&
      (group.map((w) => w.word).join(" ").length + word.word.length + 1 >
        MAX_CUE_CHARS ||
        word.end - group[0].start > MAX_CUE_SECONDS)
    )
      flush();
    group.push(word);
    if (/[.!?]$/.test(word.word)) flush();
  }
  flush();
  return cues.join("\n");
}
