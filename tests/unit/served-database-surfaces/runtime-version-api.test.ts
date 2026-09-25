import assert from "node:assert/strict";
import { it } from "vitest";

import { CommandResultSchema } from "../../../src/domain/commands.js";
import { SavedArchiveIndexWireSchema, SavedArchiveGroupsWireSchema, SavedRuntimeVersionIndexWireSchema } from "../../../src/domain/dashboard/archive.js";
import { id, NOW } from "../database-foundation/fixtures.js";
import { savedHttpFixture } from "./fixtures.js";

it("serves a reviewed workflow bump, applies its exact command and filters the saved report", async () => {
  const f = savedHttpFixture({ registeredRuntimeVersion: true });
  try {
    f.database.registerRuntimeVersionWorkflows(["other-workflow"]);
    f.terminal();
    const app = f.app();
    const headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
    const read = async () => {
      const response = await app.request("http://localhost/api/v1/archive/runtime-versions", { headers });
      assert.equal(response.status, 200);
      return SavedRuntimeVersionIndexWireSchema.parse(await response.json());
    };
    const post = async (body: unknown) => {
      const response = await app.request("http://localhost/api/v1/commands", { method: "POST", headers, body: JSON.stringify(body) });
      const payload: unknown = await response.json();
      const result = CommandResultSchema.safeParse(payload);
      assert.ok(result.success, `command HTTP ${String(response.status)}: ${JSON.stringify(payload)}`);
      return { status: response.status, result: result.data };
    };
    const initial = await read();
    assert.deepEqual(initial.dashboard, { major: 1, minor: 0 });
    const emptyGroups = await app.request("http://localhost/api/v1/archive/groups", { headers });
    assert.equal(emptyGroups.status, 200);
    assert.deepEqual(SavedArchiveGroupsWireSchema.parse(await emptyGroups.json()), { groups: [] });
    const allAsMinor = await post({ commandId: id(88900), requestedAt: NOW, requestedBy: "local-operator", source: "archive",
      family: "version-archive", type: "plan-runtime-version",
      target: { scope: { kind: "workflows", workflowIds: ["person-lookup", "other-workflow"] } } });
    assert.equal(allAsMinor.status, 422);
    assert.equal(allAsMinor.result.state, "rejected");
    const plan = { commandId: id(88901), requestedAt: NOW, requestedBy: "local-operator", source: "archive",
      family: "version-archive", type: "plan-runtime-version", target: { scope: { kind: "workflows", workflowIds: ["person-lookup"] } } };
    assert.equal((await post(plan)).result.state, "applied");
    const reviewed = await read();
    const change = reviewed.changes.find(row => row.changeId === plan.commandId);
    assert.ok(change);
    assert.equal(change.state, "planned");
    assert.equal(change.members.length, 1);
    const apply = { commandId: id(88902), requestedAt: NOW, requestedBy: "local-operator", source: "archive",
      family: "version-archive", type: "apply-runtime-version",
      target: { changeId: change.changeId, reviewFingerprint: change.reviewFingerprint } };
    const applied = await post(apply);
    assert.equal(applied.status, 200);
    assert.equal(applied.result.state, "applied");
    assert.equal((await post(apply)).result.state, "already-applied");
    const current = await read();
    assert.deepEqual(current.dashboard, { major: 1, minor: 0 });
    assert.deepEqual(current.workflows.find(row => row.workflowId === "person-lookup")?.version, { major: 1, minor: 1 });
    const query = new URLSearchParams({ limit: "5", workflow: "person-lookup",
      dashboardVersion: JSON.stringify({ major: 1, minor: 0 }), workflowVersion: JSON.stringify({ major: 1, minor: 0 }) });
    const reports = await app.request(`http://localhost/api/v1/archive/reports?${query}`, { headers });
    assert.equal(reports.status, 200);
    const index = SavedArchiveIndexWireSchema.parse(await reports.json());
    assert.equal(index.items.length, 1);
    assert.equal(index.items[0]?.state, "available");
    assert.equal(index.next, null);
    const groupQuery = new URLSearchParams(query);
    groupQuery.delete("limit");
    const grouped = await app.request(`http://localhost/api/v1/archive/groups?${groupQuery}`, { headers });
    assert.equal(grouped.status, 200);
    const groups = SavedArchiveGroupsWireSchema.parse(await grouped.json());
    assert.deepEqual(groups.groups.map(({dashboardVersion, workflow, workflowVersion, reportCount}) =>
      ({dashboardVersion, workflow, workflowVersion, reportCount})), [{
        dashboardVersion: {major:1, minor:0}, workflow: "person-lookup",
        workflowVersion: {major:1, minor:0}, reportCount:1,
      }]);
    const unmatched = await app.request("http://localhost/api/v1/archive/groups?outcome=failed", { headers });
    assert.equal(unmatched.status, 200);
    assert.deepEqual(SavedArchiveGroupsWireSchema.parse(await unmatched.json()), {groups:[]});
    const report = index.items[0];
    assert.ok(report?.state === "available");
    const deleted = await post({ commandId: id(88903), requestedAt: NOW, requestedBy: "local-operator", source: "archive",
      family: "version-archive", type: "delete-archived-run",
      target: { archivedRunId: report.runId, archiveFingerprint: report.archiveFingerprint } });
    assert.equal(deleted.result.state, "applied");
    const afterDelete = await app.request("http://localhost/api/v1/archive/groups", { headers });
    assert.equal(afterDelete.status, 200);
    assert.deepEqual(SavedArchiveGroupsWireSchema.parse(await afterDelete.json()), {groups:[]});
  } finally { f.dispose(); }
});
