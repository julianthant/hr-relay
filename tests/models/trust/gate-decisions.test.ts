import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { GATE_DECISIONS, GateDecisionDeclarationSchema, gateDecisionFor } from "../../../src/models/trust/gate-decisions.js";

describe("gate resolution declarations", () => {
  it("declares the private workbook source and exact pending input binding for every roster proof", () => {
    for (const declaration of GATE_DECISIONS.filter(value => value.gateId === "roster-choice")) {
      assert.deepEqual(declaration.resolution, { source: "workbook-reference", boundInputPath: "roster.binding.referenceDigest",
        inputCondition: { path: "roster.state", equals: "resolve-required" } });
      assert.equal(declaration.boundEvidencePath, "row.binding.referenceDigest");
      const { boundEvidencePath: _bound, ...missing } = declaration;
      assert.equal(GateDecisionDeclarationSchema.safeParse(missing).success, false);
    }
    assert.deepEqual(gateDecisionFor("separations", "identity-approval").resolution, { source: "operator" });
  });
  it("refuses absent or undeclared resolution policies", () => {
    const { resolution: _policy, ...declaration } = gateDecisionFor("onboarding", "roster-choice");
    assert.equal(GateDecisionDeclarationSchema.safeParse(declaration).success, false);
    assert.equal(GateDecisionDeclarationSchema.safeParse({ ...declaration, resolution: { source: "unverified" } }).success, false);
  });
});
