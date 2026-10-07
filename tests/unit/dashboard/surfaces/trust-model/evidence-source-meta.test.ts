/**
 * `evidenceSourceMeta` — the one line beside every receipt fact saying WHERE it
 * came from and WHEN (03a fidelity ledger 2 rows D25 and D27).
 *
 * This tree renders no React in the unit lane, so an operator-facing sentence
 * is only as pinned as the parity corpus unless it is extracted — which is why
 * the fold is a pure exported function and why every arm is enumerated here
 * rather than sampled. The arms that mattered were `system`/`checkpoint` (a
 * `taskId` and an `observedAt` the surface printed as the bare word "system")
 * and `input` (an `inputFingerprint` printed as the bare word "input").
 *
 * Every value goes through its own id schema, so a test fixture cannot pin a
 * shape the wire would refuse.
 */
import { describe, expect, it } from "vitest";
import {
  ActorIdSchema,
  EvidenceEntryIdSchema,
  EvidenceRefSchema,
  FingerprintSchema,
  GateIdSchema,
  IsoInstantSchema,
  TaskIdSchema,
} from "../../../../../src/rules/identity/ids.js";
import {
  evidenceSourceMeta,
  inputHashFooter,
  type EvidenceSourceWire,
} from "../../../../../src/dashboard/surfaces/trust-model.js";
import { EvidenceFactSchema } from "../../../../../src/models/trust/evidence.js";
import { fmtClock } from "../../../../../src/dashboard/surfaces/format.js";

const FINGERPRINT = FingerprintSchema.parse("3f9a1c2d".repeat(8));
const OBSERVED_AT = IsoInstantSchema.parse("2026-08-21T21:03:12.000Z");
const OBSERVED_CLOCK = fmtClock(OBSERVED_AT);
const ENTRY_ID = EvidenceEntryIdSchema.parse("11111111-1111-4111-8111-111111111111");
const REF_ONE = EvidenceRefSchema.parse("observation:11111111-1111-4111-8111-111111111111");
const REF_TWO = EvidenceRefSchema.parse("observation:22222222-2222-4222-8222-222222222222");

const ARMS: readonly EvidenceSourceWire[] = [
  { kind: "input", inputFingerprint: FINGERPRINT },
  { kind: "system", taskId: TaskIdSchema.parse("ucpath/person-lookup"), observedAt: OBSERVED_AT },
  {
    kind: "checkpoint",
    taskId: TaskIdSchema.parse("kuali/read-document"),
    checkpointFingerprint: FINGERPRINT,
    observedAt: OBSERVED_AT,
  },
  {
    kind: "gate-result",
    gateId: GateIdSchema.parse("identity-approval"),
    resolvedBy: ActorIdSchema.parse("local-operator"),
    resolvedAt: OBSERVED_AT,
  },
  { kind: "operator-correction", supersedes: ENTRY_ID },
  { kind: "derived", evidence: [REF_ONE] },
];

describe("evidenceSourceMeta", () => {
  it("names the input's fingerprint, cut to the product's one id length", () => {
    expect(evidenceSourceMeta({ kind: "input", inputFingerprint: FINGERPRINT }))
      .toBe("input · hash 3f9a1c2d");
  });

  it("names the task and the instant a system observation was made", () => {
    const meta = evidenceSourceMeta({
      kind: "system",
      taskId: TaskIdSchema.parse("ucpath/person-lookup"),
      observedAt: OBSERVED_AT,
    });
    expect(meta).toBe(`system · ucpath/person-lookup · ${OBSERVED_CLOCK}`);
    expect(meta).not.toBe("system");
  });

  it("names the task and the instant a replayed checkpoint recorded", () => {
    const meta = evidenceSourceMeta({
      kind: "checkpoint",
      taskId: TaskIdSchema.parse("kuali/read-document"),
      checkpointFingerprint: FINGERPRINT,
      observedAt: OBSERVED_AT,
    });
    expect(meta).toBe(`checkpoint · kuali/read-document · ${OBSERVED_CLOCK}`);
  });

  it("names the gate, its approver and its instant — authority's values, not a payload's", () => {
    const meta = evidenceSourceMeta({
      kind: "gate-result",
      gateId: GateIdSchema.parse("identity-approval"),
      resolvedBy: ActorIdSchema.parse("local-operator"),
      resolvedAt: OBSERVED_AT,
    });
    expect(meta).toBe(`gate identity-approval · by local-operator · ${OBSERVED_CLOCK}`);
  });

  it("names what an operator correction superseded", () => {
    expect(evidenceSourceMeta({ kind: "operator-correction", supersedes: ENTRY_ID }))
      .toBe(`operator correction · supersedes ${ENTRY_ID}`);
  });

  it("counts a derived fact's upstream entries, singular and plural", () => {
    expect(evidenceSourceMeta({ kind: "derived", evidence: [REF_ONE] }))
      .toBe("derived · from 1 entry");
    expect(evidenceSourceMeta({ kind: "derived", evidence: [REF_ONE, REF_TWO] }))
      .toBe("derived · from 2 entries");
  });

  it("returns one full Input fingerprint even when its field is unresolved", () => {
    const systemFact = EvidenceFactSchema.parse({
      id: ENTRY_ID,
      field: "employee",
      mandatory: true,
      source: { kind: "system", taskId: TaskIdSchema.parse("ucpath/person-lookup"), observedAt: OBSERVED_AT },
      state: "unresolved",
      reason: "lookup did not return a person",
    });
    const inputFact = EvidenceFactSchema.parse({
      id: EvidenceEntryIdSchema.parse("22222222-2222-4222-8222-222222222222"),
      field: "employee",
      mandatory: true,
      source: { kind: "input", inputFingerprint: FINGERPRINT },
      state: "unresolved",
      reason: "input could not be resolved",
    });

    expect(inputHashFooter([systemFact, inputFact])).toBe(FINGERPRINT);
  });

  it("omits a footer without an input source and rejects conflicting run fingerprints", () => {
    const systemFact = EvidenceFactSchema.parse({
      id: ENTRY_ID,
      field: "employee",
      mandatory: true,
      source: { kind: "system", taskId: TaskIdSchema.parse("ucpath/person-lookup"), observedAt: OBSERVED_AT },
      state: "unresolved",
      reason: "lookup did not return a person",
    });
    const otherInputFact = EvidenceFactSchema.parse({
      id: EvidenceEntryIdSchema.parse("22222222-2222-4222-8222-222222222222"),
      field: "employee",
      mandatory: true,
      source: { kind: "input", inputFingerprint: FingerprintSchema.parse("4b8e2d9f".repeat(8)) },
      state: "unresolved",
      reason: "input could not be resolved",
    });
    const inputFact = EvidenceFactSchema.parse({
      id: EvidenceEntryIdSchema.parse("33333333-3333-4333-8333-333333333333"),
      field: "department",
      mandatory: true,
      source: { kind: "input", inputFingerprint: FINGERPRINT },
      state: "satisfied",
      value: {
        key: "department",
        state: "allowed",
        classification: "safe-diagnostic",
        transform: "allow",
        value: "Academic Affairs",
      },
    });

    expect(inputHashFooter([systemFact])).toBeUndefined();
    expect(() => inputHashFooter([inputFact, otherInputFact]))
      .toThrow("inputHashFooter: Input section has conflicting input fingerprints");
  });

  it("never renders a source as its discriminant alone — every arm carries a fact", () => {
    // The defect this closes: `source.kind` was the whole line, so bytes the
    // wire had already carried (D25/D27) never reached a pixel. A regression
    // would show up as a meta that IS the tag.
    for (const arm of ARMS) {
      const meta = evidenceSourceMeta(arm);
      expect(meta).not.toBe(arm.kind);
      expect(meta).toContain(" · ");
    }
  });
});
