import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { createExplorerEditService } from "../../../src/server/dashboard/commands/explorer-edit-service.js";
import { explorerQueryDeps } from "../../fixtures/explorer-seams.js";

const CLOCK = manualClock(new Date("2026-08-28T12:00:00.000Z"));
const HASH = FingerprintSchema.parse("b".repeat(64));
function service() {
  const query = explorerQueryDeps(CLOCK, HASH);
  return createExplorerEditService({
    explorer: query,
    overrides: {
      read: () => undefined,
      readAll: () => [],
    },
  });
}

describe("Explorer edit service", () => {
  it("attests every registered workflow through the same live validation seam", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const edit = service();
    for (const descriptor of query.modules.map(({ descriptor }) => descriptor)) {
      const result = edit.validate({
        draftVersion: 1,
        workflowId: descriptor.id,
        baseDescriptorVersion: descriptor.version,
        baseContractFingerprint: descriptor.contractFingerprint,
        baseOverrideRevision: 0,
        changes: [{ kind: "workflow-label", value: `${descriptor.label} reviewed` }],
      });
      assert.equal(result.state, "ready-to-apply", String(descriptor.id));
      if (result.state !== "ready-to-apply") continue;
      assert.equal(result.compileAttestation.workflowId, descriptor.id);
      assert.deepEqual(
        Object.values(result.compileAttestation.checks).map(({ state }) => state),
        ["held", "held", "held", "held", "held"],
      );
    }
  });

  it("validates a presentation draft against the exact live descriptor", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);

    const result = service().validate({
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });

    assert.equal(result.state, "ready-to-apply");
    if (result.state !== "ready-to-apply") return;
    assert.equal(result.override.presentation.label, "People search");
    assert.deepEqual(result.semanticDiff, [
      { path: "presentation.label", before: "Person Lookup", after: "People search" },
    ]);
    assert.equal(result.compileAttestation.workflowId, descriptor.id);
    assert.equal(result.compileAttestation.descriptorVersion, descriptor.version);
    assert.equal(result.compileAttestation.contractFingerprint, descriptor.contractFingerprint);
    assert.deepEqual(
      Object.values(result.compileAttestation.checks).map(({ state }) => state),
      ["held", "held", "held", "held", "held"],
    );
    assert.deepEqual(
      result.compileAttestation.checks.scenario.registrations.map(({ scenarioId }) => scenarioId),
      [...result.impactedScenarios],
    );
  });

  it("turns an operational policy edit with no descriptor allowlist into a reviewed code-change brief", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);

    const result = service().validate({
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "enqueue-policy", value: "allow-parallel" }],
    });

    assert.equal(result.state, "code-change-required");
    if (result.state !== "code-change-required") return;
    assert.match(result.brief.reason, /no descriptor-declared allowlist/u);
    assert.ok(result.brief.requiredFiles.includes("src/workflows/person-lookup/workflow.ts" as never));
    assert.equal(result.brief.nextDescriptor.version, descriptor.version + 1);
    assert.deepEqual(result.brief.nextDescriptor.contractFingerprint, {
      state: "must-change",
      current: descriptor.contractFingerprint,
    });
    assert.equal(
      result.brief.patch.canonicalDescriptorJson,
      JSON.stringify({
        baseContractFingerprint: descriptor.contractFingerprint,
        baseDescriptorVersion: descriptor.version,
        changes: [{ kind: "enqueue-policy", value: "allow-parallel" }],
        patchVersion: 1,
        workflowId: descriptor.id,
      }),
    );
    assert.deepEqual(result.brief.patch.typescript.operations, [{
      propertyPath: "enqueue",
      beforeExpression: '"reject-active"',
      afterExpression: '"allow-parallel"',
    }]);
    assert.deepEqual(result.brief.semanticDiff.policies, [{
      path: "enqueue",
      before: "reject-active",
      after: "allow-parallel",
    }]);
    assert.deepEqual(result.brief.semanticDiff.nodes, { added: [], removed: [], changed: [] });
    assert.deepEqual(result.brief.semanticDiff.edges, { added: [], removed: [], changed: [] });
    assert.deepEqual(result.brief.semanticDiff.effects, { added: [], removed: [] });
    assert.deepEqual(result.brief.semanticDiff.uiIds, { added: [], removed: [] });
    assert.deepEqual(result.brief.impacts.workflows, [descriptor.id]);
    assert.deepEqual(result.brief.impacts.tasks, result.brief.baseAttestation.checks.schema.tasks.map(({ taskId }) => taskId));
    assert.deepEqual(result.brief.impacts.scenarios, result.brief.baseAttestation.checks.scenario.registrations.map(({ scenarioId }) => scenarioId));
    assert.deepEqual(
      result.brief.requiredChecks.map(({ check, state }) => [check, state]),
      [
        ["builder", "required"],
        ["schema", "required"],
        ["graph", "required"],
        ["guard", "required"],
        ["scenario", "required"],
      ],
    );
  });

  it("emits an exact Edit Data source patch and refuses a mixed apply level", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const base = {
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
    } as const;

    const brief = service().validate({
      ...base,
      changes: [{
        kind: "edit-data-fields",
        fields: [{ nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" }],
      }],
    });
    assert.equal(brief.state, "code-change-required");
    if (brief.state !== "code-change-required") return;
    assert.equal(brief.brief.patch.typescript.operations[0]?.propertyPath, "capabilities.editData.fields");
    assert.deepEqual(brief.brief.semanticDiff.nodes.changed, ["crm-dates"]);
    assert.deepEqual(brief.brief.semanticDiff.policies, [{
      path: "capabilities.editData.fields",
      before: JSON.stringify([
        { fieldPath: "invitedOn.value", label: "Invited on", nodeId: "crm-dates" },
        { fieldPath: "startsOn.value", label: "Starts on", nodeId: "crm-dates" },
        { fieldPath: "completedOn.value", label: "Completed on", nodeId: "crm-dates" },
      ]),
      after: JSON.stringify([{ fieldPath: "startsOn.value", label: "Starts on", nodeId: "crm-dates" }]),
    }]);

    const mixed = service().validate({
      ...base,
      changes: [
        { kind: "workflow-label", value: "People search" },
        { kind: "enqueue-policy", value: "allow-parallel" },
      ],
    });
    assert.equal(mixed.state, "refused");
    if (mixed.state === "refused") assert.equal(mixed.category, "mixed-apply-levels");

    const noOp = service().validate({
      ...base,
      changes: [{ kind: "enqueue-policy", value: "reject-active" }],
    });
    assert.equal(noOp.state, "refused");
    if (noOp.state === "refused") assert.equal(noOp.category, "empty-diff");
  });

  it("refuses a source draft that mixes a no-op with an effective change", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);

    const result = service().validate({
      draftVersion: 1,
      workflowId: descriptor.id,
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [
        { kind: "enqueue-policy", value: "reject-active" },
        {
          kind: "edit-data-fields",
          fields: [{ nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" }],
        },
      ],
    });

    assert.equal(result.state, "refused");
    if (result.state !== "refused") return;
    assert.equal(result.category, "partial-no-op");
    assert.match(result.message, /enqueue-policy.*no effective source change/u);
  });

  it("fails validation when exact scenario source attestation cannot be made", () => {
    const query = explorerQueryDeps(CLOCK, HASH);
    const descriptor = query.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const edit = createExplorerEditService({
      explorer: { ...query, listScenarioSources: () => [] },
      overrides: {
        read: () => undefined,
        readAll: () => [],
      },
    });
    assert.throws(() => edit.validate({
      draftVersion: 1,
      workflowId: descriptor.id,
      baseDescriptorVersion: descriptor.version,
      baseContractFingerprint: descriptor.contractFingerprint,
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People search" }],
    }), /compile attestation.*scenario.*unresolved/u);
  });


});
