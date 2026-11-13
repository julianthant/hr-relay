import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { validateAuthorityChanges, validateAuthorityStore, type AuthorityRowChange } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityTableNameSchema, type AuthorityTableName } from "../../../../src/models/config/authority.js";
import { seedCheckClosureStore } from "../../../support/fixtures/storage/check-closure-store.js";

type Row = Record<string, unknown>;
type Mutation = Readonly<{ label: string; apply: (raw: DatabaseSync) => AuthorityRowChange | undefined }>;

const ColumnSchema = z.object({ name: z.string(), type: z.string(), pk: z.number().int() });
const RowSchema = z.record(z.string(), z.unknown());

function verdict(work: () => void): string | undefined {
  try { work(); return undefined; } catch (error) { return error instanceof Error ? error.message : String(error); }
}

function input(value: unknown): SQLInputValue {
  return z.union([z.string(), z.number(), z.bigint(), z.null(), z.instanceof(Uint8Array)]).parse(value);
}

function jsonObject(value: unknown): Row {
  if (typeof value !== "string" || !value.startsWith("{")) return {};
  const parsed = RowSchema.safeParse(JSON.parse(value));
  return parsed.success ? parsed.data : {};
}

function rowAt(raw: DatabaseSync, table: AuthorityTableName, rowid: number): Row | undefined {
  const row = raw.prepare(`SELECT * FROM ${table} WHERE rowid=?`).get(rowid);
  return row === undefined ? undefined : RowSchema.parse(row);
}

/** A constraint the schema itself enforces makes the edit impossible for any writer, so the case is skipped. */
function applied(raw: DatabaseSync, sql: string, values: readonly SQLInputValue[]): number | bigint | undefined {
  try { return raw.prepare(sql).run(...values).lastInsertRowid; }
  catch (error) { if (error instanceof Error && "errcode" in error && [19, 20].includes(Number(error.errcode) & 0xff)) return undefined; throw error; }
}

/** One raw edit per column of every row (a value from another row, a changed value, NULL), plus a delete and a copy of each row. */
function mutations(raw: DatabaseSync, table: AuthorityTableName): Mutation[] {
  const columns = z.array(ColumnSchema).parse(raw.prepare(`PRAGMA table_info(${table})`).all());
  const rows = raw.prepare(`SELECT rowid AS rowid_, * FROM ${table} ORDER BY rowid`).all()
    .map(row => { const { rowid_: rowid, ...values } = RowSchema.parse(row); return { rowid: z.number().int().parse(rowid), values }; });
  const integerKey = columns.filter(({ pk }) => pk > 0);
  const rowAlias = integerKey.length === 1 && integerKey[0]?.type.toUpperCase() === "INTEGER" ? integerKey[0].name : undefined;
  const result: Mutation[] = [];
  for (const [index, { rowid, values }] of rows.entries()) {
    const update = (label: string, column: string, value: unknown): Mutation => ({ label: `${table}[${String(index)}].${column} := ${label}`, apply: db => {
      const before = rowAt(db, table, rowid);
      if (applied(db, `UPDATE ${table} SET ${column}=? WHERE rowid=?`, [input(value), rowid]) === undefined) return undefined;
      // An INTEGER PRIMARY KEY is the rowid, so editing it moves the row.
      const moved = rowAlias === column && typeof value === "number" ? value : rowid;
      return { table, before, after: rowAt(db, table, moved) };
    } });
    for (const { name } of columns) {
      const current = values[name];
      const other = rows.map(entry => entry.values[name]).find(value => value !== current && value !== null);
      if (other !== undefined) result.push(update("another row's value", name, other));
      if (typeof current === "string") result.push(update("a changed value", name, `${current}x`));
      if (typeof current === "number") result.push(update("a changed value", name, current + 1));
      if (current !== null) result.push(update("NULL", name, null));
      for (const [field, leaf] of Object.entries(jsonObject(current))) {
        const changed = typeof leaf === "string" ? `${leaf}x` : typeof leaf === "number" ? leaf + 1 : typeof leaf === "boolean" ? !leaf : undefined;
        if (changed !== undefined) result.push(update(`a changed ${field}`, name, JSON.stringify({ ...jsonObject(current), [field]: changed })));
        // A well-formed value of the same field from another row passes the row's own schema and reaches cross-row checks.
        const borrowed = rows.map(entry => jsonObject(entry.values[name])[field]).find(value => value !== undefined && JSON.stringify(value) !== JSON.stringify(leaf));
        if (borrowed !== undefined) result.push(update(`another row's ${field}`, name, JSON.stringify({ ...jsonObject(current), [field]: borrowed })));
      }
    }
    result.push({ label: `${table}[${String(index)}] deleted`, apply: db => {
      const before = rowAt(db, table, rowid);
      applied(db, `DELETE FROM ${table} WHERE rowid=?`, [rowid]);
      return { table, before };
    } });
    result.push({ label: `${table}[${String(index)}] copied under a new key`, apply: db => {
      const copy = Object.fromEntries(columns.map(({ name, pk }) => {
        const value = values[name];
        return [name, pk === 0 ? value : typeof value === "string" ? `${value}-copy` : null];
      }));
      const inserted = applied(db, `INSERT INTO ${table}(${columns.map(({ name }) => name).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        columns.map(({ name }) => input(copy[name])));
      return inserted === undefined ? undefined : { table, after: rowAt(db, table, Number(inserted)) };
    } });
  }
  return result;
}

describe("authority check closure", () => {
  let store: Awaited<ReturnType<typeof seedCheckClosureStore>>;
  let raw: DatabaseSync;
  beforeAll(async () => {
    store = await seedCheckClosureStore();
    store.closeDatabase();
    raw = new DatabaseSync(store.databasePath);
    // Another process's raw writer: no foreign keys and no guard triggers, inside a transaction this test rolls back.
    raw.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
    for (const trigger of z.array(z.object({ name: z.string() })).parse(raw.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all())) {
      raw.exec(`DROP TRIGGER "${trigger.name}"`);
    }
  });
  afterAll(async () => {
    raw.exec("ROLLBACK");
    raw.close();
    await store.cleanup();
  });

  it("starts from a store the whole-store check accepts", () => {
    expect(verdict(() => validateAuthorityStore(raw))).toBeUndefined();
  });

  it.each(AuthorityTableNameSchema.options)("refuses through the scoped check exactly when the whole check refuses an edit of %s", table => {
    const disagreements: string[] = [];
    let refused = 0;
    for (const mutation of mutations(raw, table)) {
      raw.exec("SAVEPOINT closure_case");
      try {
        const change = mutation.apply(raw);
        if (change === undefined) continue;
        const whole = verdict(() => validateAuthorityStore(raw));
        const scoped = verdict(() => validateAuthorityChanges(raw, [change]));
        if (whole !== undefined) refused += 1;
        if ((whole === undefined) !== (scoped === undefined)) disagreements.push(`${mutation.label}: whole=${whole ?? "valid"} scoped=${scoped ?? "valid"}`);
      } finally { raw.exec("ROLLBACK TO closure_case; RELEASE closure_case"); }
    }
    expect(disagreements).toEqual([]);
    expect(refused).toBeGreaterThan(0);
  });
});
