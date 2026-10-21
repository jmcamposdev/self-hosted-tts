/** Master audio format produced by the engine and stored in every artifact. */
export const SAMPLE_RATE = 24_000;
export const BYTES_PER_SAMPLE = 2;
export const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE;
export const WAV_HEADER_BYTES = 44;

/** Opus encoder settings for the delivered `audio.opus`. */
export const OPUS_BITRATE = "64k";
