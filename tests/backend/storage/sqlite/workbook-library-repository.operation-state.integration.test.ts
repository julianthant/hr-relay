import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { configureWritableConnection } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, type WorkbookOperationState } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { WorkbookLibraryError } from "../../../../src/backend/workbooks/workbook-library-error.js";
import { type WorkbookOperation, type WorkbookOperationReceipt } from "../../../../src/models/dashboard/workbooks.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";

/** Section 3 entry 34, observed through enqueue, drain and operation. */
type Phase = "absent" | WorkbookOperationState;
type Event = "enqueue-same" | "enqueue-other" | "settle" | "bind-resolution";
type Effect = "queued" | "replay" | "replay-with-receipt" | "operation-conflict" | "not-queued" | "receipt" | "already-settled" | "admitted";

const CONFLICT = "operation-conflict";
const expected = {
  absent: { "enqueue-same": "queued", "enqueue-other": "queued", settle: "not-queued", "bind-resolution": CONFLICT },
  queued: { "enqueue-same": "replay", "enqueue-other": CONFLICT, settle: "receipt", "bind-resolution": CONFLICT },
  applied: { "enqueue-same": "replay-with-receipt", "enqueue-other": CONFLICT, settle: "already-settled", "bind-resolution": CONFLICT },
  refused: { "enqueue-same": "replay-with-receipt", "enqueue-other": CONFLICT, settle: "already-settled", "bind-resolution": CONFLICT },
  "resolve-required": { "enqueue-same": "replay-with-receipt", "enqueue-other": CONFLICT, settle: "already-settled", "bind-resolution": "admitted" },
} as const satisfies Record<Phase, Record<Event, Effect>>;

const at = IsoInstantSchema.parse("2026-11-02T00:00:00.000Z");
const earlier = IsoInstantSchema.parse("2026-10-01T00:00:00.000Z");
const run = { kind: "run" as const, runId: "10000000-0000-4000-8000-000000000001" };
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(database => database.close()); });

interface Opened {
  database: DatabaseSync;
  repository: ReturnType<typeof createWorkbookLibraryRepository>;
  service: ReturnType<typeof createWorkbookLibraryService>;
  id: string;
  operation?: WorkbookOperation;
  receipt?: WorkbookOperationReceipt;
}

function patch(operationId: string, key: string, note: string, when = at): WorkbookOperation {
  return { operationId, at: when, source: run, change: { kind: "patch", key, values: { "roster.notes": note } } };
}

const QueueRow = z.object({ sequence: z.number(), operation_id: z.string(), digest: z.string(), request_json: z.string(), receipt_json: z.string().nullable() });
function queue(opened: Opened) {
  return opened.database.prepare("SELECT sequence, operation_id, digest, request_json, receipt_json FROM workbook_operations WHERE workbook_id=? ORDER BY sequence").all(opened.id).map(row => QueueRow.parse(row));
}

function isConflict(error: unknown): boolean {
  return error instanceof WorkbookLibraryError && error.code === "WORKBOOK_OPERATION_CONFLICT";
}

function resolution(original: WorkbookOperation, digest: string, operationId: string, version: number): WorkbookOperation {
  if (original.change.kind !== "patch") throw new Error("workbook-operation-test-not-patch");
  return { operationId, at, source: original.source, change: { kind: "patch", key: original.change.key, values: original.change.values,
    expectedVersion: version, selection: { sheetId: "people", rowId: "alice", expectedVersion: version },
    resolves: { operationId: original.operationId, receiptDigest: digest } } };
}

function open(): Opened {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  configureWritableConnection(database, 5000);
  for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements]) database.exec(statement);
  const tx = <T>(work: () => T): T => {
    database.exec("BEGIN IMMEDIATE");
    try { const value = work(); database.exec("COMMIT"); return value; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, read: tx, mutate: work => tx(() => work().result) });
  const service = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository, clock: manualClock(new Date(at)) });
  const saved = service.create({ name: "Roster.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "people", name: "People", width: 3, hidden: [], headerRow: 1,
    columnBindings: ["eid", "roster.legalName", "roster.notes"].map((fieldId, index) => ({ id: `col${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
    rows: [{ id: "header", cells: ["EID", "Legal name", "Notes"].map(value => ({ value })) },
      { id: "alice", cells: [{ value: "001" }, { value: "Alice" }, { value: null }] },
      { id: "bob", cells: [{ value: "002" }, { value: "Bob" }, { value: "" }] }] }] });
  database.prepare("UPDATE workbook_library SET metadata_json=? WHERE id=?").run(canonicalJsonStringify({ typeId: "roster", sharePoint: null }), saved.libraryId);
  repository.putType({ id: "roster", name: "Roster", keyFieldId: "eid", fields: ["eid", "roster.legalName", "roster.notes"], defaultWorkbookId: saved.libraryId });
  return { database, repository, service, id: saved.libraryId };
}

function reach(phase: Phase): Opened {
  const opened = open();
  if (phase === "absent") return opened;
  const operation = phase === "refused" ? patch("head", "001", "settled-note", earlier)
    : phase === "resolve-required" ? patch("head", "absent", "missing")
    : patch("head", "001", "settled-note");
  if (phase === "queued") {
    opened.repository.enqueue(opened.id, operation);
    return { ...opened, operation };
  }
  const receipt = opened.repository.operation(opened.id, operation);
  if (phase === "applied") expect(receipt).toMatchObject({ state: "applied" });
  if (phase === "refused") expect(receipt).toMatchObject({ state: "refused", reason: "invalid" });
  if (phase === "resolve-required") expect(receipt).toMatchObject({ state: "resolve-required", reason: "missing-key" });
  expect(opened.service.read(opened.id).workbook.sheets[0].rows[1].cells[2].value).toBe(phase === "applied" ? "settled-note" : null);
  return { ...opened, operation, receipt };
}

function observe(phase: Phase, event: Event, opened: Opened): Effect {
  const before = queue(opened);
  if (event === "enqueue-same" || event === "enqueue-other") {
    const body = opened.operation === undefined
      ? patch(event, "001", event)
      : event === "enqueue-same" ? opened.operation
      : { ...opened.operation, change: { ...opened.operation.change, values: { "roster.notes": "other-note" } } };
    try {
      const sequence = opened.repository.enqueue(opened.id, body);
      const after = queue(opened);
      if (before.length === 0 && after.length === 1 && after[0].receipt_json === null && after[0].sequence === sequence) return "queued";
      if (JSON.stringify(before) === JSON.stringify(after) && before[0]?.sequence === sequence) {
        return before[0].receipt_json === null ? "replay" : "replay-with-receipt";
      }
    } catch (error) {
      if (isConflict(error) && JSON.stringify(queue(opened)) === JSON.stringify(before)) return CONFLICT;
      throw error;
    }
    throw new Error(`workbook-operation-test-enqueue:${phase}:${event}`);
  }
  if (event === "settle") {
    opened.repository.drain(opened.id);
    const after = queue(opened);
    if (before.length === 0 && after.length === 0) return "not-queued";
    if (JSON.stringify(before) === JSON.stringify(after)) return "already-settled";
    const written = after.find((row, index) => before[index]?.receipt_json == null && row.receipt_json != null);
    const receipt = opened.repository.journal(opened.id).find(item => item.sequence === written?.sequence);
    if (receipt?.state !== "applied" || opened.service.read(opened.id).workbook.sheets[0].rows[1].cells[2].value !== "settled-note") {
      throw new Error(`workbook-operation-test-settle:${receipt?.state}`);
    }
    return "receipt";
  }
  const version = opened.service.read(opened.id).version;
  const original = opened.operation ?? patch("missing-head", "001", "unbound");
  const digest = opened.receipt === undefined ? "a".repeat(64) : sha256Hex(canonicalJsonStringify(opened.receipt));
  try {
    const sequence = opened.repository.enqueue(opened.id, resolution(original, digest, "bind-head", version));
    const after = queue(opened);
    const added = after.find(row => row.sequence === sequence);
    const originalRow = before.find(row => row.operation_id === original.operationId);
    const kept = after.find(row => row.operation_id === original.operationId);
    if (added?.receipt_json === null && JSON.stringify(kept) === JSON.stringify(originalRow) && after.length === before.length + 1) return "admitted";
  } catch (error) {
    if (isConflict(error) && JSON.stringify(queue(opened)) === JSON.stringify(before)) return CONFLICT;
    throw error;
  }
  throw new Error(`workbook-operation-test-bind:${phase}`);
}

for (const phase of Object.keys(expected) as Phase[]) {
  for (const event of Object.keys(expected[phase]) as Event[]) {
    it(`${phase} on ${event}`, () => {
      expect(observe(phase, event, reach(phase))).toBe(expected[phase][event]);
    });
  }
}

it("refuses bind-resolution when a resolution was already applied", () => {
  const opened = open();
  const current = opened.service.read(opened.id);
  const workbook = structuredClone(current.workbook);
  workbook.sheets[0].rows.push({ ...structuredClone(workbook.sheets[0].rows[1]), id: "duplicate" });
  opened.service.save(opened.id, current.version, workbook);
  const version = opened.service.read(opened.id).version;
  const original = patch("ambiguous", "001", "chosen");
  const receipt = opened.repository.operation(opened.id, original);
  expect(receipt).toMatchObject({ state: "resolve-required", reason: "duplicate-key" });
  const digest = sha256Hex(canonicalJsonStringify(receipt));
  expect(opened.repository.operation(opened.id, resolution(original, digest, "resolve-once", version)).state).toBe("applied");
  const before = queue(opened);
  expect(() => opened.repository.enqueue(opened.id, resolution(original, digest, "resolve-twice", version))).toThrow(expect.objectContaining({ code: "WORKBOOK_OPERATION_CONFLICT" }));
  expect(queue(opened)).toEqual(before);
  expect(opened.repository.journal(opened.id).find(item => item.operationId === "resolve-once")?.state).toBe("applied");
});
