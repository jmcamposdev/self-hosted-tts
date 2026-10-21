import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { Configuration } from "../../config/config.types.js";
import type { Job } from "../../domain/job/job.types.js";
import { DEFAULT_SETTINGS } from "../../domain/settings/settings.schema.js";
import type { Settings } from "../../domain/settings/settings.types.js";
import type { VoicePatch } from "../../domain/voice/voice.schema.js";
import type { Voice } from "../../domain/voice/voice.types.js";
import {
  voiceDir,
  voiceReferencePath,
} from "../../infra/storage/storage.paths.js";
import type { Store } from "../../persistence/store.js";
import { Fault } from "../../shared/errors/fault.js";

export interface CreateVoiceInput {
  name: string;
  audio: Buffer;
  settings: Settings;
}

/** Voice use cases: catalog, cloning request, configuration and deletion. */
export class VoiceService {
  constructor(
    private readonly store: Store,
    private readonly config: Configuration,
  ) {}

  /** Returns a non-deleted voice or throws VOICE_NOT_FOUND. */
  find(id: string): Voice {
    const voice = this.store.voices.find(id);
    if (!voice || voice.status === "deleted")
      throw new Fault("VOICE_NOT_FOUND", "Voice not found");
    return voice;
  }

  list(): Voice[] {
    return this.store.voices.listActive();
  }

  /** Stores the reference and enqueues cloning atomically; undoes the upload on rejection. */
  async create(input: CreateVoiceInput): Promise<{ voice: Voice; job: Job }> {
    const id = randomUUID(),
      dir = voiceDir(this.config.data, id);
    await mkdir(dir, { recursive: true });
    const reference = voiceReferencePath(this.config.data, id);
    await writeFile(reference, input.audio, { flag: "wx" });
    try {
      const job = this.store.transaction(() => {
        this.store.voices.insertCloning({
          id,
          name: input.name,
          defaultsJson: JSON.stringify({
            ...DEFAULT_SETTINGS,
            ...input.settings,
          }),
          referencePath: reference,
          createdAt: Date.now(),
        });
        return this.store.jobs.enqueue(
          "clone",
          this.store.voices.find(id)!,
          {},
          this.config.maxQueue,
        );
      });
      return { voice: this.store.voices.find(id)!, job };
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
  }

  patch(id: string, input: VoicePatch): Voice {
    const voice = this.find(id);
    this.store.voices.update(
      voice.id,
      input.name || voice.name,
      JSON.stringify({
        ...JSON.parse(voice.defaults_json),
        ...input.voice_settings,
      }),
    );
    return this.find(voice.id);
  }

  async remove(id: string): Promise<void> {
    const voice = this.find(id);
    this.store.transaction(() => {
      if (this.store.jobs.hasActiveForVoice(voice.id))
        throw new Fault(
          "VOICE_IN_USE",
          "Cancel or finish active jobs before deleting the voice",
        );
      this.store.voices.markDeleted(voice.id);
    });
    await rm(voiceDir(this.config.data, voice.id), {
      recursive: true,
      force: true,
    });
  }
}
