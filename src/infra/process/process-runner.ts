import { spawn } from "node:child_process";
import {
  KILL_GRACE_MS,
  STDERR_TAIL_BYTES,
  STDOUT_TAIL_BYTES,
} from "../../shared/constants/limits.constants.js";
import { Fault } from "../../shared/errors/fault.js";

/** Returns a Fault when stderr of a successful run reveals a hidden failure. */
export type StderrInspector = (stderr: string) => Fault | undefined;

export interface RunOptions {
  signal: AbortSignal;
  timeoutMs: number;
  cwd?: string;
  inspectStderr?: StderrInspector;
}

/**
 * Runs an executable with a time budget and cancellation (SIGTERM, then SIGKILL).
 * Resolves with the stdout tail; never interprets shell syntax.
 */
export function runProcess(
  bin: string,
  args: string[],
  { signal, timeoutMs, cwd, inspectStderr }: RunOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Fault("CANCELLED", "Cancelled"));
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "",
      killed = false;
    child.stdout.on("data", (b) => {
      stdout = (stdout + b.toString()).slice(-STDOUT_TAIL_BYTES);
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + b.toString()).slice(-STDERR_TAIL_BYTES);
    });
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (!killed) {
        killed = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      }
    };
    const timer = setTimeout(stop, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    const settle = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener("abort", stop);
    };
    child.once("error", () => {
      settle();
      reject(
        new Fault(
          "EXECUTABLE_UNAVAILABLE",
          "Required executable is unavailable",
        ),
      );
    });
    child.once("close", (code) => {
      settle();
      if (signal.aborted)
        return reject(new Fault("CANCELLED", "Cancelled or worker lease lost"));
      if (killed)
        return reject(
          new Fault("STAGE_TIMEOUT", "Stage exceeded its time budget"),
        );
      if (code !== 0)
        return reject(
          new Fault("PROCESS_FAILED", `Processing stage failed (exit ${code})`),
        );
      const hidden = inspectStderr?.(stderr);
      if (hidden) return reject(hidden);
      resolve(stdout);
    });
  });
}
