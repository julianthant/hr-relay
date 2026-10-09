/** A08/A09 acceptance over the registered graph and the accepted SQLite command seam. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { GENERATED_BUILD_MANIFEST } from "../../../../../../src/workflow-kit/validation/generated-build-manifest.js";
import { descriptorRuntimeNodes } from "../../../../../../src/workflow-kit/workflow.js";
import { ExplorerCodeChangeBriefSchema, ExplorerWorkflowWireSchema, type ExplorerNodeWire } from "../../../../../../src/models/dashboard/explorer.js";
import { buildWorkflowExplorer, EXPLORER_SOURCE_ROOT } from "../../../../../../src/backend/runs/queries/explorer.js";
import { buildUiTaskLinks } from "../../../../../../src/backend/systems/ui-task-links.js";
import { buildExplorerCompileAttestation, createExplorerEditService } from "../../../../../../src/backend/runs/commands/explorer-edit-service.js";
import { explorerAuthorityFixture } from "../../../../../support/fixtures/explorer-authority.js";
import { explorerQueryDeps } from "../../../../../support/fixtures/explorer-seams.js";
import { FingerprintSchema } from "../../../../../../src/rules/identity/ids.js";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const SOURCE_FIELD = { nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" };

function draft(f: ReturnType<typeof explorerAuthorityFixture>, changes: readonly unknown[] = [{ kind: "workflow-label", value: "People search" }]) {
  return { draftVersion: 1, workflowId: f.descriptor.id, baseDescriptorVersion: f.descriptor.version,
    baseContractFingerprint: f.descriptor.contractFingerprint, baseOverrideRevision: 0, changes };
}

function untouched(f: ReturnType<typeof explorerAuthorityFixture>) {
  assert.deepEqual(f.database.authority.explorerOverrides.readAll(), []);
  assert.equal(f.database.authority.commands.get(FIRST), undefined);
  assert.equal(f.database.authority.commandAudits.findByCommand(FIRST), undefined);
}

function validControl(f: ReturnType<typeof explorerAuthorityFixture>) {
  assert.equal(f.service.validate(draft(f)).state, "ready-to-apply");
  assert.equal(f.kernel.execute(f.command(SECOND)).state, "applied");
  assert.equal(f.database.authority.explorerOverrides.read("person-lookup")?.revision, 1);
}

describe("Explorer registered graph and service acceptance", () => {
  it("matches each runtime dependency, condition and dry-run boundary and resolves all printed sources", () => {
    const f = explorerAuthorityFixture();
    try {
      const query = explorerQueryDeps(f.clock, FingerprintSchema.parse("b".repeat(64)));
      const wire = f.read();
      const uiTaskLinks = buildUiTaskLinks();
      assert.deepEqual(wire.workflows.map(w => w.id), query.modules.map(m => m.descriptor.id));
      let conditional = 0;
      let transactions = 0;
      for (const module of query.modules) {
        const served = wire.workflows.find(w => w.id === module.descriptor.id);
        assert.ok(served);
        const nodes = descriptorRuntimeNodes(module.descriptor);
        assert.deepEqual(served.nodes.map(n => n.id), nodes.map(n => n.id));
        assert.deepEqual(served.edges.filter(e => e.kind === "depends-on"), nodes.flatMap(n => n.dependsOn.map(from => ({ from, to: n.id, kind: "depends-on" }))));
        for (const node of nodes) {
          const view: ExplorerNodeWire | undefined = served.nodes.find(n => n.id === node.id);
          assert.ok(view);
          if (node.kind === "task") {
            assert.equal(view.shape.kind, "task");
            if (view.shape.kind !== "task") throw new Error("task view mismatch");
            assert.deepEqual(view.shape.condition, node.when);
            assert.equal(view.shape.replay, node.replay);
            if (node.when !== undefined) conditional += 1;
          }
          if (node.kind === "transaction") {
            transactions += 1;
            assert.equal(view.shape.kind, "transaction");
            if (view.shape.kind !== "transaction") throw new Error("transaction view mismatch");
            assert.equal(view.shape.dryRun, node.dryRun);
          }
        }
        for (const source of [served.sources.descriptor, served.sources.module, ...served.nodes.flatMap(n => n.tasks.flatMap(t => [t.contractSource, t.implSource]))]) {
          assert.equal(source.state, "resolved");
          if (source.state === "resolved") assert.ok(existsSync(join(EXPLORER_SOURCE_ROOT, source.path)), source.path);
        }
        for (const scenario of served.scenarios) {
          assert.equal(scenario.source.state, "unresolved");
          if (scenario.source.state !== "unresolved") throw new Error("scenario source must remain absent");
          assert.ok(scenario.source.reason.length > 0);
        }
        for (const task of served.nodes.flatMap(n => n.tasks)) {
          assert.deepEqual(task.ui.map(link => link.catalogId).sort(), uiTaskLinks
            .filter(link => link.taskUses.includes(task.taskId)).map(link => link.id).sort());
        }
      }
      assert.ok(conditional > 0 && transactions > 0, "must exercise actual conditional and transaction nodes");
      untouched(f);
    } finally { f.dispose(); }
  });

  it("distinguishes an empty registry and an unregistered target from an impossible zero-node workflow", () => {
    const f = explorerAuthorityFixture();
    try {
      const query = explorerQueryDeps(f.clock, FingerprintSchema.parse("b".repeat(64)));
      assert.deepEqual(buildWorkflowExplorer({ ...query, modules: [] }).workflows, []);
      assert.equal(f.service.validate({ ...draft(f), workflowId: "unregistered-workflow" }).state, "refused");
      assert.equal(ExplorerWorkflowWireSchema.safeParse({ ...f.read().workflows[0], nodes: [] }).success, false);
      untouched(f);
      validControl(f);
    } finally { f.dispose(); }
  });

  it("refuses manifest source drift before effects, then accepts the unchanged registered control", () => {
    const f = explorerAuthorityFixture();
    try {
      const query = explorerQueryDeps(f.clock, FingerprintSchema.parse("b".repeat(64)));
      const broken = { ...query, buildManifest: { ...GENERATED_BUILD_MANIFEST, workflows: GENERATED_BUILD_MANIFEST.workflows.map(w => ({ ...w, sources: [{ path: "src/missing-workflow.ts" }] })) } };
      const projected = buildWorkflowExplorer(broken);
      assert.ok(projected.workflows.some(w => w.sources.descriptor.state === "unresolved"));
      const service = createExplorerEditService({ explorer: broken, overrides: f.database.authority.explorerOverrides });
      assert.throws(() => service.validate(draft(f)), /compile attestation.*source.*unresolved/u);
      untouched(f);
      validControl(f);
    } finally { f.dispose(); }
  });

  it("refuses served scenario registration drift before effects while accepting absent physical scenario sources", () => {
    const f = explorerAuthorityFixture();
    try {
      const query = explorerQueryDeps(f.clock, FingerprintSchema.parse("b".repeat(64)));
      const workflow = buildWorkflowExplorer(query).workflows.find(w => w.id === f.descriptor.id);
      assert.ok(workflow);
      assert.doesNotThrow(() => buildExplorerCompileAttestation(query, workflow));
      assert.throws(() => buildExplorerCompileAttestation(query, { ...workflow, scenarios: [] }), /served scenario registrations differ/u);
      untouched(f);
      validControl(f);
    } finally { f.dispose(); }
  });

  it.each(["graph", "selector", "schema", "timeline-label", "notification-preferences"])("rejects forbidden %s drafts and commands without successful records", kind => {
    const f = explorerAuthorityFixture();
    try {
      const changes = [{ kind, value: "unapproved" }];
      assert.throws(() => f.service.validate(draft(f, changes)));
      assert.throws(() => f.kernel.execute({ ...f.command(FIRST), payload: { changes } }));
      untouched(f);
      validControl(f);
    } finally { f.dispose(); }
  });

  it.each([
    { changes: [{ kind: "workflow-label", value: "Person Lookup" }], category: "empty-diff" },
    { changes: [{ kind: "enqueue-policy", value: "reject-active" }], category: "empty-diff" },
    { changes: [{ kind: "workflow-label", value: "People search" }, { kind: "enqueue-policy", value: "allow-parallel" }], category: "mixed-apply-levels" },
    { changes: [{ kind: "enqueue-policy", value: "reject-active" }, { kind: "edit-data-fields", fields: [SOURCE_FIELD] }], category: "partial-no-op" },
    { changes: [{ kind: "edit-data-fields", fields: [{ ...SOURCE_FIELD, fieldPath: "not.allowlisted" }] }], category: "edit-data-field-allowlist" },
  ])("refuses $category without effects and preserves a reachable valid command", ({ changes, category }) => {
    const f = explorerAuthorityFixture();
    try {
      const result = f.service.validate(draft(f, changes));
      assert.equal(result.state, "refused");
      if (result.state !== "refused") throw new Error("invalid draft admitted");
      assert.equal(result.category, category);
      assert.equal(f.kernel.execute({ ...f.command(FIRST), payload: { changes } }).state, "rejected");
      untouched(f);
      validControl(f);
    } finally { f.dispose(); }
  });

  it.each([[{ kind: "enqueue-policy", value: "allow-parallel" }], [{ kind: "edit-data-fields", fields: [SOURCE_FIELD] }]])(
    "provides a complete source brief with held bases and required future checks: %j", change => {
      const f = explorerAuthorityFixture();
      try {
        const requested = draft(f, [change]);
        const result = f.service.validate(requested);
        assert.equal(result.state, "code-change-required");
        if (result.state !== "code-change-required") throw new Error("source control refused");
        const brief = ExplorerCodeChangeBriefSchema.parse(result.brief);
        assert.deepEqual(JSON.parse(brief.patch.canonicalDescriptorJson), { patchVersion: 1, workflowId: f.descriptor.id,
          baseDescriptorVersion: f.descriptor.version, baseContractFingerprint: f.descriptor.contractFingerprint, changes: [change] });
        assert.deepEqual(brief.requiredFiles, ["src/workflows/person-lookup/workflow.ts"]);
        assert.deepEqual(brief.impacts.sourceFiles, brief.requiredFiles);
        assert.deepEqual(brief.impacts.tasks, brief.baseAttestation.checks.schema.tasks.map(t => t.taskId));
        assert.deepEqual(brief.impacts.scenarios, brief.baseAttestation.checks.scenario.registrations.map(s => s.scenarioId));
        assert.ok(brief.impacts.tasks.length > 0 && brief.impacts.scenarios.length > 0);
        assert.equal(brief.nextDescriptor.version, f.descriptor.version + 1);
        assert.deepEqual(brief.nextDescriptor.contractFingerprint, { state: "must-change", current: f.descriptor.contractFingerprint });
        assert.deepEqual(Object.values(brief.baseAttestation.checks).map(c => c.state), Array(5).fill("held"));
        assert.deepEqual(brief.requiredChecks, ["builder", "schema", "graph", "guard", "scenario"].map(check => ({ check, state: "required" })));
        assert.deepEqual(brief.semanticDiff.policies, brief.patch.typescript.operations.map(op => ({ path: op.propertyPath, before: change.kind === "enqueue-policy" ? JSON.parse(op.beforeExpression) as string : op.beforeExpression, after: change.kind === "enqueue-policy" ? JSON.parse(op.afterExpression) as string : op.afterExpression })));
        assert.deepEqual(brief.semanticDiff.edges, { added: [], removed: [], changed: [] });
        assert.equal(f.kernel.execute({ ...f.command(FIRST), payload: { changes: [change] } }).state, "rejected");
        untouched(f);
        validControl(f);
      } finally { f.dispose(); }
    },
  );

  it("refuses all stale bases, replays exactly and restores appearance at a new revision after reopening SQLite", () => {
    const f = explorerAuthorityFixture();
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
    } finally { f.dispose(); }
  });
});
