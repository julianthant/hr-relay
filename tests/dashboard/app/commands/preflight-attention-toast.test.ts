import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { preflightAttentionToast } from "../../../../src/dashboard/app/commands/preflight-attention-toast.js";

describe("preflight attention toast", () => {
  it("names Network ports and stays quiet for a data-store-only failure", () => {
    const toast = preflightAttentionToast({ results: [
      { check: "ports.available", status: "fail" },
      { check: "authority.health", status: "fail" },
    ] });
    assert.equal(toast?.title, "Needs attention in Settings: Network ports.");
    assert.equal(toast !== undefined && ("action" in toast || "sticky" in toast), false);
    assert.equal(preflightAttentionToast({ results: [{ check: "authority.health", status: "fail" }] }), undefined);
    assert.equal(preflightAttentionToast({ results: [{ check: "ports.available", status: "pass" }] }), undefined);
  });
});
