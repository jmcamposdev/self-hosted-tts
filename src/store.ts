import type { DatabaseSync } from "node:sqlite";
import { Store as ModernStore } from "./persistence/store.js";
import type { Voice } from "./domain/voice/voice.types.js";
import type { Job } from "./domain/job/job.types.js";

export type { Voice, Job };

export class Store {
  private readonly modern: ModernStore;

  constructor(data: string) {
    this.modern = new ModernStore(data);
  }

  get db(): DatabaseSync {
    return this.modern.database.sqlite;
  }

  get voices() {
    return this.modern.voices;
  }

  get jobs() {
    return this.modern.jobs;
  }

  get chunks() {
    return this.modern.chunks;
  }

  get locks() {
    return this.modern.locks;
  }

  transaction<T>(f: () => T): T {
    return this.modern.transaction(f);
  }

  voice(id: string): Voice | undefined {
    return this.modern.voices.find(id);
  }

  job(id: string): Job | undefined {
    return this.modern.jobs.find(id);
  }

  enqueue(
    kind: any,
    voice: Voice,
    request: unknown,
    maxQueue: number,
    idem?: string,
  ): Job {
    return this.modern.jobs.enqueue(kind, voice, request, maxQueue, idem);
  }

  acquire(owner: string, ttl: number): boolean {
    return this.modern.locks.acquire(owner, ttl);
  }

  claim(owner: string, ttl: number): Job | undefined {
    return this.modern.jobs.claim(owner, ttl);
  }

  owns(j: Job): boolean {
    return this.modern.jobs.owns(j);
  }

  heartbeat(owner: string, j: Job, ttl: number): boolean {
    return this.modern.jobs.heartbeat(owner, j, ttl);
  }

  progress(j: Job, phase: any, completed: number, total: number): void {
    this.modern.jobs.progress(j, phase, completed, total);
  }

  chunk(j: Job, index: number) {
    return this.modern.chunks.find(j, index);
  }

  checkpoint(j: Job, index: number, fingerprint: string, path: string): void {
    this.modern.chunks.checkpoint(j, index, fingerprint, path);
  }

  finish(j: Job, artifactDir: string, retentionMs: number): void {
    this.modern.jobs.finish(j, artifactDir, retentionMs);
  }

  fail(j: Job, e: unknown, retentionMs: number): void {
    this.modern.jobs.fail(j, e, retentionMs);
  }
}
