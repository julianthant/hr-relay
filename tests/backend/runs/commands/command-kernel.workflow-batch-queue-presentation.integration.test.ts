import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { appliedRunIds } from "../../../support/fixtures/operator-command-fixtures.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, openDatabases, profiles, rejectActiveDescriptor, createHarness, createPlan, startCommand } = createCommandKernelTestWorld();


afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});


describe("workflow batch queue presentation", () => {
  it("defaults multi-run starts to grouped and changes only presentation with a replay-safe audited command", async () => {
    const h = await createHarness();
    const plan = createPlan(h, rejectActiveDescriptor, ["10800000", "10800001"]);
    const start = h.kernel.execute(startCommand(plan));
    const runIds = appliedRunIds(start);
    const runs = runIds.map((id) => h.database.authority.runs.get(id));
    const batchId = runs[0]?.sessionId;
    assert.ok(batchId);
    assert.equal(h.database.authority.runSessions.get(batchId)?.groupInQueue, true);
    const command = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", family: "workflow-batch", type: "set-batch-grouping", target: { batchId, expectedVersion: 1 }, payload: { groupInQueue: false } });
    const result = h.kernel.execute(command);
    assert.equal(result.state, "applied");
    assert.equal(h.database.authority.runSessions.get(batchId)?.groupInQueue, false);
    assert.equal(h.database.authority.runSessions.get(batchId)?.version, 2);
    assert.deepEqual(runIds.map((id) => h.database.authority.runs.get(id)), runs);
    assert.ok(h.database.authority.commandAudits.findByCommand(command.commandId));
    assert.equal(h.kernel.execute(command).state, "already-applied");
    assert.equal(h.database.authority.runSessions.get(batchId)?.version, 2);
    assert.equal(h.kernel.execute({ ...command, commandId: randomUUID() }).state, "conflict");
    assert.equal(h.kernel.execute({ ...command, commandId: randomUUID(), target: { batchId: randomUUID(), expectedVersion: 1 } }).state, "rejected");
    assert.equal(h.kernel.execute({ ...command, commandId: randomUUID(), target: { batchId, expectedVersion: 2 }, payload: { groupInQueue: true } }).state, "applied");
  });

  it("defaults a single-run start to separate presentation", async () => {
    const h = await createHarness();
    const result = h.kernel.execute(startCommand(createPlan(h, rejectActiveDescriptor, ["10800000"])));
    const batchId = h.database.authority.runs.get(appliedRunIds(result)[0] ?? "")?.sessionId;
    assert.ok(batchId);
    assert.equal(h.database.authority.runSessions.get(batchId)?.groupInQueue, false);
  });
});
