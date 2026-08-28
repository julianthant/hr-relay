import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  deriveExplorerAppliedRecordFingerprint,
  deriveExplorerEditFingerprint,
  ExplorerAppliedOverrideSchema,
  ExplorerEditApplyRequestSchema,
  ExplorerEditDraftSchema,
  ExplorerEditReviewTokenRecordSchema,
} from "../../../src/domain/dashboard/explorer-edit.js";

const BASE_DRAFT = {
  draftVersion: 1,
  workflowId: "person-lookup",
  baseDescriptorVersion: 1,
  baseContractFingerprint: "a".repeat(64),
  baseOverrideRevision: 0,
} as const;

describe("Explorer safe-edit protocol", () => {
  it("requires exact issued and consumed review-token evidence shapes", () => {
    const draft = ExplorerEditDraftSchema.parse({
      ...BASE_DRAFT,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });
    const base = {
      recordVersion: 1,
      draftFingerprint: deriveExplorerEditFingerprint(draft),
      issuedAt: "2026-08-28T15:30:00.000Z",
      expiresAt: "2026-08-28T15:40:00.000Z",
      requestedBy: "local-operator",
      source: "explorer",
      draft,
    } as const;
    const asymmetricRecords = [
      { reviewTokenId: "aaaaaaaa-0001-4000-8000-000000000001", state: "issued", consumedAt: base.issuedAt },
      {
        reviewTokenId: "aaaaaaaa-0002-4000-8000-000000000002",
        state: "issued",
        consumedBy: "11111111-1111-4111-8111-111111111111",
      },
      {
        reviewTokenId: "aaaaaaaa-0003-4000-8000-000000000003",
        state: "consumed",
        consumedBy: "11111111-1111-4111-8111-111111111111",
      },
      { reviewTokenId: "aaaaaaaa-0004-4000-8000-000000000004", state: "consumed", consumedAt: base.issuedAt },
    ] as const;

    for (const record of asymmetricRecords) {
      assert.equal(ExplorerEditReviewTokenRecordSchema.safeParse({ ...base, ...record }).success, false);
    }
  });

  it("binds an applied override's compiled fingerprint to its exact draft identity", () => {
    const draft = ExplorerEditDraftSchema.parse({
      ...BASE_DRAFT,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });
    const malformedContent = {
      recordVersion: 1,
      workflowId: draft.workflowId,
      revision: 1,
      baseDescriptorVersion: draft.baseDescriptorVersion,
      baseContractFingerprint: draft.baseContractFingerprint,
      compiledFingerprint: "b".repeat(64),
      changes: draft.changes,
      commandId: "11111111-1111-4111-8111-111111111111",
      appliedAt: "2026-08-28T15:30:00.000Z",
    } as const;
    assert.notEqual(malformedContent.compiledFingerprint, deriveExplorerEditFingerprint(draft));

    const parsed = ExplorerAppliedOverrideSchema.safeParse({
      ...malformedContent,
      recordFingerprint: deriveExplorerAppliedRecordFingerprint(malformedContent),
    });

    assert.equal(parsed.success, false);
    assert.match(JSON.stringify(parsed.error?.issues), /compiled fingerprint mismatch/u);
  });

  it("binds an applied override's record fingerprint to every persisted field", () => {
    const draft = ExplorerEditDraftSchema.parse({
      ...BASE_DRAFT,
      changes: [{ kind: "workflow-label", value: "People search" }],
    });
    const content = {
      recordVersion: 1,
      workflowId: draft.workflowId,
      revision: 1,
      baseDescriptorVersion: draft.baseDescriptorVersion,
      baseContractFingerprint: draft.baseContractFingerprint,
      compiledFingerprint: deriveExplorerEditFingerprint(draft),
      changes: draft.changes,
      commandId: "11111111-1111-4111-8111-111111111111",
      appliedAt: "2026-08-28T15:30:00.000Z",
    } as const;
    const malformedFingerprint = "b".repeat(64);
    assert.notEqual(malformedFingerprint, deriveExplorerAppliedRecordFingerprint(content));

    const parsed = ExplorerAppliedOverrideSchema.safeParse({
      ...content,
      recordFingerprint: malformedFingerprint,
    });

    assert.equal(parsed.success, false);
    assert.match(JSON.stringify(parsed.error?.issues), /record fingerprint mismatch/u);
  });

  it("requires the fingerprint of the exact draft the operator reviewed", () => {
    const parsed = ExplorerEditApplyRequestSchema.safeParse({
      commandVersion: 1,
      commandId: "11111111-1111-4111-8111-111111111111",
      draft: {
        ...BASE_DRAFT,
        changes: [{ kind: "workflow-label", value: "People search" }],
      },
    });

    assert.equal(parsed.success, false);
  });

  it("accepts the complete closed presentation, notification, policy and Edit Data subset", () => {
    const parsed = ExplorerEditDraftSchema.parse({
      ...BASE_DRAFT,
      changes: [
        { kind: "workflow-label", value: "People search" },
        { kind: "workflow-icon", value: "Search" },
        { kind: "workflow-category", value: "search" },
        { kind: "timeline-category-label", categoryKey: "lookup", value: "Lookup" },
        { kind: "timeline-category-order", categoryKeys: ["lookup", "verify"] },
        { kind: "notification-preference", trigger: "failed", enabled: false },
        { kind: "enqueue-policy", value: "reject-active" },
        {
          kind: "edit-data-fields",
          fields: [{ nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" }],
        },
      ],
    });

    assert.deepEqual(parsed.changes.map(({ kind }) => kind), [
      "workflow-label",
      "workflow-icon",
      "workflow-category",
      "timeline-category-label",
      "timeline-category-order",
      "notification-preference",
      "enqueue-policy",
      "edit-data-fields",
    ]);
  });

  it("refuses executable, selector, secret, graph and arbitrary descriptor values at the strict boundary", () => {
    for (const changes of [
      [{ kind: "javascript", value: "return true" }],
      [{ kind: "selector", value: "#submit" }],
      [{ kind: "secret", value: "password" }],
      [{ kind: "graph", nodes: [] }],
      [{ kind: "workflow-label", value: "People", arbitrary: true }],
    ]) {
      assert.equal(ExplorerEditDraftSchema.safeParse({ ...BASE_DRAFT, changes }).success, false);
    }
  });

  it("requires an exact command envelope and rejects duplicate change ownership", () => {
    const duplicate = ExplorerEditApplyRequestSchema.safeParse({
      commandVersion: 1,
      commandId: "11111111-1111-4111-8111-111111111111",
      reviewedFingerprint: "b".repeat(64),
      draft: {
        ...BASE_DRAFT,
        changes: [
          { kind: "workflow-label", value: "People" },
          { kind: "workflow-label", value: "Persons" },
        ],
      },
    });

    assert.equal(duplicate.success, false);
    assert.match(JSON.stringify(duplicate.error?.issues), /change target must be unique/u);
  });
});
