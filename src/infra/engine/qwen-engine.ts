import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ENGINE_LANGUAGE,
  ENGINE_MAX_TOKENS,
  ENGINE_TEMPERATURE,
  EXPECTED_MODEL_SIZE,
  SEED_MODULUS,
} from "#shared/constants/engine.constants.js";
import { Fault } from "#shared/errors/fault.js";
import { hashFile } from "#shared/tools/hash.tools.js";
import { runProcess } from "#infra/process/process-runner.js";
import type {
  CloneProfileInput,
  EngineSettings,
  SynthesizeInput,
} from "./engine.types.js";

/**
 * The C engine reports some failures only on stderr while still exiting 0
 * (ignored flags, generation limit without EOS). Those are failures here.
 */
export function inspectEngineStderr(stderr: string): Fault | undefined {
  if (
    /Warning:.*(ignored|no effect|time-stretch failed)|ERROR:|WARNING.*mismatch/i.test(
      stderr,
    )
  )
    return new Fault(
      "ENGINE_CONFIGURATION",
      "Engine reported incompatible or ignored settings",
    );
  if (/Frame \d+\/\d+/.test(stderr) && !/EOS at frame/.test(stderr))
    return new Fault(
      "SYNTHESIS_TRUNCATED",
      "Speech reached its generation limit without EOS",
    );
}

/** Adapter over the qwen3-tts CLI. The only place that knows its flags. */
export class QwenEngine {
  constructor(private readonly settings: EngineSettings) {}

  /** Verifies binaries and model kinds; returns the engine binary SHA-256. */
  async preflight(): Promise<string> {
    const { binary, baseModel, customModel } = this.settings;
    for (const path of [
      binary,
      join(baseModel, "model.safetensors"),
      join(customModel, "model.safetensors"),
    ])
      await access(path);
    for (const [path, kind] of [
      [baseModel, "base"],
      [customModel, "custom_voice"],
    ] as const) {
      const cfg = JSON.parse(await readFile(join(path, "config.json"), "utf8"));
      if (
        cfg.tts_model_type !== kind ||
        cfg.tts_model_size !== EXPECTED_MODEL_SIZE
      )
        throw new Fault(
          "MODEL_INCOMPATIBLE",
          "Expected Qwen3-TTS 1.7B Base and CustomVoice",
        );
    }
    return hashFile(binary);
  }

  /** Extracts a reusable speaker profile (`.qvoice`) with the Base model. */
  async cloneProfile(input: CloneProfileInput): Promise<void> {
    const s = this.settings;
    await runProcess(
      s.binary,
      [
        "-d",
        s.baseModel,
        "--ref-audio",
        input.referenceWav,
        "-l",
        ENGINE_LANGUAGE,
        "--int8",
        "-j",
        String(s.threads),
        "--voice-name",
        input.voiceName,
        "--save-voice",
        input.outputPath,
      ],
      {
        signal: input.signal,
        timeoutMs: s.stageTimeoutMs,
        cwd: s.cwd,
        inspectStderr: inspectEngineStderr,
      },
    );
  }

  /** Synthesizes one fragment with the CustomVoice model and a stored profile. */
  async synthesize(input: SynthesizeInput): Promise<void> {
    const s = this.settings;
    await runProcess(
      s.binary,
      [
        "-d",
        s.customModel,
        "--load-voice",
        input.profilePath,
        "--icl-only",
        "-l",
        ENGINE_LANGUAGE,
        "--int8",
        "-j",
        String(s.threads),
        "--seed",
        String(input.seed % SEED_MODULUS),
        "--temperature",
        ENGINE_TEMPERATURE,
        "--max-tokens",
        ENGINE_MAX_TOKENS,
        "--text",
        input.text,
        "--rate",
        String(input.speed),
        "-o",
        input.outputPath,
      ],
      {
        signal: input.signal,
        timeoutMs: s.stageTimeoutMs,
        cwd: s.cwd,
        inspectStderr: inspectEngineStderr,
      },
    );
  }
}
