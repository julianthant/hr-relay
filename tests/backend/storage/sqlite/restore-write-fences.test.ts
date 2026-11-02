import assert from "node:assert/strict";
import { it } from "vitest";
import { assertRestorePreservesWriteFences, restoreWriteFenceDigest, type RestoreWriteFences } from "../../../../src/backend/storage/sqlite/restore-write-fences.js";

const original: RestoreWriteFences = { unresolved: ["unknown-write"], tables: [
  { name: "write_intents", rows: ['{"id":"unknown-write","status":"parked"}'] },
  { name: "write_attempts", rows: ['{"id":"attempt","intent_id":"unknown-write"}'] },
  { name: "artifacts", rows: ['{"id":"receipt","digest":"proof"}'] },
] };

it("accepts a backup retaining every unresolved intent, original attempt and evidence row", () => {
  assert.doesNotThrow(() => assertRestorePreservesWriteFences(original, { ...original, unresolved: [...original.unresolved, "another-unknown"] }));
  assert.equal(restoreWriteFenceDigest(structuredClone(original)), restoreWriteFenceDigest(original));
});

it.each(["write_intents", "write_attempts", "artifacts"] as const)("refuses a backup losing or changing %s evidence", name => {
  const changed = { ...original, tables: original.tables.map(table => table.name === name ? { ...table, rows: ['{"changed":true}'] } : table) };
  assert.throws(() => assertRestorePreservesWriteFences(original, changed), /restore-would-weaken-write-evidence/u);
  assert.notEqual(restoreWriteFenceDigest(changed), restoreWriteFenceDigest(original));
});

it("refuses an UNKNOWN write becoming absent or resolved in the backup", () => {
  assert.throws(() => assertRestorePreservesWriteFences(original, { ...original, unresolved: [] }), /restore-would-lose-unresolved-write/u);
});

it("allows ordinary repair with a proved empty unresolved-write set", () => {
  assert.doesNotThrow(() => assertRestorePreservesWriteFences({ unresolved: [], tables: [] }, original));
});

import { readRestoreWriteFences } from "../../../../src/backend/storage/sqlite/restore-write-fences.js";
import { WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";

function reader(tables: Readonly<Record<string, readonly unknown[]>>) {
  return { prepare(sql: string) { const table = /FROM ([a-z_]+)/u.exec(sql)?.[1];
    if (table === undefined) throw new Error("unexpected fixture query");
    return { all: () => tables[table] ?? [] };
  } };
}

it("preserves orphaned attempts and parked runs even when their intent row is absent", () => {
  const attempt = { id: WRITE_ATTEMPT.writeAttemptId, intent_id: WRITE_ATTEMPT.writeIntentId, generation: WRITE_ATTEMPT.generation,
    run_id: WRITE_ATTEMPT.runId, payload_json: JSON.stringify(WRITE_ATTEMPT) };
  const source = readRestoreWriteFences(reader({ write_attempts: [attempt], runs: [{ state: "parked-write",
    lifecycle_json: JSON.stringify({ lifecycle: { state: "parked-write", writeIntentId: WRITE_ATTEMPT.writeIntentId } }) }] }));
  assert.deepEqual(source.unresolved, [WRITE_ATTEMPT.writeIntentId]);
  assert.equal(source.tables.find(table => table.name === "write_attempts")?.rows.length, 1);
  assert.throws(() => assertRestorePreservesWriteFences(source, { unresolved: [], tables: [] }), /lose-unresolved/u);
});

it("preserves standalone external-write spans and refuses unreadable fence metadata", () => {
  const source = readRestoreWriteFences(reader({ timeline_events: [{ operation_id: null, payload_json: JSON.stringify({ kind: "span", event: { t: "transaction.fenced" } }) }] }));
  assert.equal(source.tables.find(table => table.name === "timeline_events")?.rows.length, 1);
  assert.throws(() => assertRestorePreservesWriteFences(source, { unresolved: [], tables: [] }), /weaken-write-evidence/u);
  assert.throws(() => readRestoreWriteFences(reader({ runs: [{ state: "terminal", lifecycle_json: "unreadable" }] })));
});

it("refuses a status column that hides an unresolved intent payload", () => {
  assert.throws(() => readRestoreWriteFences(reader({ write_intents: [{ id: WRITE_INTENT_ATTEMPTING.writeIntentId, status: "committed", generation: WRITE_INTENT_ATTEMPTING.generation,
    run_id: WRITE_INTENT_ATTEMPTING.runId, payload_json: JSON.stringify(WRITE_INTENT_ATTEMPTING) }] })), /fence-record-invalid/u);
});

for (const table of ["deleted_runs", "artifacts"] as const) it(`preserves ${table} even without an unresolved intent`, () => {
  const source = readRestoreWriteFences(reader({ [table]: [{ id: "durable-external-effect", payload_json: "retained" }] }));
  assert.equal(source.tables.find(value => value.name === table)?.rows.length, 1);
  assert.throws(() => assertRestorePreservesWriteFences(source, { unresolved: [], tables: [] }), /weaken-write-evidence/u);
});

it("reads the stored lifecycle wrapper and refuses a hidden parked state", () => {
  assert.doesNotThrow(() => readRestoreWriteFences(reader({ runs: [{ state: "queued", lifecycle_json: JSON.stringify({ lifecycle: { state: "queued" } }) }] })));
  assert.throws(() => readRestoreWriteFences(reader({ runs: [{ state: "queued", lifecycle_json: JSON.stringify({ lifecycle: { state: "parked-write", writeIntentId: WRITE_ATTEMPT.writeIntentId } }) }] })), /run-fence-record-invalid/u);
});
