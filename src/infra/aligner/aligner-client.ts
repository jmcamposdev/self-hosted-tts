import { PREFLIGHT_TIMEOUT_MS } from "../../shared/constants/limits.constants.js";
import { Fault } from "../../shared/errors/fault.js";
import type { AlignResponse, NormalizeResponse } from "./aligner.types.js";

/** Client for the internal alignment service (never exposed publicly). */
export class AlignerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly stageTimeoutMs: number,
  ) {}

  normalize(text: string, signal: AbortSignal): Promise<NormalizeResponse> {
    return this.post("/normalize", { text }, signal);
  }

  align(
    path: string,
    text: string,
    signal: AbortSignal,
  ): Promise<AlignResponse> {
    return this.post("/align", { path, text }, signal);
  }

  /** Non-throwing readiness probe used by /health/ready. */
  async isHealthy(timeoutMs: number): Promise<boolean> {
    try {
      return (
        await fetch(this.baseUrl + "/health", {
          signal: AbortSignal.timeout(timeoutMs),
        })
      ).ok;
    } catch {
      return false;
    }
  }

  async assertHealthy(): Promise<void> {
    if (!(await this.isHealthy(PREFLIGHT_TIMEOUT_MS)))
      throw new Fault("ALIGNER_UNAVAILABLE", "Alignment model not ready");
  }

  private async post<T>(
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(this.stageTimeoutMs),
        ]),
      });
    } catch {
      throw new Fault(
        "ALIGNER_UNAVAILABLE",
        "Alignment service unavailable or timed out",
      );
    }
    if (!response.ok) {
      const rejected = response.status === 422;
      const detail = (await response.json().catch(() => ({}))) as {
        detail?: unknown;
      };
      throw new Fault(
        rejected ? "ALIGNMENT_REJECTED" : "ALIGNER_FAILED",
        rejected
          ? typeof detail.detail === "string"
            ? detail.detail.slice(0, 300)
            : "Text normalization or alignment rejected"
          : "Alignment service failed",
      );
    }
    return (await response.json()) as T;
  }
}
