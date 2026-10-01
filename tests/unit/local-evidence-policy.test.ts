import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  DataClassificationSchema, retainLocalEvidenceValue, redactDiagnosticFields,
  redactValue, RedactedValueSchema, directIdentifierDisplay,
} from "../../src/domain/redaction.js";
import { AdvisoryPromptSchema, buildAdvisoryFacts, buildAdvisoryPrompt } from "../../src/domain/trust/advisory.js";
import { NotificationTriggerEventSchema } from "../../src/domain/notification-triggers.js";

describe("local evidence and external disclosure boundaries", () => {
  it.each(DataClassificationSchema.options)("retains complete supplied %s values locally", classification => {
    const value = { text: "SYNTHETIC_COMPLETE_VALUE", nested: ["SYNTHETIC_ID", 17] };
    const transform = classification === "safe-diagnostic" ? "count" : "drop";
    const expected = { state: "allowed", classification, transform: "allow", value };
    assert.deepEqual(RedactedValueSchema.parse(retainLocalEvidenceValue(classification, transform, value)), expected);
    assert.deepEqual(redactDiagnosticFields([{ key: "captured", classification, transform, value }]), {
      fields: [{ key: "captured", ...expected }], warnings: [],
    });
  });

  it("keeps provider transforms closed and refuses complete local fields at provider admission", () => {
    for (const classification of ["secret", "credential-file", "direct-identifier", "sensitive-hr"] as const) {
      assert.deepEqual(redactValue(classification, "drop", "SYNTHETIC_PRIVATE_VALUE"), {
        state: "redacted", classification, transform: "drop",
      });
      assert.throws(() => redactValue(classification, "allow", "SYNTHETIC_PRIVATE_VALUE"), /forbidden/u);
      const fact = { key: "supplied", ...retainLocalEvidenceValue(classification, "drop", "SYNTHETIC_PRIVATE_VALUE") };
      assert.throws(() => buildAdvisoryPrompt("failure-triage", [fact]), /forbidden/u);
    }
    const facts = buildAdvisoryFacts("failure-triage", { summary: "SYNTHETIC_PRIVATE_VALUE" });
    assert.deepEqual(facts, [{ key: "summary", state: "redacted", classification: "sensitive-hr", transform: "drop" }]);
    const valid = buildAdvisoryPrompt("failure-triage", facts);
    assert.equal(AdvisoryPromptSchema.safeParse({ ...valid, facts: [
      { key: "supplied", ...retainLocalEvidenceValue("secret", "drop", "SYNTHETIC_PRIVATE_VALUE") },
    ] }).success, false);
  });

  it("does not add a captured-value channel to OS notifications", () => {
    const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
    assert.equal(NotificationTriggerEventSchema.safeParse(event).success, true);
    assert.equal(NotificationTriggerEventSchema.safeParse({ ...event, message: "SYNTHETIC_PRIVATE_VALUE" }).success, false);
    assert.equal(directIdentifierDisplay("SYNTHETIC_ID"), "SYNTHETIC_ID");
  });
});
