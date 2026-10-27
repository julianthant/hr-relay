
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { ExplorerCodeChangeBriefSchema } from "../../../src/models/dashboard/explorer.js";
import { explorerAuthorityFixture } from "../../support/fixtures/explorer-authority.js";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
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

  it.each([[{ kind: "enqueue-policy", value: "allow-parallel" }], [{ kind: "edit-data-fields", fields: [SOURCE_FIELD] }]])(
    "provides a complete source brief with held bases and required future checks: %j", async change => {
      const f = await explorerAuthorityFixture();
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
      } finally { await f.dispose(); }
    },
  );
});
