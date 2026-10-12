import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { ScenarioManifestSchema } from "../../../src/models/trust/scenario.js";
const FINGERPRINT = "a".repeat(64);

const SCENARIO = {
  id: "preflight/browser-missing",
  title: "Missing browser asset blocks executor start",
  scope: { workflowId: "onboarding" },
  kind: "permanent",
  fixture: "fixtures/preflight/browser-missing.json",
  input: { requestedCapability: "executor.run" },
  injections: [{ kind: "task-failure", taskId: "ucpath/search-person", code: "BROWSER_MISSING", occurrence: 1 }],
  expect: {
    terminal: "failed",
    actionCount: 0,
    externalCommitCount: 0,
    requiredEvidence: ["preflight.browser-assets"],
    failureCode: { state: "present", value: "BROWSER_MISSING" },
  },
  contractFingerprint: FINGERPRINT,
  requiredAssertions: ["blocks-executor"],
};

describe("strict trust records", () => {

  it("validates scenario scope, closed injections, outcomes, and assertion identity", () => {
    assert.equal(ScenarioManifestSchema.safeParse(SCENARIO).success, true);
    assert.equal(ScenarioManifestSchema.safeParse({ ...SCENARIO, scope: { nodeId: "search-person" } }).success, false);
    assert.equal(ScenarioManifestSchema.safeParse({
      ...SCENARIO,
      injections: [{ ...SCENARIO.injections[0], fallback: true }],
    }).success, false);
    assert.equal(ScenarioManifestSchema.safeParse({
      ...SCENARIO,
      expect: { ...SCENARIO.expect, terminal: "verified-done" },
    }).success, false);
    assert.equal(ScenarioManifestSchema.safeParse({
      ...SCENARIO,
      requiredAssertions: ["blocks-executor", "blocks-executor"],
    }).success, false);
  });
});
