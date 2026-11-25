import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { CHANGE_LOG_PAGE_ENTRIES, readAuthorityChanges, validateAuthorityChanges } from "../../../../src/backend/storage/sqlite/authority-change-admission.js";
import { seedCheckClosureStore } from "../../../support/fixtures/storage/check-closure-store.js";
import { logCursor } from "../../../support/fixtures/storage/raw-authority-writer.js";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

const COMMAND_GROUP_READ = /^SELECT id, request_json, parent_id FROM commands WHERE id IN \(SELECT value FROM json_each\(\?1\)\) OR parent_id IN \(SELECT value FROM json_each\(\?1\)\)/u;

/** The sorted command ids each scoped command-group read is bound to while `work` runs, in call order. */
function commandGroupBindings(work: () => unknown): readonly (readonly string[])[] {
  const bindings: string[][] = [];
  const all = Object.getOwnPropertyDescriptor(StatementSync.prototype, "all");
  assert.ok(all !== undefined && typeof all.value === "function");
  const original = all.value as (this: StatementSync, ...values: unknown[]) => unknown;
  Object.defineProperty(StatementSync.prototype, "all", { ...all, value(this: StatementSync, ...values: unknown[]) {
    if (COMMAND_GROUP_READ.test(normalizeSql(this.sourceSQL))) bindings.push(z.array(z.string()).parse(JSON.parse(z.string().parse(values[0]))).sort(byNumber));
    return original.apply(this, values);
  } });
  try { work(); } finally { Object.defineProperty(StatementSync.prototype, "all", all); }
  return bindings;
}
const byNumber = (left: string, right: string) => Number(left.slice(5)) - Number(right.slice(5));

describe("list index plans", () => {

  it("binds each command-group sort, at peer admission and at startup, to one change-log page's commands", async () => {
    const store = await seedCheckClosureStore();
    const peer = new DatabaseSync(store.databasePath);
    try {
      const track = store.database.trackAuthorityTables(["commands"]);
      track();
      const entries = 2 * CHANGE_LOG_PAGE_ENTRIES + 1, from = logCursor(peer);
      peer.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
        INSERT INTO authority_changes(table_name,row_key,op,keys_json) SELECT 'commands',json_array('peer-'||i),'update',json_array('command:peer-'||i) FROM n`).run(entries);
      const pages = Array.from({ length: 3 }, (_, page) => Array.from({ length: Math.min(CHANGE_LOG_PAGE_ENTRIES, entries - page * CHANGE_LOG_PAGE_ENTRIES) },
        (_, at) => `peer-${String(page * CHANGE_LOG_PAGE_ENTRIES + at + 1)}`));
      expect(commandGroupBindings(() => track())).toEqual(pages);
      expect(commandGroupBindings(() => validateAuthorityChanges(peer, readAuthorityChanges(peer, from), []))).toEqual(pages);
    } finally { peer.close(); await store.cleanup(); }
  }, 120_000);
});
