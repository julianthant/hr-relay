import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { FINALIZATION_PERSON_FACTS_DERIVED_REASON, SeparationsKualiFinalizationTestTargetResolutionSchema, resolveSeparationsKualiFinalizationTestTarget, resolveSeparationsTestTarget, TEST_TARGET_REGISTRY } from "../../../../src/backend/app/registries/test-target-registry.js";
import { testDataInputSource } from "../../../support/helpers/test-data/test-data-source.js";


const SOLE_SUBJECT_LABEL = "finalization-canary";
const SOLE_SUBJECT_LAST_OBSERVED = "2026-09-08";

describe("test target registry architecture", () => {

  it("blocks every currently declared label, and cannot be handed an environment at all", () => {

    assert.equal(resolveSeparationsKualiFinalizationTestTarget.length, 2);
    const resolutions = TEST_TARGET_REGISTRY.targets
      .filter((target) => target.workflows["separations-kuali-finalization"] !== undefined)
      .map(({ label }) => resolveSeparationsKualiFinalizationTestTarget(TEST_TARGET_REGISTRY, label));

    assert.deepEqual(resolutions.map(({ label }) => label), [SOLE_SUBJECT_LABEL]);
    assert.equal(resolutions.every(({ state }) => state === "blocked"), true);

    // Function.length hides defaulted parameters; probe runtime access with a throwing third argument.
    const forbiddenEnvironment = new Proxy(Object.create(null) as NodeJS.ProcessEnv, {
      get: () => {
        throw new Error("standalone finalization resolver must not read an environment");
      },
      ownKeys: () => {
        throw new Error("standalone finalization resolver must not enumerate an environment");
      },
      getOwnPropertyDescriptor: () => {
        throw new Error("standalone finalization resolver must not inspect an environment");
      },
    });
    const withSuppliedEnvironment = SeparationsKualiFinalizationTestTargetResolutionSchema.parse(
      Reflect.apply(
        resolveSeparationsKualiFinalizationTestTarget,
        undefined,
        [TEST_TARGET_REGISTRY, SOLE_SUBJECT_LABEL, forbiddenEnvironment],
      ),
    );
    assert.deepEqual(withSuppliedEnvironment, resolutions[0]);
  });


  it("answers both resolvers from the one subject's own arm, without cross-workflow guessing", () => {
    const chain = resolveSeparationsTestTarget(
      TEST_TARGET_REGISTRY,
      "finalization-canary",
      testDataInputSource({ separationsKualiFinalizationCanaryDocumentNumber: "4999" }),
    );
    assert.deepEqual(chain, {
      state: "ready",
      label: "finalization-canary",
      canonicalInput: {
        documentNumber: "4999",
        reRead: { ordinal: 2, reason: "Operator-requested second read-only rehearsal with repaired pending-set observation." },
      },
      protectedBindings: [{ kind: "test-data-local", inputPath: "documentNumber",
        name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: "00000000-0000-4000-8000-000000000010" }],
    });
    const finalization = resolveSeparationsKualiFinalizationTestTarget(
      TEST_TARGET_REGISTRY,
      "finalization-canary",
    );
    assert.equal(finalization.state, "blocked");
    assert.match(finalization.reason, /transactionNumber not yet filed/u);
    assert.match(finalization.reason, new RegExp(`last observed ${SOLE_SUBJECT_LAST_OBSERVED}$`, "u"));
    // Its person leaves are never registry- or protected-settings-supplied, and the
    // resolver says so in one public sentence once the pending leaves clear.
    assert.match(
      FINALIZATION_PERSON_FACTS_DERIVED_REASON,
      /^employee name, EID and timekeeper name are derived live by the composed separations chain and are never registry- or protected-settings-supplied; run the composed separations workflow$/,
    );
  });
});
