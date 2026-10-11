import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { AUTHORITY_RECORD_SCHEMA_REGISTRY } from "../../../src/backend/storage/sqlite/storage-records.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../../src/models/config/authority.js";
import { DryRunScenarioResultSchema } from "../../../src/models/trust/dry-run-scenario-result.js";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dry-run scenario result authority repository", () => {
  it("registers the table and its boot-time record schema", () => {
    assert.equal(
      AUTHORITY_TABLE_REGISTRY.find(({ name }) => name === "dryrun_results")?.classification,
      "authority",
    );
    assert.equal(AUTHORITY_RECORD_SCHEMA_REGISTRY.dryrun_results, DryRunScenarioResultSchema);
  });
});
