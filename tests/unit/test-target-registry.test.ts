import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  parseTestTargetRegistry,
  resolveSeparationsKualiFinalizationTestTarget,
  type TestTargetRegistryInput,
} from "../../src/control/test-target-registry.js";

const TARGET = {
  label: "fixture-target",
  workflow: "separations-kuali-finalization",
  kind: "ordinary",
  availability: {
    state: "unknown",
    lastObserved: "2026-08-20",
    reason: "No live fixture exists.",
  },
  provenance: {
    document: "docs/rebuild/reference/guards-and-tests.md",
    section: "§10.5",
  },
  usagePolicy: "read-only",
  cleanupObligation: "None; this fixture must not write.",
  owner: "test operator",
  publicInput: {},
} as const;

const EID_SECRET = {
  name: "separationsKualiFinalizationCanaryEid",
  env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID",
} as const;

const READY_PUBLIC_INPUT: TestTargetRegistryInput["targets"][number]["publicInput"] = {
  actionId: "0123456789abcdef01234567",
  documentNumber: "4444",
  employeeName: "Person, Synthetic",
  emplIdSource: "document-eid",
  ucpathDeptId: { state: "present", value: "000412" },
  ucpathDepartment: { state: "present", value: "HOUSING/DINING/HOSPITALITY" },
  observedDepartmentOptions: ["- - -", "000412 - Housing/Dining/Hospitality"],
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  timekeeperName: "Synthetic Timekeeper",
  lastDayWorked: "06/09/2026",
  separationDate: "06/10/2026",
  terminationEffectiveDate: "06/11/2026",
  transactionNumber: "T009000001",
  timekeeperComments: "Synthetic finalization comment.",
  observedExistingComments: "",
};

function registry(targets: TestTargetRegistryInput["targets"]): TestTargetRegistryInput {
  return { schemaVersion: 1, targets };
}

describe("test target registry", () => {
  it("rejects duplicate labels by name", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([TARGET, TARGET])),
      /test target registry repeats label fixture-target/,
    );
  });

  it("rejects a manifest kind that disagrees with its registered label", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([TARGET]), [{
        workflow: "separations-kuali-finalization",
        cases: [{ subjectLabel: "fixture-target", subjectKind: "no-active-job" }],
      }]),
      /fixture-target.*kind ordinary.*manifest.*no-active-job/,
    );
  });

  it("rejects a manifest workflow that disagrees with its registered label", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([TARGET]), [{
        workflow: "person-lookup",
        cases: [{ subjectLabel: "fixture-target", subjectKind: "ordinary" }],
      }]),
      /fixture-target.*workflow separations-kuali-finalization.*manifest person-lookup/,
    );
  });

  it("rejects a manifest label absent from the registry", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([TARGET]), [{
        workflow: "separations-kuali-finalization",
        cases: [{ subjectLabel: "missing-target", subjectKind: "ordinary" }],
      }]),
      /missing-target.*no test target registry entry/,
    );
  });

  it("rejects unknown keys at nested config boundaries", () => {
    const withUnknown = {
      ...TARGET,
      availability: { ...TARGET.availability, guessedReady: true },
    };
    assert.throws(() => parseTestTargetRegistry(registry([withUnknown])));
  });

  it("recursively freezes parsed registries", () => {
    const parsed = parseTestTargetRegistry(registry([TARGET]));
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.targets), true);
    assert.equal(Object.isFrozen(parsed.targets[0]?.availability), true);
  });

  it("resolves a complete available target into the exact canonical workflow input", () => {
    const parsed = parseTestTargetRegistry(registry([{
      ...TARGET,
      availability: {
        state: "available",
        lastObserved: "2026-08-25",
        reason: "Synthetic complete fixture.",
      },
      publicInput: READY_PUBLIC_INPUT,
      secretInput: {
        emplId: EID_SECRET,
        documentEid: { state: "present", eid: EID_SECRET },
      },
    }]));

    const result = resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
      HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: "10800000",
    });

    assert.deepEqual(result, {
      state: "ready",
      label: "fixture-target",
      canonicalInput: {
        ...READY_PUBLIC_INPUT,
        observedDepartmentOptions: ["- - -", "000412 - Housing/Dining/Hospitality"],
        emplId: "10800000",
        documentEid: { state: "present", value: "10800000" },
      },
    });
  });

  it("blocks an unknown requested label before resolution", () => {
    const parsed = parseTestTargetRegistry(registry([TARGET]));
    assert.deepEqual(resolveSeparationsKualiFinalizationTestTarget(parsed, "unmapped-target", {}), {
      state: "blocked",
      label: "unmapped-target",
      reason: "blocked: needs unmapped-target",
    });
  });

  it("blocks gone and unknown entries before reading their EID secret", () => {
    const states = ["gone", "unknown"] as const;
    const results = states.map((state) => {
      const parsed = parseTestTargetRegistry(registry([{
        ...TARGET,
        availability: {
          state,
          lastObserved: "2026-08-19",
          reason: `${state} fixture`,
        },
        secretInput: {
          emplId: EID_SECRET,
          documentEid: { state: "present" as const, eid: EID_SECRET },
        },
      }]));
      return resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: "SECRET_THAT_MUST_NOT_BE_READ",
      });
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

  it("fails a falsely available entry missing a required public field by label and observation date", () => {
    const parsed = parseTestTargetRegistry(registry([{
      ...TARGET,
      availability: {
        state: "available",
        lastObserved: "2026-08-25",
        reason: "Synthetic incomplete fixture.",
      },
      publicInput: { ...READY_PUBLIC_INPUT, transactionNumber: undefined },
      secretInput: {
        emplId: EID_SECRET,
        documentEid: { state: "present", eid: EID_SECRET },
      },
    }]));
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: "10800000",
      }),
      /fixture-target marked available, last observed 2026-08-25:.*complete canonical input/,
    );
  });

  it("fails a falsely available entry with a missing EID secret by label and observation date", () => {
    const parsed = parseTestTargetRegistry(registry([{
      ...TARGET,
      availability: {
        state: "available",
        lastObserved: "2026-08-25",
        reason: "Synthetic complete fixture.",
      },
      publicInput: READY_PUBLIC_INPUT,
      secretInput: {
        emplId: EID_SECRET,
        documentEid: { state: "present", eid: EID_SECRET },
      },
    }]));
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {}),
      /fixture-target marked available, last observed 2026-08-25:.*secret EID reference.*missing/,
    );
  });

  it("never retains an invalid EID secret value in the registry defect", () => {
    const parsed = parseTestTargetRegistry(registry([{
      ...TARGET,
      availability: {
        state: "available",
        lastObserved: "2026-08-25",
        reason: "Synthetic complete fixture.",
      },
      publicInput: READY_PUBLIC_INPUT,
      secretInput: {
        emplId: EID_SECRET,
        documentEid: { state: "present", eid: EID_SECRET },
      },
    }]));
    const eidCanary = "CANARY_REAL_EID_MUST_NOT_LEAK";
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: eidCanary,
      }),
      (error: unknown) => {
        assert.match(String(error), /fixture-target marked available, last observed 2026-08-25/);
        assert.equal(String(error).includes(eidCanary), false);
        return true;
      },
    );
  });

  it("rejects committing an EID inside public input", () => {
    const invalidRegistry: unknown = {
      schemaVersion: 1,
      targets: [{
        ...TARGET,
        publicInput: { ...READY_PUBLIC_INPUT, emplId: "10800000" },
      }],
    };
    assert.throws(() => parseTestTargetRegistry(invalidRegistry));
  });
});
