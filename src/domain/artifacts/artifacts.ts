/** Single source of truth for the downloadable artifacts of a narration job. */
export const ARTIFACT_MIME = {
  "audio.opus": "audio/ogg",
  "audio.wav": "audio/wav",
  "alignment.json": "application/json",
  "words.json": "application/json",
  "metadata.json": "application/json",
  "subtitles.srt": "application/x-subrip",
} as const;

export type ArtifactName = keyof typeof ARTIFACT_MIME;

export const ARTIFACT_NAMES = Object.keys(ARTIFACT_MIME) as ArtifactName[];

export const isArtifactName = (name: string): name is ArtifactName =>
  Object.hasOwn(ARTIFACT_MIME, name);
