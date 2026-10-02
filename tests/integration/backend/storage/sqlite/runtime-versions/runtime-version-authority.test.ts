import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";

import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { planRuntimeVersionTransition } from "../../../../../../src/models/archive/runtime-version.js";
import {
  INITIAL_RUNTIME_VERSION_AUTHORITY,
  RUNTIME_VERSIONS_DDL,
  claimRuntimeVersionTransition,
  publishRuntimeVersionTransition,
  readRuntimeVersionAuthority,
  registerRuntimeVersionWorkflows,
  runtimeVersionForNewRun,
} from "../../../../../../src/backend/storage/sqlite/runtime-versions.js";

const NOW = "2026-09-24T00:00:00.000Z";
const CHANGE_ID = "00000000-0000-4000-8000-000000000001";

function fresh() {
  const database = new DatabaseSync(":memory:");
  database.exec(RUNTIME_VERSIONS_DDL);
  database.exec("CREATE TABLE workflow_runs (record_key TEXT PRIMARY KEY, workflow TEXT NOT NULL)");
  database.prepare("INSERT INTO runtime_versions VALUES ('current', ?, ?)")
    .run(canonicalJsonStringify(INITIAL_RUNTIME_VERSION_AUTHORITY), NOW);
  return database;
}

describe("runtime version authority", () => {
  it("requires explicit workflow registration and fences only affected run creation", () => {
    const database = fresh();
    try {
      assert.throws(() => runtimeVersionForNewRun(readRuntimeVersionAuthority(database), "separations"), /unregistered/u);
      const baseline = registerRuntimeVersionWorkflows(database, ["separations", "intake"], NOW);
      assert.deepEqual(runtimeVersionForNewRun(baseline, "separations"), {
        dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 0 },
      });
      const planned = planRuntimeVersionTransition(baseline.state, { kind: "workflows", workflowIds: ["separations"] });
      const claimed = claimRuntimeVersionTransition(database, {
        changeId: CHANGE_ID, expectedRevision: baseline.revision, workflowIds: planned.affectedWorkflowIds, after: planned.after, now: NOW,
      });
      database.prepare("INSERT INTO workflow_runs VALUES (?,?)").run("00000000-0000-4000-8000-000000000010", "separations");
      assert.throws(() => publishRuntimeVersionTransition(database, {
        changeId: CHANGE_ID, expectedRevision: claimed.revision, next: planned.after, now: NOW,
      }), /transfer-incomplete/u);
      database.prepare("DELETE FROM workflow_runs WHERE workflow=?").run("separations");
      assert.throws(() => runtimeVersionForNewRun(claimed, "separations"), /claimed/u);
      assert.deepEqual(runtimeVersionForNewRun(claimed, "intake").workflow, { major: 1, minor: 0 });
      assert.throws(() => registerRuntimeVersionWorkflows(database, ["access"], NOW), /claim-active/u);
      const published = publishRuntimeVersionTransition(database, {
        changeId: CHANGE_ID, expectedRevision: claimed.revision, next: planned.after, now: NOW,
      });
      assert.deepEqual(runtimeVersionForNewRun(published, "separations").workflow, { major: 1, minor: 1 });
      assert.deepEqual(runtimeVersionForNewRun(published, "intake").workflow, { major: 1, minor: 0 });
    } finally { database.close(); }
  });

  it("rejects stale and divergent publication without changing stored state", () => {
    const database = fresh();
    try {
      const baseline = registerRuntimeVersionWorkflows(database, ["separations", "intake"], NOW);
      const planned = planRuntimeVersionTransition(baseline.state, { kind: "dashboard" });
      assert.throws(() => claimRuntimeVersionTransition(database, {
        changeId: CHANGE_ID, expectedRevision: 1, workflowIds: planned.affectedWorkflowIds, after: planned.after, now: NOW,
      }), /review-stale/u);
      const claimed = claimRuntimeVersionTransition(database, {
        changeId: CHANGE_ID, expectedRevision: baseline.revision, workflowIds: planned.affectedWorkflowIds, after: planned.after, now: NOW,
      });
      assert.throws(() => publishRuntimeVersionTransition(database, {
        changeId: "00000000-0000-4000-8000-000000000002", expectedRevision: claimed.revision, next: planned.after, now: NOW,
      }), /claim-mismatch/u);
      assert.throws(() => publishRuntimeVersionTransition(database, {
        changeId: CHANGE_ID, expectedRevision: claimed.revision, next: baseline.state, now: NOW,
      }), /publication-divergent/u);
      assert.deepEqual(readRuntimeVersionAuthority(database), claimed);
      assert.throws(() => runtimeVersionForNewRun(claimed, "intake"), /claimed/u);
    } finally { database.close(); }
  });
});
