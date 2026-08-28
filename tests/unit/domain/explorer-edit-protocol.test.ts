import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ExplorerEditDraftSchema } from "../../../src/domain/dashboard/explorer.js";

const BASE_DRAFT = {
  draftVersion: 1,
  workflowId: "person-lookup",
  baseDescriptorVersion: 1,
  baseContractFingerprint: "a".repeat(64),
  baseOverrideRevision: 0,
} as const;

describe("Explorer safe-edit protocol", () => {
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
        { kind: "timeline-category-label", categoryKey: "lookup", value: "Lookup" },
        { kind: "timeline-category-order", categoryKeys: ["lookup", "verify"] },
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
      "timeline-category-label",
      "timeline-category-order",
      "enqueue-policy",
      "edit-data-fields",
    ]);
  });
});
