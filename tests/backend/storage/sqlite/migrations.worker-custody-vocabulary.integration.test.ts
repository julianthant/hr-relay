import assert from "node:assert/strict";
import { it } from "vitest";
import { WORKER_CUSTODY_DROPPED_TABLES } from "../../../../src/backend/storage/sqlite/migrations.js";

it("refuses writes to the worker custody dropped-table vocabulary", () => {
  assert.throws(() => Object.assign(WORKER_CUSTODY_DROPPED_TABLES, { 0: WORKER_CUSTODY_DROPPED_TABLES[0] }), TypeError);
});
