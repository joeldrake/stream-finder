/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// D1-liknande adapter över node:sqlite, med schemat från db/migrations. Endast för tester.
export function testD1() {
  const db = new DatabaseSync(":memory:");
  const dir = join(import.meta.dirname, "../../db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, file), "utf8"));
  }
  const d1 = {
    prepare: (sql: string) => ({
      bind: (...args: (string | number | null)[]) => ({
        run: () => db.prepare(sql).run(...args),
        all: async () => ({ results: db.prepare(sql).all(...args) }),
      }),
    }),
    batch: async (statements: { run: () => unknown }[]) => {
      db.exec("BEGIN");
      try {
        for (const s of statements) s.run();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return [];
    },
  } as unknown as D1Database;
  return { db, d1 };
}
