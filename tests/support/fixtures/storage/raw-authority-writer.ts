import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

/** Drops every guard trigger, as another process's raw writer would write; the change log's capture and reference triggers stay. */
export function dropGuardTriggers(raw: DatabaseSync): void {
  const triggers = z.array(z.object({ name: z.string() })).parse(raw.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all());
  for (const { name } of triggers) if (!/_change_(?:insert|update|delete)$|_run_references_(?:insert|update|delete)$/u.test(name)) raw.exec(`DROP TRIGGER "${name}"`);
}

/** The newest change-log sequence number, the cursor a reader that has seen every change holds. */
export function logCursor(raw: DatabaseSync): number {
  return z.object({ seq: z.number().int().nullable() }).parse(raw.prepare("SELECT max(seq) AS seq FROM authority_changes").get()).seq ?? 0;
}
