import assert from "node:assert/strict";
import { it } from "vitest";
import { savedHttpFixture } from "../../unit/served-database-surfaces/fixtures.js";
import { id, HASH, NOW } from "../../unit/database-foundation/fixtures.js";
import { RunRecordService } from "../../../src/backend/runs/run-record-service.js";
import { fanOutQueuedRuns, type FanOutEnvelope } from "../../../src/backend/runs/run-fan-out.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { CommandResultSchema, COMMAND_FAMILY_REGISTRY } from "../../../src/domain/commands.js";

it("refuses stale HTTP, direct service and direct fan-out relaunch without IDs, lineage, events or authority effects", async () => {
  const f = savedHttpFixture();
  try {
    const run = f.base.run;
    const before = f.database.getMeta().authorityGeneration;
    const service = new RunRecordService({ database: f.database, clock: f.base.clock,
      ids: { uuid: () => { throw new Error("retired-call-allocated-id"); } }, publishQueued: () => { throw new Error("retired-call-published"); } });
    const create = { code: "pl", matchKey: "retired-synthetic", workflow: run.envelope.workflow,
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
      configFingerprint: run.envelope.configFingerprint, configSnapshotId: run.envelope.configSnapshotId,
      resolvedInstance: run.envelope.resolvedInstance, priority: "bulk", shape: "single", dryRun: true, input: run.input,
      runtimeConfig: { generation: 1, settingsRevision: 1, settingsFingerprint: HASH, configFingerprint: run.envelope.configFingerprint } };
    assert.deepEqual(service.relaunch({ commandId: id(8800), archivedRunId: run.envelope.runId,
      archiveFingerprint: HASH, relaunchedBy: "local-operator", create }, personLookupDescriptor), { state: "refused", refusal: { reason: "invalid-state" } });
    const untouched = new Proxy(f.database.authority, { get() { throw new Error("retired-fanout-touched-authority"); } });
    assert.throws(() => fanOutQueuedRuns(untouched, service, message => { throw new Error(message); }, personLookupDescriptor,
      { relaunch: { archivedRunId: run.envelope.runId, archiveFingerprint: HASH } } as unknown as FanOutEnvelope, [], NOW, "retired-test"), /archive relaunch is retired/);
    const request = { commandId: id(8801), requestedAt: NOW, requestedBy: "local-operator", source: "archive", family: "version-archive",
      type: "relaunch-archived-run", target: { archivedRunId: run.envelope.runId, archiveFingerprint: HASH } };
    const response = await f.app().request("http://localhost/api/v1/commands", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(request) });
    assert.equal(response.status, 422, await response.clone().text());
    const result = CommandResultSchema.parse(await response.json());
    assert.equal(result.state, "rejected");
    assert.equal(f.database.getMeta().authorityGeneration, before);
    assert.equal(f.database.authority.commands.get(request.commandId), undefined);
    assert.equal("archiveRelaunches" in f.database.authority, false);
    assert.equal(COMMAND_FAMILY_REGISTRY.some(row => row.actions.some(action => action === "relaunch-archived-run")), false);
  } finally { f.dispose(); }
});
