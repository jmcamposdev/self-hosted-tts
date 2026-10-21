import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { migrate } from "./migrations.js";

/** SQLite connection with reentrant `BEGIN IMMEDIATE` transactions. */
export class Database {
  readonly sqlite: DatabaseSync;
  private inTransaction = false;

  constructor(dataDir: string) {
    this.sqlite = new DatabaseSync(join(dataDir, "state.sqlite"));
    this.sqlite.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    migrate(this.sqlite);
  }

  /** Runs `work` atomically; a nested call joins the outer transaction. */
  transaction<T>(work: () => T): T {
    if (this.inTransaction) return work();
    this.sqlite.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = work();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    } finally {
      this.inTransaction = false;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
