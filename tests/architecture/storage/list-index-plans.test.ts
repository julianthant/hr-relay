import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { z } from "zod";
import { SQLITE_MIGRATIONS } from "../../../src/backend/storage/sqlite/migrations.js";
import { seedStorageReadFixture } from "../../perf/storage-read-fixture.js";
import { traceSqliteStatements } from "../../perf/sqlite-statement-counter.js";
import { literalStatements, normalizeSql, tracedStatements } from "./helpers/query-plan-audit.js";

const plan = (database: DatabaseSync, sql: string) => database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
  .map(row => z.object({ detail: z.string() }).parse(row).detail).join("\n");

/** The shipped statements this migration serves, picked out of the store's source and its traced reads, and the index each plan must use. */
const PINNED_PLANS: readonly (readonly [RegExp, RegExp, string?])[] = [
  [/^SELECT id, request_json, parent_id FROM commands WHERE id IN \(SELECT value FROM json_each\(\?1\)\) OR parent_id IN \(SELECT value FROM json_each\(\?1\)\)/u,
    /SEARCH commands USING INDEX commands_child_idx \(parent_id=\?\)/u, "the OR of three keyed lookups merges a handful of rows into id order"],
  [/^SELECT \* FROM timeline_events WHERE run_id IN \(SELECT value FROM json_each\(\?\)\) AND kind IN \('run\.queued','run\.claimed'\) ORDER BY run_id,cursor$/u,
    /SEARCH timeline_events USING INDEX timeline_run_idx \(run_id=\?\)/u],
  [/^SELECT \* FROM runs INDEXED BY runs_parent_idx WHERE parent_id IN \(SELECT value FROM json_each\(\?\)\) ORDER BY parent_id,id$/u,
    /SEARCH runs USING INDEX runs_parent_idx \(parent_id=\?\)/u],
  [/^SELECT \* FROM delegation_dependencies WHERE parent_run_id IN \(SELECT value FROM json_each\(\?\)\) ORDER BY parent_run_id,id$/u,
    /SEARCH delegation_dependencies USING INDEX dependencies_parent_order_idx \(parent_run_id=\?\)/u],
  [/^SELECT \* FROM delegation_dependencies WHERE parent_run_id = \? ORDER BY created_at, id$/u,
    /SEARCH delegation_dependencies USING INDEX dependencies_parent_run_idx \(parent_run_id=\?\)/u],
  [/^INSERT INTO canonical_run_page SELECT row_number\(\) OVER \( ORDER BY CASE priority .*,id\),id FROM runs$/u,
    /SCAN runs USING COVERING INDEX runs_queue_order_idx/u],
  [/^INSERT INTO canonical_run_page SELECT row_number\(\) OVER \( ORDER BY CASE priority .*,id\),id FROM runs WHERE workflow=\?$/u,
    /SEARCH runs USING COVERING INDEX runs_workflow_queue_order_idx \(workflow=\?\)/u],
  [/^SELECT r\.\* FROM canonical_run_page p CROSS JOIN runs r ON r\.id=p\.run_id WHERE p\.position>\? AND p\.position<=\? ORDER BY p\.position$/u,
    /^SEARCH p USING INTEGER PRIMARY KEY \(rowid>\? AND rowid<\?\)\nSEARCH r USING INDEX sqlite_autoindex_runs_1 \(id=\?\)$/u],
  [/^SELECT \* FROM gate_results WHERE run_id = \? ORDER BY created_at, id$/u, /SEARCH gate_results USING INDEX gates_run_idx \(run_id=\?\)/u],
  [/^SELECT \* FROM runs WHERE owner_worker_id = \? ORDER BY created_at, id$/u, /SEARCH runs USING INDEX runs_owned_idx \(owner_worker_id=\?\)/u],
  [/^SELECT \* FROM notifications WHERE actor_id = \? ORDER BY created_at, id$/u, /SEARCH notifications USING INDEX notifications_actor_idx \(actor_id=\?\)/u],
  [/^SELECT \* FROM run_batches WHERE workflow = \? ORDER BY started_at, id$/u, /SEARCH run_batches USING INDEX run_batches_workflow_idx \(workflow=\?\)/u],
  [/^SELECT \* FROM run_failures WHERE fingerprint = \? ORDER BY created_at, id$/u, /SEARCH run_failures USING INDEX failures_fingerprint_idx \(fingerprint=\?\)/u],
  [/^SELECT count\(\*\) AS count FROM run_failures WHERE fingerprint = \?$/u, /SEARCH run_failures USING COVERING INDEX failures_fingerprint_idx \(fingerprint=\?\)/u],
  [/^SELECT \* FROM ocr_approved_snapshots WHERE run_id=\? ORDER BY created_at,id$/u, /SEARCH ocr_approved_snapshots USING INDEX ocr_approved_run_idx \(run_id=\?\)/u],
  [/^DELETE FROM debug_events WHERE run_id=\?$/u, /SEARCH debug_events USING (?:COVERING )?INDEX debug_events_run_idx \(run_id=\?\)/u],
  [/^SELECT 1 FROM commands WHERE family IN \('settings','settings-initialization'\) LIMIT 1$/u, /SEARCH commands USING (?:COVERING )?INDEX commands_\w+ \(family=\?\)/u],
];

/** Every literal statement under src/backend, the dashboard reads' traced statements, and both run-page rebuilds, which are built at run time, and the failure list. */
async function shippedStatements(): Promise<readonly string[]> {
  const statements = new Set([...literalStatements().statements.keys(), ...(await tracedStatements()).keys()]);
  const fixture = await seedStorageReadFixture(3);
  try {
    const [workflow] = fixture.reader.summaryWorkflows();
    assert.ok(workflow !== undefined);
    for (const work of [() => fixture.reader.authority.runs.listPage({ offset: 0, limit: 50 }),
      () => fixture.reader.authority.runs.listPage({ workflow, offset: 0, limit: 50 }),
      // The failure list's statement reaches prepare through a helper, so the literal collector misses it.
      () => fixture.reader.authority.failures.listByFingerprint("0".repeat(64))]) {
      for (const { sql } of traceSqliteStatements(work).statements) statements.add(normalizeSql(sql));
    }
  } finally { await fixture.close(); }
  return [...statements];
}

describe("list index plans", () => {
  it("plans each shipped list and lookup it serves through its index, with no temporary sort", async () => {
    const shipped = await shippedStatements();
    const database = new DatabaseSync(":memory:");
    try {
      for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
      for (const statement of literalStatements().tempDdl) database.exec(statement);
      for (const [selector, expected, sortAllowed] of PINNED_PLANS) {
        const matches = shipped.filter(sql => selector.test(sql));
        const [sql] = matches;
        assert.ok(matches.length === 1 && sql !== undefined, `one shipped statement matches ${String(selector)}: ${matches.join(" | ")}`);
        const detail = plan(database, sql);
        assert.match(detail, expected, sql);
        if (sortAllowed === undefined) assert.doesNotMatch(detail, /USE TEMP B-TREE/u, sql);
      }
    } finally { database.close(); }
  }, 120_000);
});
