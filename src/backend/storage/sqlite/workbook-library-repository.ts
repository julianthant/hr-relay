import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { deserializeSavedWorkbook, serializeSavedWorkbook, SavedWorkbookSchema, WorkbookLibraryError, type SavedWorkbook, type WorkbookLibraryRepository } from "../../workbooks/workbook-library-service.js";

export const WORKBOOK_LIBRARY_MIGRATION = Object.freeze({
  id: "workbook-library",
  statements: Object.freeze([
    `CREATE TABLE workbook_library (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>0),
      created_at TEXT NOT NULL, saved_at TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
    ) STRICT`,
    `CREATE TABLE workbook_library_history (
      workbook_id TEXT NOT NULL REFERENCES workbook_library(id), version INTEGER NOT NULL CHECK(version>0),
      created_at TEXT NOT NULL, saved_at TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), PRIMARY KEY(workbook_id,version)
    ) STRICT`,
    `CREATE TRIGGER workbook_library_history_immutable BEFORE UPDATE ON workbook_library_history BEGIN SELECT RAISE(ABORT,'workbook-history-immutable'); END`,
    `CREATE TRIGGER workbook_library_history_retained BEFORE DELETE ON workbook_library_history BEGIN SELECT RAISE(ABORT,'workbook-history-retained'); END`,
    `CREATE TRIGGER workbook_library_history_no_replace BEFORE INSERT ON workbook_library_history WHEN EXISTS(SELECT 1 FROM workbook_library_history WHERE workbook_id=NEW.workbook_id AND version=NEW.version) BEGIN SELECT RAISE(ABORT,'workbook-history-immutable'); END`,
  ]),
});
const RowSchema = z.strictObject({ id: z.string(), version: z.number().int().positive(), created_at: z.string(), saved_at: z.string(), payload_json: z.string() });
function fromRow(value: unknown): SavedWorkbook {
  try {
    const row = RowSchema.parse(value), record = deserializeSavedWorkbook(row.payload_json);
    if (record.libraryId !== row.id || record.version !== row.version || record.createdAt !== row.created_at || record.savedAt !== row.saved_at) throw new Error("workbook-column-conflict");
    return record;
  } catch (cause) { throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT", { cause }); }
}
function storage<T>(work: () => T): T {
  try { return work(); }
  catch (cause) {
    if (cause instanceof WorkbookLibraryError) throw cause;
    throw new WorkbookLibraryError("WORKBOOK_STORAGE_FAILED", { cause });
  }
}
export function createWorkbookLibraryRepository(deps: Readonly<{
  database: DatabaseSync;
  mutate<T>(work: () => Readonly<{ result: T; changes: number }>): T;
  read<T>(work: () => T): T;
}>): WorkbookLibraryRepository {
  const { database } = deps;
  const current = (id: string) => {
    const row = database.prepare("SELECT * FROM workbook_library WHERE id=?").get(id);
    return row === undefined ? undefined : fromRow(row);
  };
  const revisions = (id: string) => database.prepare("SELECT workbook_id AS id,version,created_at,saved_at,payload_json FROM workbook_library_history WHERE workbook_id=? ORDER BY version").all(id).map(fromRow);
  const checked = (id: string) => {
    const record = current(id);
    const head = database.prepare("SELECT workbook_id AS id,version,created_at,saved_at,payload_json FROM workbook_library_history WHERE workbook_id=? ORDER BY version DESC LIMIT 1").get(id);
    if (record === undefined) {
      if (head !== undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      return undefined;
    }
    if (head === undefined || serializeSavedWorkbook(fromRow(head)) !== serializeSavedWorkbook(record)) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    return record;
  };
  const publish = (input: SavedWorkbook, expectedVersion: number | undefined) => storage(() => deps.mutate(() => {
    const record = SavedWorkbookSchema.parse(input), before = checked(record.libraryId);
    if (expectedVersion === undefined) {
      if (before !== undefined || record.version !== 1) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
    } else {
      if (before === undefined) throw new WorkbookLibraryError("WORKBOOK_NOT_FOUND");
      if (before.version !== expectedVersion) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
      if (record.version !== expectedVersion + 1 || record.createdAt !== before.createdAt || Date.parse(record.savedAt) < Date.parse(before.savedAt)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
    }
    const json = serializeSavedWorkbook(record);
    const updated = expectedVersion === undefined
      ? database.prepare("INSERT INTO workbook_library(id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)").run(record.libraryId, record.version, record.createdAt, record.savedAt, json)
      : database.prepare("UPDATE workbook_library SET version=?,saved_at=?,payload_json=? WHERE id=? AND version=?").run(record.version, record.savedAt, json, record.libraryId, expectedVersion);
    if (Number(updated.changes) !== 1) throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
    database.prepare("INSERT INTO workbook_library_history(workbook_id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)").run(record.libraryId, record.version, record.createdAt, record.savedAt, json);
    const result = checked(record.libraryId);
    if (result === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
    return { result, changes: 2 };
  }));
  return Object.freeze({
    create: (record: SavedWorkbook) => publish(record, undefined),
    save: (record: SavedWorkbook, expectedVersion: number) => publish(record, expectedVersion),
    read: (id: string) => storage(() => deps.read(() => checked(id))),
    list: () => storage(() => deps.read(() => database.prepare("SELECT id FROM workbook_library ORDER BY saved_at DESC,id").all().map(row => {
      const id = z.strictObject({ id: z.string() }).parse(row).id, record = checked(id);
      if (record === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      return record;
    }))),
    history: (id: string) => storage(() => deps.read(() => {
      const record = checked(id), history = revisions(id);
      if (record !== undefined && (history.length !== record.version || history.some((revision, index) => revision.version !== index + 1 || revision.createdAt !== record.createdAt
        || (index > 0 && Date.parse(revision.savedAt) < Date.parse(history[index - 1].savedAt))))) throw new WorkbookLibraryError("WORKBOOK_STORAGE_CORRUPT");
      return history;
    })),
  });
}

export function validateWorkbookLibrary(database: DatabaseSync): number {
  const repository = createWorkbookLibraryRepository({ database, read: work => work(),
    mutate: () => { throw new Error("workbook-validation-read-only"); } });
  return repository.list().reduce((count, record) => count + 1 + repository.history(record.libraryId).length, 0);
}
