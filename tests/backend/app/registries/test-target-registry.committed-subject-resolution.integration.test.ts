import { recordingInputSource } from "../../../support/helpers/test-target-registry-fixtures.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import {
FINALIZATION_WORKFLOW,
PERSON_LOOKUP_WORKFLOW,
resolveSeparationsKualiFinalizationTestTarget,
resolveSeparationsTestTarget,
SEPARATIONS_WORKFLOW,
TEST_TARGET_REGISTRY,
TestTargetWorkflowArmsSchema
} from "../../../../src/backend/app/registries/test-target-registry.js";

import { testDataInputSource } from "../../../support/helpers/test-data/test-data-source.js";


const DOCUMENT_NUMBER_SECRET = {
  name: "separationsKualiFinalizationCanaryDocumentNumber",
} as const;
/** A private canary-shaped value, supplied only by the test protected store. */
const COMMITTED_DOCUMENT_NUMBER = "4999";
const COMMITTED_CONFIGURED_SOURCE = testDataInputSource({
  separationsKualiFinalizationCanaryDocumentNumber: COMMITTED_DOCUMENT_NUMBER,
});

/** A test-data input source whose every read is recorded by input name. */


/** A source whose private file is invalid: the loader already refused it by key, never by value. */
const privateRoots: string[] = [];
afterEach(() => { for (const root of privateRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("the committed test target registry", () => {
  it("carries exactly two closed-reference subjects without committing either identifier", () => {
    assert.deepEqual(TEST_TARGET_REGISTRY.targets.map(({ label }) => label), ["finalization-canary", "person-lookup-canary"]);
    assert.equal(TEST_TARGET_REGISTRY.schemaVersion, 2);
  });

  it("declares that one subject for BOTH workflow resolvers", () => {
    const [target] = TEST_TARGET_REGISTRY.targets;
    assert.deepEqual(Object.keys(target?.workflows ?? {}).sort(), [
      "separations",
      "separations-kuali-finalization",
    ]);
  });

  it("lists the committed subject's declared workflows in the arms schema's own shape order", () => {

    assert.deepEqual(Object.keys(TestTargetWorkflowArmsSchema.shape), [
      SEPARATIONS_WORKFLOW,
      FINALIZATION_WORKFLOW,
      PERSON_LOOKUP_WORKFLOW,
    ]);
    const [target] = TEST_TARGET_REGISTRY.targets;
    assert.deepEqual(Object.keys(target?.workflows ?? {}), [
      SEPARATIONS_WORKFLOW,
      FINALIZATION_WORKFLOW,
    ]);
  });

  it("commits the canary's document as a closed reference, never as a number", () => {

    const chain = TEST_TARGET_REGISTRY.targets[0]?.workflows[SEPARATIONS_WORKFLOW];
    assert.deepEqual(chain?.publicInput.document, {
      state: "configured",
      reference: DOCUMENT_NUMBER_SECRET,
    });
    assert.equal(Object.hasOwn(chain?.publicInput.document ?? {}, "documentNumber"), false);
  });

  it("resolves the available composed canary through its configured number", () => {
    const { source, read } = recordingInputSource({
      separationsKualiFinalizationCanaryDocumentNumber: COMMITTED_DOCUMENT_NUMBER,
    });
    const resolution = resolveSeparationsTestTarget(TEST_TARGET_REGISTRY, "finalization-canary", source);
    assert.deepEqual(resolution, {
      state: "ready",
      label: "finalization-canary",
      protectedBindings: [{ kind: "test-data-local", inputPath: "documentNumber", name: "separationsKualiFinalizationCanaryDocumentNumber",
        sourceId: "00000000-0000-4000-8000-000000000010" }],
      canonicalInput: {
        documentNumber: COMMITTED_DOCUMENT_NUMBER,
        reRead: { ordinal: 2, reason: "Operator-requested second read-only rehearsal with repaired pending-set observation." },
      },
    });
    assert.deepEqual(read, ["separationsKualiFinalizationCanaryDocumentNumber"]);
  });

  it("blocks the standalone finalization arm on its declared pending leaves", () => {
    const result = resolveSeparationsKualiFinalizationTestTarget(
      TEST_TARGET_REGISTRY,
      "finalization-canary",
    );
    assert.deepEqual(result, {
      state: "blocked",
      label: "finalization-canary",
      reason: "blocked: needs finalization-canary for separations-kuali-finalization; transactionNumber not yet filed (UCPath filing \u2461 pending); timekeeperComments not authored (the composed chain's comments node composes it); terminationEffectiveDate not observed on the form; the chain's dates node derives it (separation date + 1), last observed 2026-09-08",
    });

    assert.equal(resolveSeparationsKualiFinalizationTestTarget.length, 2);
  });

  it("both resolvers answer under the same one label", () => {
    const chain = resolveSeparationsTestTarget(
      TEST_TARGET_REGISTRY,
      "finalization-canary",
      COMMITTED_CONFIGURED_SOURCE,
    );
    const finalization = resolveSeparationsKualiFinalizationTestTarget(
      TEST_TARGET_REGISTRY,
      "finalization-canary",
    );
    assert.equal(chain.label, "finalization-canary");
    assert.equal(finalization.label, "finalization-canary");
  });

  it("is recursively frozen, person-value-free, and free of every retired label", () => {
    assert.equal(Object.isFrozen(TEST_TARGET_REGISTRY), true);
    assert.equal(Object.isFrozen(TEST_TARGET_REGISTRY.targets), true);
    const committed = JSON.stringify(TEST_TARGET_REGISTRY);
    for (const retired of [
      "finalization-already-finalized",
      "finalization-no-active-job",
      "finalization-subject-mismatch",
      "separations-dry-run-subject",
      "separations-future-dated",
      "separations-controlled-commit-candidate",
      "separations-pending-termination",
      "separations-controlled-commit-canary",
    ]) {
      assert.equal(committed.includes(retired), false, `retired label ${retired} is still committed`);
    }
    assert.equal(committed.includes("emplId\":\""), false);

    for (const retiredReference of [
      "separationsKualiFinalizationCanaryEid",
      "separationsKualiFinalizationCanaryEmployeeName",
      "separationsKualiFinalizationCanaryTimekeeperName",
    ]) {
      assert.equal(committed.includes(retiredReference), false, `${retiredReference} is still committed`);
    }
    const finalization = TEST_TARGET_REGISTRY.targets[0]?.workflows[FINALIZATION_WORKFLOW];
    assert.equal(Object.hasOwn(finalization ?? {}, "secretInput"), false);
    assert.equal(Object.hasOwn(finalization?.publicInput ?? {}, "employeeName"), false);
    assert.equal(Object.hasOwn(finalization?.publicInput ?? {}, "timekeeperName"), false);
  });
});
