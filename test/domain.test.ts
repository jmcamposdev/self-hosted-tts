import { test } from "node:test";
import assert from "node:assert/strict";
import { splitText } from "#domain/text/segmentation.js";
import { projectToOriginal } from "#domain/alignment/alignment.project.js";
import { validateAlignment } from "#domain/alignment/alignment.validate.js";
import {
  appendAlignment,
  emptyAlignment,
} from "#domain/alignment/alignment.merge.js";
import {
  resolveSettings,
  deriveSeed,
} from "#domain/settings/settings.tools.js";
import { DEFAULT_SETTINGS } from "#domain/settings/settings.schema.js";
import {
  isArtifactName,
  ARTIFACT_NAMES,
  ARTIFACT_MIME,
} from "#domain/artifacts/artifacts.js";
import { Fault } from "#shared/errors/fault.js";

test("segmentation validates speech presence, word lengths, and preserves exact Unicode text", () => {
  // Empty or non-speech text rejected
  assert.throws(
    () => splitText("   ... --- ???   ", 250),
    (e) => e instanceof Fault && e.code === "NO_SPEECH",
  );

  // Single word > 300 chars rejected
  assert.throws(
    () => splitText("a".repeat(301), 250),
    (e) => e instanceof Fault && e.code === "TEXT_TOKEN_TOO_LONG",
  );

  // Normal text with paragraph break
  const input =
    "¡Hola, mundo! ¿Cómo estás?\n\nSegunda línea aquí con acentos y emojis 😊.";
  const segments = splitText(input, 300);
  assert.ok(segments.length >= 2);

  // Invariant: joining all segments must exactly reproduce the input text
  const reconstituted = segments.map((s) => s.text).join("");
  assert.equal(reconstituted, input);

  // First paragraph has pause, last segment has 0 pause
  assert.ok(segments[0].pauseMs > 0);
  assert.equal(segments.at(-1)!.pauseMs, 0);
});

test("projectToOriginal maps identity and expanded numbers correctly", () => {
  const original = "En 1984 ocurrió.";
  const spoken = "En mil novecientos ochenta y cuatro ocurrió.";
  const head = "En ".length;
  const numOriginal = "1984";
  const numSpoken = "mil novecientos ochenta y cuatro";

  const mappings = [
    {
      source_start: 0,
      source_end: head,
      spoken_start: 0,
      spoken_end: head,
      kind: "identity" as const,
    },
    {
      source_start: head,
      source_end: head + numOriginal.length,
      spoken_start: head,
      spoken_end: head + numSpoken.length,
      kind: "expanded" as const,
    },
    {
      source_start: head + numOriginal.length,
      source_end: original.length,
      spoken_start: head + numSpoken.length,
      spoken_end: spoken.length,
      kind: "identity" as const,
    },
  ];

  const spokenChars = Array.from(spoken);
  const spokenAlignment = {
    characters: spokenChars,
    character_start_times_seconds: spokenChars.map(
      (_, i) => (i / spokenChars.length) * 4,
    ),
    character_end_times_seconds: spokenChars.map(
      (_, i) => ((i + 1) / spokenChars.length) * 4,
    ),
  };

  const derived = new Set<number>();
  const projected = projectToOriginal(
    spokenAlignment,
    mappings,
    original,
    derived,
  );

  assert.equal(projected.alignment.characters.join(""), original);
  assert.equal(
    projected.alignment.character_start_times_seconds.length,
    Array.from(original).length,
  );
  assert.ok(projected.derivedPositions.length > 0);
});

test("alignment validation rejects character mismatches, inverted timestamps and overruns", () => {
  const valid = {
    characters: ["O", "k"],
    character_start_times_seconds: [0, 0.5],
    character_end_times_seconds: [0.5, 1.0],
  };

  // Valid passes
  assert.doesNotThrow(() => validateAlignment(valid, "Ok", 1.0));

  // Character mismatch
  assert.throws(
    () => validateAlignment(valid, "No", 1.0),
    (e) => e instanceof Fault && e.code === "ALIGNMENT_INVALID",
  );

  // Inverted start/end
  assert.throws(
    () =>
      validateAlignment(
        { ...valid, character_end_times_seconds: [0, 0.4] },
        "Ok",
        1.0,
      ),
    (e) => e instanceof Fault && e.code === "ALIGNMENT_INVALID",
  );

  // Non-monotonic timestamps (goes backwards)
  assert.throws(
    () =>
      validateAlignment(
        { ...valid, character_start_times_seconds: [0.6, 0.2] },
        "Ok",
        1.0,
      ),
    (e) => e instanceof Fault && e.code === "ALIGNMENT_INVALID",
  );

  // Duration overrun
  assert.throws(
    () => validateAlignment(valid, "Ok", 0.4),
    (e) => e instanceof Fault && e.code === "ALIGNMENT_INVALID",
  );
});

test("appendAlignment merges timelines and offsets timestamps", () => {
  const master = emptyAlignment();
  const chunk1 = {
    characters: ["A"],
    character_start_times_seconds: [0],
    character_end_times_seconds: [0.5],
  };
  const chunk2 = {
    characters: ["B"],
    character_start_times_seconds: [0],
    character_end_times_seconds: [0.5],
  };

  appendAlignment(master, chunk1, 0);
  appendAlignment(master, chunk2, 1.0); // Offset by 1.0s

  assert.deepEqual(master.characters, ["A", "B"]);
  assert.equal(master.character_start_times_seconds[1], 1.0);
  assert.equal(master.character_end_times_seconds[1], 1.5);
});

test("settings resolution and seed derivation respect strict precedence", () => {
  const voiceDefaults = JSON.stringify({ speed: 1.1, volume: 1.2 });
  const requested = { speed: 1.25 };

  const resolved = resolveSettings(voiceDefaults, requested);
  // Requested speed overrides voice default
  assert.equal(resolved.speed, 1.25);
  // Voice volume overrides system default
  assert.equal(resolved.volume, 1.2);
  // Unset paragraph_pause_ms falls back to system default
  assert.equal(
    resolved.paragraph_pause_ms,
    DEFAULT_SETTINGS.paragraph_pause_ms,
  );

  // Deterministic seed derivation
  const seed1 = deriveSeed({ ...resolved, seed: 42 }, "job-1");
  assert.equal(seed1, 42);

  const seedAuto1 = deriveSeed(resolved, "job-abc");
  const seedAuto2 = deriveSeed(resolved, "job-abc");
  assert.equal(seedAuto1, seedAuto2);
  assert.ok(seedAuto1 >= 0);
});

test("artifact names and MIME types validation", () => {
  for (const name of ARTIFACT_NAMES) {
    assert.equal(isArtifactName(name), true);
    assert.ok(ARTIFACT_MIME[name]);
  }

  assert.equal(isArtifactName("malicious.sh"), false);
  assert.equal(isArtifactName("../../secrets"), false);
  assert.equal(isArtifactName(""), false);
});
