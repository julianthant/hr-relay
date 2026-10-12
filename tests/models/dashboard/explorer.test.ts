import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
ExplorerCodeChangeBriefSchema,
ExplorerCompileAttestationSchema,
ExplorerDescriptorPatchSchema,
ExplorerEditApplyRequestSchema,
ExplorerEditDraftSchema,
} from "../../../src/models/dashboard/explorer.js";

const BASE_DRAFT = {
  draftVersion: 1,
  workflowId: "person-lookup",
  baseDescriptorVersion: 1,
  baseContractFingerprint: "a".repeat(64),
  baseOverrideRevision: 0,
} as const;

const TWO_CHANGE_PATCH = {
  patchVersion: 1,
  workflowId: "person-lookup",
  baseDescriptorVersion: 1,
  baseContractFingerprint: "a".repeat(64),
  changes: [
    { kind: "enqueue-policy", value: "allow-parallel" },
    {
      kind: "edit-data-fields",
      fields: [{ nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" }],
    },
  ],
  canonicalDescriptorJson: JSON.stringify({
    baseContractFingerprint: "a".repeat(64),
    baseDescriptorVersion: 1,
    changes: [
      { kind: "enqueue-policy", value: "allow-parallel" },
      {
        fields: [{ fieldPath: "startsOn.value", label: "Starts on", nodeId: "crm-dates" }],
        kind: "edit-data-fields",
      },
    ],
    patchVersion: 1,
    workflowId: "person-lookup",
  }),
  typescript: {
    sourcePath: "src/workflows/person-lookup/descriptor.ts",
    operations: [
      {
        propertyPath: "enqueue",
        beforeExpression: '"reject-active"',
        afterExpression: '"allow-parallel"',
      },
      {
        propertyPath: "capabilities.editData.fields",
        beforeExpression: "[{\"fieldPath\":\"invitedOn.value\",\"label\":\"Invited on\",\"nodeId\":\"crm-dates\"}]",
        afterExpression: "[{\"fieldPath\":\"startsOn.value\",\"label\":\"Starts on\",\"nodeId\":\"crm-dates\"}]",
      },
    ],
  },
} as const;

const COMPILE_ATTESTATION = {
  attestationVersion: 2,
  workflowId: "person-lookup",
  descriptorVersion: 1,
  contractFingerprint: "a".repeat(64),
  checks: {
    builder: { state: "held", factory: "defineWorkflowDescriptor" },
    schema: {
      state: "held",
      inputSchemaHash: "b".repeat(64),
      canonicalInputSchemaHash: "c".repeat(64),
      resultSchemaHash: "d".repeat(64),
      tasks: [{ taskId: "workflow:person-lookup/read", inputSchemaHash: "e".repeat(64), outputSchemaHash: "f".repeat(64) }],
    },
    graph: { state: "held", nodeIds: ["read"], edgeFingerprint: "1".repeat(64), coveragePointIds: [] },
    guard: {
      state: "held",
      name: "workflow-editor-compile-integrity",
      scope: "runtime-registry-round-trip",
      descriptorSetHash: "2".repeat(64),
    },
    scenario: {
      state: "held",
      scope: "registered-declaration-equivalence",
      registrations: [{ scenarioId: "person-lookup/found" }],
    },
  },
} as const;

const ENQUEUE_CODE_CHANGE_BRIEF = {
  workflowId: "person-lookup",
  reason: "policy remains reviewed source authority",
  requiredFiles: ["src/workflows/person-lookup/descriptor.ts"],
  failedObligations: ["run the complete source-authored validation family"],
  baseAttestation: COMPILE_ATTESTATION,
  patch: {
    patchVersion: 1,
    workflowId: "person-lookup",
    baseDescriptorVersion: 1,
    baseContractFingerprint: "a".repeat(64),
    changes: [{ kind: "enqueue-policy", value: "allow-parallel" }],
    canonicalDescriptorJson: JSON.stringify({
      baseContractFingerprint: "a".repeat(64),
      baseDescriptorVersion: 1,
      changes: [{ kind: "enqueue-policy", value: "allow-parallel" }],
      patchVersion: 1,
      workflowId: "person-lookup",
    }),
    typescript: {
      sourcePath: "src/workflows/person-lookup/descriptor.ts",
      operations: [{
        propertyPath: "enqueue",
        beforeExpression: '"reject-active"',
        afterExpression: '"allow-parallel"',
      }],
    },
  },
  semanticDiff: {
    presentation: [],
    nodes: { added: [], removed: [], changed: [] },
    edges: { added: [], removed: [], changed: [] },
    effects: { added: [], removed: [] },
    policies: [{ path: "enqueue", before: "reject-active", after: "allow-parallel" }],
    uiIds: { added: [], removed: [] },
    evidenceObligations: ["builder", "schema", "graph", "guard", "scenario"],
  },
  impacts: {
    workflows: ["person-lookup"],
    tasks: ["workflow:person-lookup/read"],
    scenarios: ["person-lookup/found"],
    sourceFiles: ["src/workflows/person-lookup/descriptor.ts"],
  },
  nextDescriptor: {
    version: 2,
    contractFingerprint: { state: "must-change", current: "a".repeat(64) },
  },
  requiredChecks: [
    { check: "builder", state: "required" },
    { check: "schema", state: "required" },
    { check: "graph", state: "required" },
    { check: "guard", state: "required" },
    { check: "scenario", state: "required" },
  ],
} as const;

describe("Explorer safe-edit protocol", () => {
  it("binds apply to the complete strict command envelope", () => {
    const parsed = ExplorerEditApplyRequestSchema.parse({
      commandId: "11111111-1111-4111-8111-111111111111",
      requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator",
      source: "dashboard",
      reason: "Apply the reviewed presentation label",
      family: "explorer",
      type: "apply-explorer-edit",
      target: {
        workflowId: "person-lookup",
        expectedVersion: 1,
        contractFingerprint: "a".repeat(64),
        expectedOverrideRevision: 0,
      },
      payload: { changes: [{ kind: "workflow-label", value: "People search" }] },
    });

    assert.equal(parsed.requestedBy, "local-operator");
    assert.equal(parsed.reason, "Apply the reviewed presentation label");
    assert.equal(parsed.target.expectedOverrideRevision, 0);
    assert.equal("draft" in parsed, false);
  });

  it("accepts a presentation draft only when it carries the exact descriptor and override bases", () => {
    const parsed = ExplorerEditDraftSchema.parse({
      ...BASE_DRAFT,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });

    assert.deepEqual(parsed, {
      ...BASE_DRAFT,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });
  });

  it("admits only the closed source-owned presentation, policy and Edit Data change kinds", () => {
    const parsed = ExplorerEditDraftSchema.parse({
      ...BASE_DRAFT,
      changes: [
        { kind: "workflow-icon", value: "Search" },
        { kind: "workflow-category", value: "search" },
        { kind: "enqueue-policy", value: "reject-active" },
        {
          kind: "edit-data-fields",
          fields: [{ nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" }],
        },
      ],
    });

    assert.deepEqual(parsed.changes.map(({ kind }) => kind), [
      "workflow-icon",
      "workflow-category",
      "enqueue-policy",
      "edit-data-fields",
    ]);
  });

  it("refuses executable code, selectors, proof fields, secrets, arbitrary policy values and new-workflow fields", () => {
    for (const change of [
      { kind: "javascript", source: "return true" },
      { kind: "selector", value: "#submit" },
      { kind: "proof-schema", value: {} },
      { kind: "secret", value: "credential" },
      { kind: "enqueue-policy", value: "whatever" },
      { kind: "new-workflow", workflowId: "invented" },
      { kind: "timeline-category-label", categoryKey: "lookup", value: "Lookup" },
      { kind: "timeline-category-order", categoryKeys: ["lookup", "verify"] },
    ]) {
      assert.equal(ExplorerEditDraftSchema.safeParse({ ...BASE_DRAFT, changes: [change] }).success, false);
    }
    assert.equal(ExplorerEditDraftSchema.safeParse({
      ...BASE_DRAFT,
      changes: [{ kind: "workflow-label", value: "People search", selector: "#submit" }],
    }).success, false);
  });

  it("rejects a trailing TypeScript operation with no reviewed patch change", () => {
    assert.equal(ExplorerDescriptorPatchSchema.safeParse({
      ...TWO_CHANGE_PATCH,
      typescript: {
        ...TWO_CHANGE_PATCH.typescript,
        operations: [
          ...TWO_CHANGE_PATCH.typescript.operations,
          TWO_CHANGE_PATCH.typescript.operations[0],
        ],
      },
    }).success, false);
  });

  it("rejects a reviewed patch change with no TypeScript operation", () => {
    assert.equal(ExplorerDescriptorPatchSchema.safeParse({
      ...TWO_CHANGE_PATCH,
      typescript: {
        ...TWO_CHANGE_PATCH.typescript,
        operations: [TWO_CHANGE_PATCH.typescript.operations[0]],
      },
    }).success, false);
  });

  it("rejects TypeScript operations reordered away from reviewed patch changes", () => {
    assert.equal(ExplorerDescriptorPatchSchema.safeParse({
      ...TWO_CHANGE_PATCH,
      typescript: {
        ...TWO_CHANGE_PATCH.typescript,
        operations: [...TWO_CHANGE_PATCH.typescript.operations].reverse(),
      },
    }).success, false);
  });

  it("requires all five exact compile-attestation arms and a canonical closed source patch", () => {
    const attestation = COMPILE_ATTESTATION;
    assert.equal(ExplorerCompileAttestationSchema.safeParse(attestation).success, true);
    assert.equal(ExplorerCompileAttestationSchema.safeParse({
      ...attestation,
      checks: { ...attestation.checks, scenario: undefined },
    }).success, false);
    assert.equal(ExplorerCompileAttestationSchema.safeParse({
      ...attestation,
      checks: {
        ...attestation.checks,
        scenario: {
          ...attestation.checks.scenario,
          registrations: [{ ...attestation.checks.scenario.registrations[0], sourcePath: "tests/scenario/person-lookup.scenario.test.ts" }],
        },
      },
    }).success, false);
    assert.equal(ExplorerCompileAttestationSchema.safeParse({
      ...attestation,
      checks: {
        ...attestation.checks,
        scenario: {
          ...attestation.checks.scenario,
          registrations: [...attestation.checks.scenario.registrations, ...attestation.checks.scenario.registrations],
        },
      },
    }).success, false);

    const brief = ENQUEUE_CODE_CHANGE_BRIEF;
    assert.equal(ExplorerCodeChangeBriefSchema.parse(brief).patch.canonicalDescriptorJson, brief.patch.canonicalDescriptorJson);
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...brief,
      patch: { ...brief.patch, canonicalDescriptorJson: "{}" },
    }).success, false);
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...brief,
      nextDescriptor: { ...brief.nextDescriptor, version: 1 },
    }).success, false);
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...brief,
      patch: {
        ...brief.patch,
        typescript: {
          ...brief.patch.typescript,
          operations: [{
            ...brief.patch.typescript.operations[0],
            afterExpression: "process.exit(1)",
          }],
        },
      },
    }).success, false);
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...brief,
      patch: {
        ...brief.patch,
        typescript: {
          ...brief.patch.typescript,
          operations: [{
            ...brief.patch.typescript.operations[0],
            afterExpression: '"reject-active"',
          }],
        },
      },
    }).success, false);
  });

  it("rejects a semantic policy path that is not the reviewed TypeScript property", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        policies: [{ path: "capabilities.editData.fields", before: "reject-active", after: "allow-parallel" }],
      },
    }).success, false);
  });

  it("rejects a semantic policy before-value that is not the reviewed TypeScript expression", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        policies: [{ path: "enqueue", before: "allow-parallel", after: "allow-parallel" }],
      },
    }).success, false);
  });

  it("rejects a semantic policy after-value that is not the reviewed TypeScript expression", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        policies: [{ path: "enqueue", before: "reject-active", after: "reject-active" }],
      },
    }).success, false);
  });

  it("rejects a presentation diff from a source-only patch", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        presentation: [{ path: "presentation.label", before: "Person Lookup", after: "People search" }],
      },
    }).success, false);
  });

  it("rejects a node diff not derived from Edit Data patch expressions", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        nodes: { added: [], removed: [], changed: ["read"] },
      },
    }).success, false);
  });

  it("rejects an edge diff from a closed policy/Edit Data patch", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        edges: { added: ["read->write"], removed: [], changed: [] },
      },
    }).success, false);
  });

  it("rejects an effect diff from a closed policy/Edit Data patch", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        effects: { added: ["submit"], removed: [] },
      },
    }).success, false);
  });

  it("rejects a UI-id diff from a closed policy/Edit Data patch", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        uiIds: { added: ["ui.person-lookup.submit"], removed: [] },
      },
    }).success, false);
  });

  it("rejects a source operation whose reviewed before and after expressions are identical", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      patch: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.patch,
        typescript: {
          ...ENQUEUE_CODE_CHANGE_BRIEF.patch.typescript,
          operations: [{
            propertyPath: "enqueue",
            beforeExpression: '"allow-parallel"',
            afterExpression: '"allow-parallel"',
          }],
        },
      },
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        policies: [{ path: "enqueue", before: "allow-parallel", after: "allow-parallel" }],
      },
    }).success, false);
  });

  it("derives the exact changed-node set from Edit Data before/after expressions", () => {
    const beforeExpression = "[{\"fieldPath\":\"invitedOn.value\",\"label\":\"Invited on\",\"nodeId\":\"crm-dates\"}]";
    const afterExpression = "[{\"fieldPath\":\"startsOn.value\",\"label\":\"Starts on\",\"nodeId\":\"crm-dates\"}]";
    const brief = {
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      patch: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.patch,
        changes: [{
          kind: "edit-data-fields",
          fields: [{ nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" }],
        }],
        canonicalDescriptorJson: JSON.stringify({
          baseContractFingerprint: "a".repeat(64),
          baseDescriptorVersion: 1,
          changes: [{
            fields: [{ fieldPath: "startsOn.value", label: "Starts on", nodeId: "crm-dates" }],
            kind: "edit-data-fields",
          }],
          patchVersion: 1,
          workflowId: "person-lookup",
        }),
        typescript: {
          ...ENQUEUE_CODE_CHANGE_BRIEF.patch.typescript,
          operations: [{
            propertyPath: "capabilities.editData.fields",
            beforeExpression,
            afterExpression,
          }],
        },
      },
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        nodes: { added: [], removed: [], changed: ["crm-dates"] },
        policies: [{ path: "capabilities.editData.fields", before: beforeExpression, after: afterExpression }],
      },
    } as const;

    assert.equal(ExplorerCodeChangeBriefSchema.safeParse(brief).success, true);
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...brief,
      semanticDiff: {
        ...brief.semanticDiff,
        nodes: { added: [], removed: [], changed: [] },
      },
    }).success, false);
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...brief,
      semanticDiff: {
        ...brief.semanticDiff,
        nodes: { added: ["crm-dates"], removed: [], changed: ["crm-dates"] },
      },
    }).success, false);
  });

  it("rejects a mutated compile-evidence obligation arm", () => {
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({
      ...ENQUEUE_CODE_CHANGE_BRIEF,
      semanticDiff: {
        ...ENQUEUE_CODE_CHANGE_BRIEF.semanticDiff,
        evidenceObligations: ["builder", "schema", "graph", "guard", "builder"],
      },
    }).success, false);
  });
});
