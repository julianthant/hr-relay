import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { fixtureDescriptor } from "../../../support/fixtures/descriptor-fixtures.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createExplorerEditService } from "../../../../src/backend/runs/commands/explorer-edit-service.js";
import { explorerQueryDeps } from "../../../support/fixtures/explorer-seams.js";

const { roots, openDatabases, rejectActiveDescriptor, createHarness, nextCommandId, createPlan, startCommand } = createCommandKernelTestWorld();


afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function explorerCommand(
  descriptor: AnyWorkflowDescriptor,
  commandId: string,
  expectedOverrideRevision: number,
  label: string,
) {
  return {
    commandId,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    reason: `Apply reviewed label ${label}`,
    family: "explorer",
    type: "apply-explorer-edit",
    target: {
      workflowId: descriptor.id,
      expectedVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
      expectedOverrideRevision,
    },
    payload: { changes: [{ kind: "workflow-label", value: label }] },
  } as const;
}

function realExplorerEdits() {
  const query = explorerQueryDeps(
    manualClock(new Date(NOW)),
    FingerprintSchema.parse("b".repeat(64)),
  );
  const descriptor = query.modules.find(
    ({ descriptor: candidate }) => String(candidate.id) === "person-lookup",
  )?.descriptor;
  assert.ok(descriptor !== undefined);
  return {
    descriptor,
    service: createExplorerEditService({
      explorer: query,
      overrides: { read: () => undefined, readAll: () => [] },
    }),
  };
}

describe("command idempotency", () => {
  it("journals Explorer apply with actor/source audit and executes one write across byte-exact replay", async () => {
    const harness = await createHarness();
    const command = {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "explorer",
      type: "apply-explorer-edit",
      target: {
        workflowId: fixtureDescriptor.id,
        expectedVersion: fixtureDescriptor.version,
        contractFingerprint: fixtureDescriptor.contractFingerprint,
        expectedOverrideRevision: 0,
      },
      payload: {
        changes: [{ kind: "workflow-label", value: "Reviewed fixture label" }],
      },
    };

    const first = harness.kernel.execute(command);
    assert.equal(first.state, "applied");
    if (first.state !== "applied") return;
    assert.deepEqual(first.affectedTargets, [{ family: "explorer", workflowId: fixtureDescriptor.id, revision: 1 }]);
    assert.equal(harness.explorerCalls.length, 1);
    assert.equal(harness.database.authority.explorerOverrides.read(fixtureDescriptor.id)?.revision, 1);

    const audit = harness.database.authority.commandAudits.findByCommand(first.commandId);
    assert.ok(audit !== undefined);
    assert.equal(audit.request.requestedBy, "local-operator");
    assert.equal(audit.request.source, "dashboard");
    assert.deepEqual(audit.versionChanges, [{
      target: { family: "explorer", workflowId: fixtureDescriptor.id, revision: 1 },
      before: 0,
      after: 1,
    }]);

    const replayed = harness.kernel.execute(structuredClone(command));
    assert.equal(replayed.state, "already-applied");
    assert.equal(harness.explorerCalls.length, 1);
  });

  it("rolls back an Explorer edit with its audit, then accepts a valid intervening command", async () => {
    const explorer = realExplorerEdits();
    let failAudit = true;
    const harness = await createHarness((repositories) => ({
      ...repositories,
      commandAudits: { ...repositories.commandAudits, insert: (input: unknown) => {
        if (failAudit) { failAudit = false; throw new Error("injected Explorer audit failure"); }
        return repositories.commandAudits.insert(input);
      } },
    }), { explorerEdits: explorer.service });
    const original = explorerCommand(explorer.descriptor, "11111111-2222-4333-8444-555555555555", 0, "People search");
    const generation = harness.database.getMeta().authorityGeneration;
    assert.throws(() => harness.kernel.execute(original), /injected Explorer audit failure/u);
    assert.equal(harness.database.authority.commands.get(original.commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(original.commandId), undefined);
    assert.deepEqual(harness.database.authority.explorerOverrides.readAll(), []);
    assert.equal(harness.database.getMeta().authorityGeneration, generation);
    const stale = explorerCommand(explorer.descriptor, "66666666-7777-4888-8999-000000000000", 1, "Directory search");
    assert.equal(harness.kernel.execute(stale).state, "conflict");
    const valid = { ...stale, target: { ...stale.target, expectedOverrideRevision: 0 } };
    assert.equal(harness.kernel.execute(valid).state, "applied");
    assert.equal(harness.kernel.execute(original).state, "conflict");
    assert.equal(harness.database.authority.explorerOverrides.read("person-lookup")?.presentation.label, "Directory search");
  });

  it("recovers an ambiguous authority commit from the journal without a file finalizer", async () => {
    const explorer = realExplorerEdits();
    let throwAfterCommit = true;
    const harness = await createHarness(undefined, { explorerEdits: explorer.service, afterAuthorityCommit: () => {
      if (throwAfterCommit) { throwAfterCommit = false; throw new Error("injected ambiguous authority commit return"); }
    } });
    const original = explorerCommand(explorer.descriptor, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", 0, "People search");
    assert.throws(() => harness.kernel.execute(original), /injected ambiguous authority commit return/u);
    assert.equal(harness.database.authority.explorerOverrides.read("person-lookup")?.presentation.label, "People search");
    assert.ok(harness.database.authority.commandAudits.findByCommand(original.commandId));
    assert.throws(() => harness.kernel.execute({ ...original, reason: "Different envelope" }), /reused|identity/u);
    assert.equal(harness.kernel.execute(structuredClone(original)).state, "already-applied");
    const next = explorerCommand(explorer.descriptor, "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb", 1, "Directory search");
    assert.equal(harness.kernel.execute(next).state, "applied");
    assert.equal(harness.database.authority.explorerOverrides.read("person-lookup")?.presentation.label, "Directory search");
  });

  it("returns already-applied for a byte-exact replay after revalidating the plan bindings", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = startCommand(plan);
    const first = harness.kernel.execute(command);
    assert.equal(first.state, "applied");
    if (first.state !== "applied") return;

    const generationBefore = harness.database.getMeta().authorityGeneration;
    const replayed = harness.kernel.execute(structuredClone(command));
    assert.equal(replayed.state, "already-applied");
    if (replayed.state !== "already-applied") return;
    assert.deepEqual(replayed.affectedTargets, first.affectedTargets);
    // Replay reads; it never re-executes.
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
    const runs = harness.database.authority.runs.listByItem({
      workflow: plan.workflowId,
      itemId: plan.planned[0].itemId,
    });
    assert.equal(runs.length, 1);
  });

  it("rejects a same-id different-content replay loudly", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = startCommand(plan);
    assert.equal(harness.kernel.execute(command).state, "applied");
    const conflicting = { ...command, reason: "a different body wearing the same id" };
    assert.throws(() => harness.kernel.execute(conflicting), /reused with different content/);
  });

  it("refuses a spent plan presented by a different command", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    assert.equal(harness.kernel.execute(startCommand(plan)).state, "applied");
    const second = harness.kernel.execute(startCommand(plan, nextCommandId()));
    assert.equal(second.state, "rejected");
    if (second.state === "rejected") {
      assert.equal(second.code, "invalid-state");
      assert.match(second.message, /already consumed/);
    }
  });
});
