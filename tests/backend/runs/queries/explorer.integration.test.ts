import { retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { buildExplorerCompileAttestation,createExplorerEditService } from "../../../../src/backend/runs/commands/explorer-edit-service.js";
import { buildWorkflowExplorer } from "../../../../src/backend/runs/queries/explorer.js";
import { ExplorerWorkflowWireSchema } from "../../../../src/models/dashboard/explorer.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { GENERATED_BUILD_MANIFEST } from "../../../../src/workflow-kit/validation/generated-build-manifest.js";
import { explorerAuthorityFixture } from "../../../support/fixtures/explorer-authority.js";
import { explorerQueryDeps } from "../../../support/fixtures/explorer-seams.js";

const retainedExplorerCases = new Set<object>();

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const SOURCE_FIELD = { nodeId: "crm-dates", fieldPath: "employmentDate", label: "Employment date" };

function draft(f: Awaited<ReturnType<typeof explorerAuthorityFixture>>, changes: readonly unknown[] = [{ kind: "workflow-label", value: "People search" }]) {
  return { draftVersion: 1, workflowId: f.descriptor.id, baseDescriptorVersion: f.descriptor.version,
    baseContractFingerprint: f.descriptor.contractFingerprint, baseOverrideRevision: 0, changes };
}

function untouched(f: Awaited<ReturnType<typeof explorerAuthorityFixture>>) {
  assert.deepEqual(f.database.authority.explorerOverrides.readAll(), []);
  assert.equal(f.database.authority.commands.get(FIRST), undefined);
  assert.equal(f.database.authority.commandAudits.findByCommand(FIRST), undefined);
}

function validControl(f: Awaited<ReturnType<typeof explorerAuthorityFixture>>) {
  assert.equal(f.service.validate(draft(f)).state, "ready-to-apply");
  assert.equal(f.kernel.execute(f.command(SECOND)).state, "applied");
  assert.equal(f.database.authority.explorerOverrides.read("person-lookup")?.revision, 1);
}

describe("Explorer registered graph and service acceptance", () => {

  it("distinguishes an empty registry and an unregistered target from an impossible zero-node workflow", async () => {
    const f = await explorerAuthorityFixture();
    const held: { f: typeof f; primary?: { error: unknown } } = { f };
    retainedExplorerCases.add(held);
    try {
      const query = explorerQueryDeps(f.clock, FingerprintSchema.parse("b".repeat(64)));
      assert.deepEqual(buildWorkflowExplorer({ ...query, modules: [] }).workflows, []);
      assert.equal(f.service.validate({ ...draft(f), workflowId: "unregistered-workflow" }).state, "refused");
      assert.equal(ExplorerWorkflowWireSchema.safeParse({ ...f.read().workflows[0], nodes: [] }).success, false);
      untouched(f);
      validControl(f);
    } catch (error) { held.primary = { error }; throw retainAuthoritySourceClosure([error], { admission: held }); }
    await f.dispose();
    retainedExplorerCases.delete(held);
  });

  it("refuses manifest source drift before effects, then accepts the unchanged registered control", async () => {
    const f = await explorerAuthorityFixture();
    const held: { f: typeof f; primary?: { error: unknown } } = { f };
    retainedExplorerCases.add(held);
    try {
      const query = explorerQueryDeps(f.clock, FingerprintSchema.parse("b".repeat(64)));
      const broken = { ...query, buildManifest: { ...GENERATED_BUILD_MANIFEST, workflows: GENERATED_BUILD_MANIFEST.workflows.map(w => ({ ...w, sources: [{ path: "src/missing-workflow.ts" }] })) } };
      const projected = buildWorkflowExplorer(broken);
      assert.ok(projected.workflows.some(w => w.sources.descriptor.state === "unresolved"));
      const service = createExplorerEditService({ explorer: broken, overrides: f.database.authority.explorerOverrides });
      assert.throws(() => service.validate(draft(f)), /compile attestation.*source.*unresolved/u);
      untouched(f);
      validControl(f);
    } catch (error) { held.primary = { error }; throw retainAuthoritySourceClosure([error], { admission: held }); }
    await f.dispose();
    retainedExplorerCases.delete(held);
  });

  it("refuses served scenario registration drift before effects while accepting absent physical scenario sources", async () => {
    const f = await explorerAuthorityFixture();
    const held: { f: typeof f; primary?: { error: unknown } } = { f };
    retainedExplorerCases.add(held);
    try {
      const query = explorerQueryDeps(f.clock, FingerprintSchema.parse("b".repeat(64)));
      const workflow = buildWorkflowExplorer(query).workflows.find(w => w.id === f.descriptor.id);
      assert.ok(workflow);
      assert.doesNotThrow(() => buildExplorerCompileAttestation(query, workflow));
      assert.throws(() => buildExplorerCompileAttestation(query, { ...workflow, scenarios: [] }), /served scenario registrations differ/u);
      untouched(f);
      validControl(f);
    } catch (error) { held.primary = { error }; throw retainAuthoritySourceClosure([error], { admission: held }); }
    await f.dispose();
    retainedExplorerCases.delete(held);
  });

  it.each(["graph", "selector", "schema", "timeline-label", "notification-preferences"])("rejects forbidden %s drafts and commands without successful records", async kind => {
    const f = await explorerAuthorityFixture();
    const held: { f: typeof f; primary?: { error: unknown } } = { f };
    retainedExplorerCases.add(held);
    try {
      const changes = [{ kind, value: "unapproved" }];
      assert.throws(() => f.service.validate(draft(f, changes)));
      assert.throws(() => f.kernel.execute({ ...f.command(FIRST), payload: { changes } }));
      untouched(f);
      validControl(f);
    } catch (error) { held.primary = { error }; throw retainAuthoritySourceClosure([error], { admission: held }); }
    await f.dispose();
    retainedExplorerCases.delete(held);
  });

  it.each([
    { changes: [{ kind: "workflow-label", value: "Person Lookup" }], category: "empty-diff" },
    { changes: [{ kind: "enqueue-policy", value: "reject-active" }], category: "empty-diff" },
    { changes: [{ kind: "workflow-label", value: "People search" }, { kind: "enqueue-policy", value: "allow-parallel" }], category: "mixed-apply-levels" },
    { changes: [{ kind: "enqueue-policy", value: "reject-active" }, { kind: "edit-data-fields", fields: [SOURCE_FIELD] }], category: "partial-no-op" },
    { changes: [{ kind: "edit-data-fields", fields: [{ ...SOURCE_FIELD, fieldPath: "not.allowlisted" }] }], category: "edit-data-field-allowlist" },
  ])("refuses $category without effects and preserves a reachable valid command", async ({ changes, category }) => {
    const f = await explorerAuthorityFixture();
    const held: { f: typeof f; primary?: { error: unknown } } = { f };
    retainedExplorerCases.add(held);
    try {
      const result = f.service.validate(draft(f, changes));
      assert.equal(result.state, "refused");
      if (result.state !== "refused") throw new Error("invalid draft admitted");
      assert.equal(result.category, category);
      assert.equal(f.kernel.execute({ ...f.command(FIRST), payload: { changes } }).state, "rejected");
      untouched(f);
      validControl(f);
    } catch (error) { held.primary = { error }; throw retainAuthoritySourceClosure([error], { admission: held }); }
    await f.dispose();
    retainedExplorerCases.delete(held);
  });

  it("refuses all stale bases, replays exactly and restores appearance at a new revision after reopening SQLite", async () => {
    const f = await explorerAuthorityFixture();
    const held: { f: typeof f; primary?: { error: unknown } } = { f };
    retainedExplorerCases.add(held);
    try {
      for (const basis of [{ baseDescriptorVersion: f.descriptor.version + 1 }, { baseContractFingerprint: "0".repeat(64) }, { baseOverrideRevision: 9 }]) {
        assert.equal(f.service.validate({ ...draft(f), ...basis }).state, "conflict");
        untouched(f);
      }
      const command = f.command(FIRST);
      assert.equal(f.kernel.execute(command).state, "applied");
      const generation = f.database.getMeta().authorityGeneration;
      f.restart();
      assert.equal(f.kernel.execute(command).state, "already-applied");
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      assert.equal(f.kernel.execute(f.command(SECOND, 0)).state, "conflict");
      const restore = f.command(THIRD, 1, f.descriptor.label);
      assert.equal(f.service.validate({ ...draft(f, restore.payload.changes), baseOverrideRevision: 1 }).state, "ready-to-apply");
      assert.equal(f.kernel.execute(restore).state, "applied");
      f.restart();
      assert.equal(f.read().workflows.find(w => w.id === f.descriptor.id)?.label, f.descriptor.label);
      assert.equal(f.database.authority.explorerOverrides.read("person-lookup")?.revision, 2);
      assert.equal(f.kernel.execute(command).state, "already-applied");
      assert.equal(f.database.authority.commandAudits.findByCommand(THIRD)?.result.state, "applied");
    } catch (error) { held.primary = { error }; throw retainAuthoritySourceClosure([error], { admission: held }); }
    await f.dispose();
    retainedExplorerCases.delete(held);
  });
});
