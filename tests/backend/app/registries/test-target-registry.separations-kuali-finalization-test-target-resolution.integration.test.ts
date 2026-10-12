import { createTestTargetRegistryFixtures } from "../../../support/helpers/test-target-registry-fixtures.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import {
FINALIZATION_PERSON_FACTS_DERIVED_REASON,
parseTestTargetRegistry,
resolveSeparationsKualiFinalizationTestTarget,
SeparationsKualiFinalizationPendingSchema,
type TestTargetRegistryInput
} from "../../../../src/backend/app/registries/test-target-registry.js";

type TestTargetEntryInput = TestTargetRegistryInput["targets"][number];
type FinalizationArmInput = NonNullable<TestTargetEntryInput["workflows"]["separations-kuali-finalization"]>;



const DOCUMENT_NUMBER_SECRET = {
  name: "separationsKualiFinalizationCanaryDocumentNumber",
} as const;


const { SUBJECT, OBSERVED_PUBLIC_INPUT, FINALIZATION_ARM, registry, rawRegistry, finalizationSubject, chainSubject } = createTestTargetRegistryFixtures(DOCUMENT_NUMBER_SECRET);

/** Every finalization canonical leaf a live read can observe, minus the four person values. */



const PENDING_FREE_PUBLIC_INPUT: FinalizationArmInput["publicInput"] = (() => {
  const { terminationEffectiveDate: _staged, ...rest } = OBSERVED_PUBLIC_INPUT;
  return rest;
})();

/** The same leaves plus the two a run only has once ② has filed and ③ composed. */







const AVAILABLE = {
  state: "available",
  lastObserved: "2026-08-25",
  reason: "Synthetic complete fixture.",
} as const;










/** A source whose private file is invalid: the loader already refused it by key, never by value. */
const privateRoots: string[] = [];
afterEach(() => { for (const root of privateRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("separations-kuali-finalization test target resolution", () => {
  it("states the standing refusal in the words the resolver reports", () => {
    // Pin the reason text independently so a silently emptied shared constant cannot satisfy both sides.
    assert.equal(
      FINALIZATION_PERSON_FACTS_DERIVED_REASON,
      "employee name, EID and timekeeper name are derived live by the composed separations chain "
      + "and are never registry- or protected-settings-supplied; run the composed separations workflow",
    );
  });

  it("blocks BY NAME even when every public leaf a live read can supply is present", () => {

    const parsed = parseTestTargetRegistry(registry([finalizationSubject({ availability: AVAILABLE })]));

    assert.deepEqual(resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target"), {
      state: "blocked",
      label: "fixture-target",
      reason: "blocked: needs fixture-target for separations-kuali-finalization; "
        + `${FINALIZATION_PERSON_FACTS_DERIVED_REASON}, last observed 2026-08-25`,
    });
  });

  it("blocks rather than defects when the public record is INCOMPLETE", () => {

    const parsed = parseTestTargetRegistry(registry([finalizationSubject({
      availability: AVAILABLE,
      workflows: {
        "separations-kuali-finalization": { ...FINALIZATION_ARM, publicInput: OBSERVED_PUBLIC_INPUT },
      },
    })]));
    const result = resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target");
    assert.equal(result.state, "blocked");
    assert.match(result.reason, new RegExp(FINALIZATION_PERSON_FACTS_DERIVED_REASON.slice(0, 40)));
  });

  it("blocks an unknown requested label before resolution", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject()]));
    assert.deepEqual(resolveSeparationsKualiFinalizationTestTarget(parsed, "unmapped-target"), {
      state: "blocked",
      label: "unmapped-target",
      reason: "blocked: needs unmapped-target",
    });
  });

  it("refuses by name a label whose subject declares no finalization arm", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject()]));
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target"),
      (error: unknown) => {
        assert.equal((error as Error).name, "TestTargetRegistryDefectError");
        assert.match(
          String(error),
          /fixture-target declares no separations-kuali-finalization arm; it declares separations/,
        );
        return true;
      },
    );
  });

  it("blocks gone and unknown subjects with the registry's own dated claim", () => {
    const states = ["gone", "unknown"] as const;
    const results = states.map((state) => {
      const parsed = parseTestTargetRegistry(registry([finalizationSubject({
        availability: { state, lastObserved: "2026-08-19", reason: `${state} fixture` },
      })]));
      return resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target");
    });
    assert.deepEqual(results, [
      {
        state: "blocked",
        label: "fixture-target",
        reason: "blocked: needs fixture-target; registry says gone, last observed 2026-08-19",
      },
      {
        state: "blocked",
        label: "fixture-target",
        reason: "blocked: needs fixture-target; registry says unknown, last observed 2026-08-19",
      },
    ]);
  });

  it("blocks a declared-pending field instead of fabricating it", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject({
      availability: AVAILABLE,
      workflows: {
        "separations-kuali-finalization": {
          ...FINALIZATION_ARM,
          publicInput: OBSERVED_PUBLIC_INPUT,
          pending: { transactionNumber: "not yet filed (fixture)" },
        },
      },
    })]));
    assert.deepEqual(
      resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target"),
      {
        state: "blocked",
        label: "fixture-target",
        reason: "blocked: needs fixture-target for separations-kuali-finalization; "
          + "transactionNumber not yet filed (fixture), last observed 2026-08-25",
      },
    );
  });

  it("names EVERY pending key the schema declares in the blocked reason", () => {

    const declared = Object.keys(SeparationsKualiFinalizationPendingSchema.shape);
    assert.equal(declared.length > 0, true);
    const parsed = parseTestTargetRegistry(rawRegistry([{
      ...SUBJECT,
      availability: AVAILABLE,
      workflows: {
        "separations-kuali-finalization": {
          ...FINALIZATION_ARM,
          publicInput: PENDING_FREE_PUBLIC_INPUT,
          pending: Object.fromEntries(declared.map((field) => [field, `${field} fixture reason`])),
        },
      },
    }]));

    const result = resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target");
    assert.equal(result.state, "blocked");
    for (const field of declared) {
      assert.match(result.reason, new RegExp(`${field} ${field} fixture reason`));
    }
  });
});
