import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Fault, type Alignment, type Word } from "./contracts.js";

export async function command(
  bin: string,
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Fault("CANCELLED", "Cancelled", 409));
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "",
      killed = false;
    child.stdout.on("data", (b) => {
      stdout = (stdout + b.toString()).slice(-64 * 1024);
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + b.toString()).slice(-16 * 1024);
    });
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (!killed) {
        killed = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
      }
    };
    const timer = setTimeout(stop, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    child.once("error", () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener("abort", stop);
      reject(
        new Fault(
          "EXECUTABLE_UNAVAILABLE",
          "Required executable is unavailable",
          500,
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener("abort", stop);
      if (signal.aborted)
        return reject(
          new Fault("CANCELLED", "Cancelled or worker lease lost", 409),
        );
      if (killed)
        return reject(
          new Fault(
            "STAGE_TIMEOUT",
            "Stage exceeded its time budget",
            500,
            true,
          ),
        );
      if (code !== 0)
        return reject(
          new Fault(
            "PROCESS_FAILED",
            `Processing stage failed (exit ${code})`,
            500,
          ),
        );
      if (
        /Warning:.*(ignored|no effect|time-stretch failed)|ERROR:|WARNING.*mismatch/i.test(
          stderr,
        )
      )
        return reject(
          new Fault(
            "ENGINE_CONFIGURATION",
            "Engine reported incompatible or ignored settings",
            500,
          ),
        );
      if (/Frame \d+\/\d+/.test(stderr) && !/EOS at frame/.test(stderr))
        return reject(
          new Fault(
            "SYNTHESIS_TRUNCATED",
            "Speech reached its generation limit without EOS",
            500,
          ),
        );
      resolve(stdout);
    });
  });
}
export async function probe(path: string, signal: AbortSignal) {
  const s = await command(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,sample_rate,channels",
      "-of",
      "json",
      path,
    ],
    signal,
    120000,
  );
  const d = JSON.parse(s),
    duration = Number(d.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Fault("INVALID_AUDIO", "Audio has no finite duration", 422);
  return {
    duration,
    streams: d.streams as {
      codec_name: string;
      sample_rate: string;
      channels: number;
    }[],
  };
}
export async function hashFile(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
export async function pcm(path: string) {
  const b = await readFile(path);
  if (b.length % 2) throw new Fault("INVALID_PCM", "Invalid PCM length", 500);
  return b;
}
export function wav(pcm: Buffer, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(pcm.length + 36, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export type Segment = {
  text: string;
  start: number;
  end: number;
  pauseMs: number;
};
export function splitText(text: string, paragraphPauseMs: number): Segment[] {
  const chars = Array.from(text),
    segments: Segment[] = [];
  let cursor = 0;
  while (cursor < chars.length) {
    let end = Math.min(cursor + 300, chars.length);
    const slice = chars.slice(cursor, end).join("");
    const paragraph = Array.from(slice.matchAll(/\n\s*\n/gu)).find((m) =>
      /[\p{L}\p{N}]/u.test(slice.slice(0, m.index)),
    );
    if (paragraph) {
      end =
        cursor +
        Array.from(slice.slice(0, paragraph.index + paragraph[0].length))
          .length;
    } else if (end < chars.length) {
      let boundary = -1;
      for (let i = end - 1; i > cursor + 50; i--)
        if (/[.!?;]/u.test(chars[i]) && /\s/u.test(chars[i + 1] || "")) {
          boundary = i + 1;
          break;
        }
      if (boundary < 0)
        for (let i = end - 1; i > cursor; i--)
          if (/\s/u.test(chars[i])) {
            boundary = i + 1;
            break;
          }
      if (boundary < 0)
        throw new Fault(
          "TEXT_TOKEN_TOO_LONG",
          "A single word exceeds 300 characters",
          422,
        );
      end = boundary;
    }
    const t = chars.slice(cursor, end).join("");
    if (!/[\p{L}\p{N}]/u.test(t)) {
      if (segments.length) {
        segments.at(-1)!.text += t;
        segments.at(-1)!.end = end;
      } else
        throw new Fault(
          "NO_SPEECH",
          "A segment contains no spoken words; remove excessive leading whitespace",
          422,
        );
    } else
      segments.push({
        text: t,
        start: cursor,
        end,
        pauseMs: /\n\s*\n/u.test(t) ? paragraphPauseMs : 0,
      });
    cursor = end;
  }
  if (segments.length) segments.at(-1)!.pauseMs = 0;
  return segments;
}
export function wordsFromAlignment(a: Alignment): Word[] {
  const words: Word[] = [];
  const text = a.characters.join("");
  let pos = 0,
    utf16Offset = 0;
  for (const m of text.matchAll(/\S+/gu)) {
    while (utf16Offset < m.index) {
      utf16Offset += a.characters[pos].length;
      pos++;
    }
    const n = Array.from(m[0]).length;
    words.push({
      word: m[0],
      start: a.character_start_times_seconds[pos],
      end: a.character_end_times_seconds[pos + n - 1],
    });
  }
  return words;
}
export function srt(words: Word[]) {
  const time = (s: number) => {
    const ms = Math.max(0, Math.round(s * 1000));
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  const cues: string[] = [];
  let group: Word[] = [];
  const flush = () => {
    if (!group.length) return;
    cues.push(
      `${cues.length + 1}\n${time(group[0].start)} --> ${time(Math.max(group.at(-1)!.end, group[0].start + 0.001))}\n${group.map((w) => w.word).join(" ")}\n`,
    );
    group = [];
  };
  for (const word of words) {
    if (
      group.length &&
      (group.map((w) => w.word).join(" ").length + word.word.length + 1 > 42 ||
        word.end - group[0].start > 6)
    )
      flush();
    group.push(word);
    if (/[.!?]$/.test(word.word)) flush();
  }
  flush();
  return cues.join("\n");
}
