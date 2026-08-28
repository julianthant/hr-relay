import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ExplorerCodeChangeBriefSchema,
  ExplorerCompileAttestationSchema,
  ExplorerEditApplyRequestSchema,
  ExplorerEditDraftSchema,
} from "../../../src/domain/dashboard/explorer.js";

const BASE_DRAFT = {
  draftVersion: 1,
  workflowId: "person-lookup",
  baseDescriptorVersion: 1,
  baseContractFingerprint: "a".repeat(64),
  baseOverrideRevision: 0,
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

  it("requires all five exact compile-attestation arms and a canonical closed source patch", () => {
    const attestation = {
      attestationVersion: 1,
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
          scope: "registered-source-resolution",
          registrations: [{ scenarioId: "person-lookup/found", sourcePath: "tests/scenario/person-lookup.scenario.test.ts" }],
        },
      },
    } as const;
    assert.equal(ExplorerCompileAttestationSchema.safeParse({
      ...attestation,
      checks: { ...attestation.checks, scenario: undefined },
    }).success, false);

    const brief = {
      workflowId: "person-lookup",
      reason: "policy remains reviewed source authority",
      requiredFiles: ["src/workflows/person-lookup/descriptor.ts"],
      failedObligations: ["run the complete source-authored validation family"],
      baseAttestation: attestation,
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
});
