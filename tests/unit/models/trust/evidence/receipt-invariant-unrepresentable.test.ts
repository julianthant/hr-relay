
import { describe, expect, it } from "vitest";
import { RunEvidenceReceiptSchema } from "../../../../../src/models/trust/evidence.js";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const UUID_4 = "44444444-4444-4444-8444-444444444444";
const FINGERPRINT = "a".repeat(64);
const INSTANT = "2026-08-26T17:00:00.000Z";

const MANDATORY_FACT = {
  id: UUID_3,
  field: "employeeId",
  mandatory: true,
  state: "satisfied",
  source: { kind: "system", taskId: "ucpath/search-person", observedAt: INSTANT },
  value: {
    state: "transformed",
    key: "employeeId",
    classification: "direct-identifier",
    transform: "last4",
    value: "1234",
  },
} as const;

/** A receipt that PASSES — the control every case below mutates by one clause. */
const VERIFIED_DONE = {
  composition: 5,
  receiptId: UUID_1,
  runId: UUID_2,
  traceId: "on-120000-2222",
  workflowId: "onboarding",
  attempt: 1,
  generatedAt: INSTANT,
  descriptorFingerprint: FINGERPRINT,
  configFingerprint: FINGERPRINT,
  retryOf: { state: "absent" },
  failure: { state: "absent" },
  input: [MANDATORY_FACT],
  observations: [],
  decisions: [],
  actions: [],
  verification: [],
  output: [],
  reuse: [],
  warnings: [],
  confidence: "verified",
  result: "verified-done",
} as const;

describe("the receipt invariant is unrepresentable, so the demo's banner cannot fire", () => {
  it("admits a receipt that meets the invariant — the control", () => {
    expect(RunEvidenceReceiptSchema.safeParse(VERIFIED_DONE).success).toBe(true);
  });

  it("refuses `verified-done` on anything but verified confidence", () => {
    for (const confidence of ["partial", "unknown"]) {
      expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, confidence }).success).toBe(false);
    }
  });

  it("refuses `verified-done` over an unresolved MANDATORY fact", () => {
    const unresolved = { id: UUID_3, field: "employeeId", mandatory: true, state: "unresolved", reason: "not observed" };
    expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, input: [unresolved] }).success).toBe(false);
  });

  it("refuses `verified-done` over a mandatory obligation whose verdict answered nothing", () => {
    for (const verdict of ["unknown", "ambiguous"]) {
      const verification = [{ id: UUID_4, obligation: "ucpath.person-verified", mandatory: true, verdict, evidence: [] }];
      expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, verification }).success).toBe(false);
    }
  });

  it("refuses `verified-done` carrying any warning at all", () => {
    const warnings = [{ id: UUID_4, code: "OPTIONAL_FACT_MISSING", summary: "Optional note missing", loadBearing: false, evidence: [] }];
    expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, warnings }).success).toBe(false);
  });

  it("refuses `verified-done` carrying a failure id", () => {
    expect(RunEvidenceReceiptSchema.safeParse({
      ...VERIFIED_DONE,
      failure: { state: "present", value: UUID_4 },
    }).success).toBe(false);
  });

  it("refuses a `verified` obligation that cites no evidence — the read-back is what earns the word", () => {
    const verification = [{ id: UUID_4, obligation: "ucpath.person-verified", mandatory: true, verdict: "verified", evidence: [] }];
    expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, verification }).success).toBe(false);
  });
});
