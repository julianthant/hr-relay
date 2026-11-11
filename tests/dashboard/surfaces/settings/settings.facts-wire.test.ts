import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SettingsFactsWireSchema } from "../../../../src/models/dashboard/settings.js";

describe("System hosts wire compatibility", () => {
  it("still refuses a facts wire that omits system hosts", () => {
    assert.throws(() => SettingsFactsWireSchema.parse({
      systemHosts: [],
      workflowCapabilities: [],
    }));
  });
});
