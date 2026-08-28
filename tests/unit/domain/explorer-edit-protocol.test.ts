import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ExplorerEditApplyRequestSchema,
  ExplorerEditDraftSchema,
} from "../../../src/domain/dashboard/explorer-edit.js";

const BASE_DRAFT = {
  draftVersion: 1,
  workflowId: "person-lookup",
  baseDescriptorVersion: 1,
  baseContractFingerprint: "a".repeat(64),
  baseOverrideRevision: 0,
} as const;

describe("Explorer safe-edit protocol", () => {
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
