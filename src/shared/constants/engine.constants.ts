/**
 * Engine and model identity. Keep ENGINE_COMMIT in sync with `ARG QWEN_COMMIT`
 * in the Dockerfile; scripts/pins.json is checked against both in CI.
 */
export const ENGINE_COMMIT = "ef339be58a778b062e1c14382347964552eae007";
export const MODEL_LABEL = "Qwen3-TTS-12Hz-1.7B-CustomVoice";
export const EXPECTED_MODEL_SIZE = "1b7";
export const ENGINE_LANGUAGE = "Spanish";
export const ENGINE_TEMPERATURE = "1.0";
export const ENGINE_MAX_TOKENS = "1100";
/** Seeds are sent to the C engine as a signed 31-bit-safe integer. */
export const SEED_MODULUS = 2_147_483_648;

/** `.qvoice` profile header (magic + hidden size for the 1.7B model). */
export const QVOICE_MAGIC = "QVCE";
export const QVOICE_MIN_BYTES = 24;
export const QVOICE_HIDDEN_SIZE = 2048;
export const QVOICE_HIDDEN_SIZE_OFFSET = 8;

/** Part of every chunk fingerprint: bump to invalidate stored checkpoints. */
export const ALIGNMENT_PROTOCOL = "es-ctc-v2-word-delimiters";
export const ALIGNMENT_METHOD = "wav2vec2-es-ctc";
export const METADATA_SCHEMA_VERSION = 1;
