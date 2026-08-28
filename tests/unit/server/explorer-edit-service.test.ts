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
      replace: () => {
        throw new Error("validation must not write an override");
      },
    },
  });
}

describe("Explorer edit service", () => {
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
    assert.ok(result.brief.requiredFiles.includes("src/workflows/person-lookup/descriptor.ts" as never));
    assert.equal(result.brief.descriptorVersionRequired, descriptor.version + 1);
  });
});
