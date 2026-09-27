import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { readRuntimeVersionAuthority, RuntimeVersionAdoptionSchema } from "../../src/infra/sqlite/runtime-versions.js";
import { planRuntimeVersionTransition } from "../../src/domain/archive/runtime-version.js";

describe("runtime version authority migration", () => {
  it("creates a 1.0 baseline in a fresh authority", () => {
    const root = mkdtempSync(join(tmpdir(), "archive-versions-"));
    const path = join(root, "authority.sqlite");
    try {
      const authority = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "unit-test" });
      authority.close();
      const database = new DatabaseSync(path, { readOnly: true });
      try {
        assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 55);
        assert.deepEqual(readRuntimeVersionAuthority(database).state, { dashboard: { major: 1, minor: 0 }, workflows: [] });
      } finally { database.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("persists registration, claim and publication through the canonical authority transaction", () => {
    const root = mkdtempSync(join(tmpdir(), "archive-versions-"));
    const path = join(root, "authority.sqlite");
    const changeId = "00000000-0000-4000-8000-000000000002";
    try {
      const authority = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "unit-test" });
      const baseline = authority.registerRuntimeVersionWorkflows(["separations", "intake"]);
      const planned = planRuntimeVersionTransition(baseline.state, { kind: "workflows", workflowIds: ["separations"] });
      const review = authority.reviewRuntimeVersionTransition({ kind: "workflows", workflowIds: ["separations"] });
      const claimed = authority.claimRuntimeVersionTransition({
        changeId, expectedRevision: baseline.revision, workflowIds: planned.affectedWorkflowIds, after: planned.after,
        expectedMembershipDigest: review.review.membershipDigest,
      });
      assert.equal(claimed.claim?.changeId, changeId);
      authority.close();
      const reopened = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "unit-test" });
      try {
        assert.equal(reopened.readRuntimeVersionAuthority().claim?.changeId, changeId);
        const published = reopened.publishRuntimeVersionTransition({
          changeId, expectedRevision: claimed.revision, next: planned.after,
        });
        assert.equal(published.state.workflows.find(row => row.workflowId === "separations")?.version.minor, 1);
        assert.equal(published.claim, undefined);
      } finally { reopened.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("adopts existing live rows at 1.0 without rewriting their source JSON", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("CREATE TABLE database_state (updated_at TEXT NOT NULL)");
      database.exec("INSERT INTO database_state VALUES ('2026-09-24T00:00:00.000Z')");
      database.exec("CREATE TABLE workflow_runs (record_key TEXT PRIMARY KEY, workflow TEXT NOT NULL, record_json TEXT NOT NULL, created_at TEXT NOT NULL)");
      const runId = "00000000-0000-4000-8000-000000000001";
      const sourceJson = JSON.stringify({ envelope: { runId, workflow: "separations" } });
      database.prepare("INSERT INTO workflow_runs VALUES (?,?,?,?)").run(runId, "separations", sourceJson, "2026-09-23T00:00:00.000Z");
      const migration = SQLITE_MIGRATIONS.find(row => row.version === 55);
      assert.ok(migration);
      for (const statement of migration.statements) database.exec(statement);
      const authority = readRuntimeVersionAuthority(database);
      assert.deepEqual(authority.state, {
        dashboard: { major: 1, minor: 0 },
        workflows: [{ workflowId: "separations", version: { major: 1, minor: 0 } }],
      });
      const adopted = database.prepare("SELECT record_json FROM runtime_version_adoptions WHERE record_key=?").get(runId);
      assert.ok(adopted && typeof adopted.record_json === "string");
      assert.deepEqual(RuntimeVersionAdoptionSchema.parse(JSON.parse(adopted.record_json)), {
        runId, workflowId: "separations", dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 0 },
      });
      assert.equal(database.prepare("SELECT record_json FROM workflow_runs WHERE record_key=?").get(runId)?.record_json, sourceJson);
      assert.throws(() => database.prepare("UPDATE workflow_runs SET record_json=? WHERE record_key=?")
        .run(JSON.stringify({ envelope: { runId, workflow: "separations" }, runtimeVersion: { dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 0 } } }), runId), /run runtime version is immutable/u);
      assert.throws(() => database.prepare("DELETE FROM runtime_version_adoptions WHERE record_key=?").run(runId), /runtime version adoption is retained/u);
    } finally { database.close(); }
  });
});
