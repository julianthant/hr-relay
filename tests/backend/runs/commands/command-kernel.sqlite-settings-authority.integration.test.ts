import { createSettingsAuthorityTestWorld } from "../../../support/helpers/backend/settings-authority-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";

const {fixture, protectedCommand, failAudit, cleanup } = createSettingsAuthorityTestWorld();

afterEach(cleanup);

describe("SQLite settings authority", () => {
  it("refuses a retained credential identity before async worker-pool effects", async () => {
    const f = fixture();
    const pending = protectedCommand(f.store.read().revision);
    assert.throws(() => f.execute(pending, failAudit(f.database)), /credential-audit-uncertain/u);
    const path = join(f.root, "credentials", "protected.json");
    const bytes = readFileSync(path);
    const before = f.store.read();
    const generation = f.database.getMeta().authorityGeneration;
    let effects = 0;
    const unused = (): never => { effects++; throw new Error("unexpected kernel seam"); };
    const ids = { uuid: randomUUID };
    const kernel = createCommandKernel({
      authority: f.database, clock: f.clock, ids,
      lifecycle: new RunRecordService({ database: f.database, clock: f.clock, ids, publishQueued: () => {} }),
      appVersion: "0.1.0",
      configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      descriptors: { resolve: (id) => DESCRIPTORS.find((descriptor) => String(descriptor.id) === id) },
      writeResolution: { resolvePresent: unused, resolveAbsent: unused },
      workerRuntime: { pool: {
        planPoolWorkerCount: () => { effects++; return Promise.resolve({ state: "accepted", workerIds: ["person-lookup-worker-1"], retirements: [] }); },
        spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused,
        stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused,
      } },
    });
    const command = { family: "worker-browser", type: "plan-worker-count", commandId: pending.commandId,
      requestedAt: pending.requestedAt, requestedBy: "local-operator", source: "dashboard",
      target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } };
    const result = await kernel.executeWorkerPool(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "command-divergent");
    assert.equal(effects, 0, "phase A must refuse before the external process seam, even though phase C also checks identity");
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(f.database.authority.commands.get(pending.commandId), undefined);
    assert.equal(f.database.authority.commandAudits.findByCommand(pending.commandId), undefined);
    assert.equal(f.database.authority.workerPools.get("person-lookup"), undefined);
    assert.deepEqual(f.store.read(), before);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(f.execute(pending).state, "applied");
    // Positive control: the same valid pool request reaches its effect with a fresh ID.
    assert.equal((await kernel.executeWorkerPool({ ...command, commandId: randomUUID() })).state, "applied");
    assert.equal(effects, 1);
    assert.deepEqual(readFileSync(path), bytes);
  });
});
