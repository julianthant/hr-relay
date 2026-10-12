
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { DiagnosticBundleWireSchema } from "../../../src/models/dashboard/diagnostic-bundle.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("diagnostic bundle readback", () => {

  it("keeps the wire recursively strict and rejects impossible content dimensions", () => {
    const wire = {
      bundleId: "00000000-0000-4000-8000-000000000001",
      capturedAt: NOW,
      byteSize: 0,
      contentDigest: "a".repeat(64),
      redaction: { fields: [], warnings: [] },
      contents: [],
    };
    assert.equal(DiagnosticBundleWireSchema.safeParse({ ...wire, unexpected: true }).success, false);
    assert.equal(DiagnosticBundleWireSchema.safeParse({
      ...wire,
      contents: [{
        kind: "accessibility-excerpt",
        key: "Accessibility excerpt",
        detail: "text/yaml · 3 bytes · redacted",
        artifactId: "00000000-0000-4000-8000-000000000002",
        mediaType: "text/yaml",
        byteLength: 3,
        digest: "b".repeat(64),
        sensitivity: "redacted",
        width: 10,
      }],
    }).success, false);
  });
});
