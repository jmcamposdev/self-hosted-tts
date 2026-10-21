import type { Voice } from "#domain/voice/voice.types.js";
import type { Database } from "../database.js";

export class VoiceRepository {
  constructor(private readonly db: Database) {}

  find(id: string): Voice | undefined {
    return this.db.sqlite.prepare("SELECT * FROM voices WHERE id=?").get(id) as
      Voice | undefined;
  }

  count(): number {
    return Number(
      (
        this.db.sqlite.prepare("SELECT count(*) AS n FROM voices").get() as {
          n: number;
        }
      ).n,
    );
  }

  listActive(): Voice[] {
    return this.db.sqlite
      .prepare(
        "SELECT * FROM voices WHERE status!='deleted' ORDER BY created_at",
      )
      .all() as unknown as Voice[];
  }

  listDeletedIds(): string[] {
    return (
      this.db.sqlite
        .prepare("SELECT id FROM voices WHERE status='deleted'")
        .all() as { id: string }[]
    ).map((v) => v.id);
  }

  insertCloning(voice: {
    id: string;
    name: string;
    defaultsJson: string;
    referencePath: string;
    createdAt: number;
  }): void {
    this.db.sqlite
      .prepare("INSERT INTO voices VALUES(?,?,'cloning',?,?,NULL,?)")
      .run(
        voice.id,
        voice.name,
        voice.defaultsJson,
        voice.referencePath,
        voice.createdAt,
      );
  }

  update(id: string, name: string, defaultsJson: string): void {
    this.db.sqlite
      .prepare("UPDATE voices SET name=?,defaults_json=? WHERE id=?")
      .run(name, defaultsJson, id);
  }

  markReady(id: string, profilePath: string): void {
    this.db.sqlite
      .prepare(
        "UPDATE voices SET status='ready',profile_path=? WHERE id=? AND status='cloning'",
      )
      .run(profilePath, id);
  }

  markDeleted(id: string): void {
    this.db.sqlite
      .prepare("UPDATE voices SET status='deleted' WHERE id=?")
      .run(id);
  }

  failIfCloning(id: string): void {
    this.db.sqlite
      .prepare(
        "UPDATE voices SET status='failed' WHERE id=? AND status='cloning'",
      )
      .run(id);
  }

  /** Voices still `cloning` whose clone job already ended unsuccessfully. */
  failOrphanedCloning(): void {
    this.db.sqlite
      .prepare(
        "UPDATE voices SET status='failed' WHERE status='cloning' AND id IN (SELECT voice_id FROM jobs WHERE kind='clone' AND status IN ('cancelled','failed'))",
      )
      .run();
  }
}
