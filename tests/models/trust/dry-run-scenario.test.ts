import { createDryRunScenarioFixtures } from "../../support/helpers/dry-run-scenario-fixtures.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { deriveDryRunScenarioManifestDigest, parseDryRunScenarioManifest } from "../../../src/models/trust/dry-run-scenario.js";

const { MANIFEST } = createDryRunScenarioFixtures();

const GATED_MANIFEST = {
  ...MANIFEST,
  cases: [{
    ...MANIFEST.cases[0],
    nodesReached: ["read", "approval", "write"],
    gateResults: [{ gate: "approval", decision: "approved", resolvedBy: "local-operator" }],
  }],
} as const;

describe("dry-run scenario manifest boundary", () => {
  it("canonicalizes and digests the complete manifest facts", () => {
    const parsed = parseDryRunScenarioManifest(MANIFEST);

    assert.equal(
      deriveDryRunScenarioManifestDigest(parsed),
      "a88ff7081bb9be203451b4124d03bf359fc393135a07feacd1bf34072ac0eb13",
    );
  });


  it("refuses a gate expectation field no evaluator compares", () => {
    assert.throws(() => parseDryRunScenarioManifest({
      ...GATED_MANIFEST,
      cases: [{
        ...GATED_MANIFEST.cases[0],
        gateResults: [{
          gate: "approval",
          decision: "approved",
          resolvedBy: "local-operator",
          leaf: "resolve-gate-approved",
        }],
      }],
    }), /leaf/);
  });

  it("rejects duplicate subject cases at the strict manifest boundary", () => {
    assert.throws(() => parseDryRunScenarioManifest({
      ...MANIFEST,
      cases: [MANIFEST.cases[0], { ...MANIFEST.cases[0], caseId: "second" }],
    }), /repeats a subjectLabel/);
  });
});


it("binds screenshot opt-in and ordered expected nodes into the case digest", () => {
  const manifest = { ...MANIFEST, cases: [{ ...MANIFEST.cases[0], screenshots: { nodes: ["read", "write"] } }] };
  assert.notEqual(deriveDryRunScenarioManifestDigest(manifest), deriveDryRunScenarioManifestDigest(MANIFEST));
  assert.notEqual(deriveDryRunScenarioManifestDigest(manifest), deriveDryRunScenarioManifestDigest({ ...manifest,
    cases: [{ ...manifest.cases[0], screenshots: { nodes: ["write", "read"] } }] }));
  assert.throws(() => parseDryRunScenarioManifest({ ...manifest,
    cases: [{ ...manifest.cases[0], screenshots: { nodes: [] } }] }));
});
