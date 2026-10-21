import type { DatabaseSync } from "node:sqlite";
import { Database } from "./database.js";
import { ChunkRepository } from "./repositories/chunk.repository.js";
import { JobRepository } from "./repositories/job.repository.js";
import { LockRepository } from "./repositories/lock.repository.js";
import { VoiceRepository } from "./repositories/voice.repository.js";
import type { Voice } from "#domain/voice/voice.types.js";
import type { Job } from "#domain/job/job.types.js";

/**
 * Composition root of persistence. Application code talks to repositories;
 * compatibility methods are preserved for tests and transitions.
 */
export class Store {
  readonly database: Database;
  readonly voices: VoiceRepository;
  readonly locks: LockRepository;
  readonly jobs: JobRepository;
  readonly chunks: ChunkRepository;

  constructor(dataDir: string) {
    this.database = new Database(dataDir);
    this.voices = new VoiceRepository(this.database);
    this.locks = new LockRepository(this.database);
    this.jobs = new JobRepository(this.database, this.locks, this.voices);
    this.chunks = new ChunkRepository(this.database, this.jobs);
  }

  get db(): DatabaseSync {
    return this.database.sqlite;
  }

  transaction<T>(work: () => T): T {
    return this.database.transaction(work);
  }

  close(): void {
    this.database.close();
  }

  // Backward-compatibility helpers for tests
  voice(id: string): Voice | undefined {
    return this.voices.find(id);
  }

  job(id: string): Job | undefined {
    return this.jobs.find(id);
  }

  enqueue(
    kind: any,
    voice: Voice,
    request: unknown,
    maxQueue: number,
    idem?: string,
  ): Job {
    return this.jobs.enqueue(kind, voice, request, maxQueue, idem);
  }

  acquire(owner: string, ttl: number): boolean {
    return this.locks.acquire(owner, ttl);
  }

  claim(owner: string, ttl: number): Job | undefined {
    return this.jobs.claim(owner, ttl);
  }

  owns(j: Job): boolean {
    return this.jobs.owns(j);
  }

  heartbeat(owner: string, j: Job, ttl: number): boolean {
    return this.jobs.heartbeat(owner, j, ttl);
  }

  progress(j: Job, phase: any, completed: number, total: number): void {
    this.jobs.progress(j, phase, completed, total);
  }

  chunk(j: Job, index: number) {
    return this.chunks.find(j, index);
  }

  checkpoint(j: Job, index: number, fingerprint: string, path: string): void {
    this.chunks.checkpoint(j, index, fingerprint, path);
  }

  finish(j: Job, artifactDir: string, retentionMs: number): void {
    this.jobs.finish(j, artifactDir, retentionMs);
  }

  fail(j: Job, e: unknown, retentionMs: number): void {
    this.jobs.fail(j, e, retentionMs);
  }
}
