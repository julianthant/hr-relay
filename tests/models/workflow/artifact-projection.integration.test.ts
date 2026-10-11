
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { deriveArtifactProjectionRows } from "../../../src/models/workflow/artifact-projection.js";

const artifactReadiness: Promise<void>[] = [];
const disposers: (() => void)[] = [];
afterEach(async () => {
  await Promise.all(artifactReadiness.splice(0));
  for (const dispose of disposers.splice(0)) dispose();
});

const PROJECTION_SPECS = [{
  id: "retention-row",
  source: { nodeId: "extract", fieldPath: "disposition" },
  keyFields: ["subject"],
  sink: "xlsx-retention",
  blocking: true,
}] as const;

const OUTPUT_VALUE = { subject: "10456712", eid: "10456712", disposition: "retain" };

/* ── 1. derivation ───────────────────────────────────────────────────────── */

describe("deriveArtifactProjectionRows", () => {
  it("derives one stable-keyed row, identically on every derivation", () => {
    const first = deriveArtifactProjectionRows({ specs: PROJECTION_SPECS, nodeId: "extract", outputValue: OUTPUT_VALUE });
    const second = deriveArtifactProjectionRows({ specs: PROJECTION_SPECS, nodeId: "extract", outputValue: OUTPUT_VALUE });
    assert.equal(first.length, 1);
    assert.deepEqual(first, second);
    assert.equal(first[0]?.value, "retain");
    assert.deepEqual(first[0]?.keyValues, [{ field: "subject", value: "10456712" }]);
  });

  it("skips specs sourced from other nodes", () => {
    assert.deepEqual(
      deriveArtifactProjectionRows({ specs: PROJECTION_SPECS, nodeId: "other", outputValue: OUTPUT_VALUE }),
      [],
    );
  });

  it("throws by name when the projected field is absent", () => {
    assert.throws(
      () => deriveArtifactProjectionRows({ specs: PROJECTION_SPECS, nodeId: "extract", outputValue: { subject: "x" } }),
      /found no value at disposition/u,
    );
  });

  it("throws by name when a declared key value is missing", () => {
    assert.throws(
      () => deriveArtifactProjectionRows({
        specs: PROJECTION_SPECS,
        nodeId: "extract",
        outputValue: { disposition: "retain" },
      }),
      /missing its declared key value at subject/u,
    );
  });
});
