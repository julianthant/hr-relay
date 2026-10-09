import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { GENERATED_BUILD_MANIFEST } from "../../../src/workflow-kit/validation/generated-build-manifest.js";
import { TEST_DATA_INPUT_NAMES, TestDataInputValueSchemas } from "../../../src/models/config/test-data.js";
import { RETIRED_TEST_TARGET_PROTECTED_NAMES } from "../../../src/models/config/protected-settings-legacy.js";
import { ProtectedSettingsNameSchema } from "../../../src/models/config/protected-settings.js";
import {
  FINALIZATION_PERSON_FACTS_DERIVED_REASON,
  SeparationsKualiFinalizationTestTargetResolutionSchema,
  FINALIZATION_WORKFLOW,
  PERSON_LOOKUP_WORKFLOW,
  resolveSeparationsKualiFinalizationTestTarget,
  resolveSeparationsTestTarget,
  SEPARATIONS_WORKFLOW,
  TEST_TARGET_REGISTRY,
  TestTargetWorkflowArmsSchema,
  type TestTargetRegistryEntry,
} from "../../../src/backend/app/registries/test-target-registry.js";
import { testDataInputSource } from "../../integration/backend/app/registries/test-target-registry/test-data-source.js";


const SOLE_SUBJECT_LABEL = "finalization-canary";
const SOLE_SUBJECT_LAST_OBSERVED = "2026-09-08";


const DOCUMENT_NUMBER_REFERENCE = {
  name: "separationsKualiFinalizationCanaryDocumentNumber",
} as const;

const ARM_WORKFLOW_KEYS = Object.keys(TestTargetWorkflowArmsSchema.shape) as readonly (keyof typeof TestTargetWorkflowArmsSchema.shape)[];
assert.deepEqual([...ARM_WORKFLOW_KEYS].sort(), [FINALIZATION_WORKFLOW, PERSON_LOOKUP_WORKFLOW, SEPARATIONS_WORKFLOW].sort());


const PERSON_LOOKUP_SUBJECT_LABEL = "person-lookup-canary";
const EID_REFERENCE = {
  name: "personLookupCanaryEid",
} as const;

function armsDeclaredBy(target: TestTargetRegistryEntry): readonly Readonly<{ workflow: string; kind: string }>[] {
  return ARM_WORKFLOW_KEYS.flatMap((workflow) => {
    const arm = target.workflows[workflow];
    return arm === undefined ? [] : [{ workflow, kind: arm.kind }];
  });
}

describe("test target registry architecture", () => {

  it("commits exactly two subjects: the Kuali document addressable by both separations workflows, and the person-lookup live-read canary", () => {

    assert.deepEqual(TEST_TARGET_REGISTRY.targets.map(({ label }) => label), [SOLE_SUBJECT_LABEL, PERSON_LOOKUP_SUBJECT_LABEL]);
    const person = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === PERSON_LOOKUP_SUBJECT_LABEL);
    assert.deepEqual(person === undefined ? undefined : armsDeclaredBy(person), [{ workflow: PERSON_LOOKUP_WORKFLOW, kind: "search-by-eid" }]);
    assert.deepEqual(person?.workflows[PERSON_LOOKUP_WORKFLOW]?.publicInput.subject, { state: "configured", reference: EID_REFERENCE });
    const [subject] = TEST_TARGET_REGISTRY.targets;
    if (subject === undefined) throw new Error("the committed registry holds no subject");
    assert.deepEqual(armsDeclaredBy(subject), [
      { workflow: SEPARATIONS_WORKFLOW, kind: "full-chain-dry-run" },
      { workflow: FINALIZATION_WORKFLOW, kind: "ordinary" },
    ]);

    assert.deepEqual(subject.workflows[SEPARATIONS_WORKFLOW]?.publicInput.document, {
      state: "configured",
      reference: DOCUMENT_NUMBER_REFERENCE,
    });
    assert.deepEqual(subject.workflows[FINALIZATION_WORKFLOW]?.publicInput, {});
  });

  it("pins the sole subject's current availability and retained historical failed rehearsal", () => {
    const canary = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === SOLE_SUBJECT_LABEL);
    assert.equal(canary?.availability.state, "available");
    assert.equal(canary?.availability.lastObserved, SOLE_SUBJECT_LAST_OBSERVED);
    assert.match(String(canary?.availability.reason), /EMPLOYEE_NOT_FOUND/u);
    assert.match(String(canary?.availability.reason), /0\/0\/0/u);

    assert.deepEqual(canary?.workflows[FINALIZATION_WORKFLOW]?.publicInput, {});
    const pending = canary?.workflows[FINALIZATION_WORKFLOW]?.pending ?? {};
    // Zod retains explicit undefined keys; only defined reasons mark pending leaves.
    assert.deepEqual(
      Object.entries(pending)
        .filter(([, reason]) => reason !== undefined)
        .map(([key]) => key),
      ["transactionNumber", "timekeeperComments", "terminationEffectiveDate"],
    );
  });

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

  it("keeps every person-valued canonical leaf out of public config", () => {
    const publicKeys = TEST_TARGET_REGISTRY.targets.flatMap(({ workflows }) => [
      ...Object.keys(workflows["separations-kuali-finalization"]?.publicInput ?? {}),
      ...Object.keys(workflows.separations?.publicInput ?? {}),
    ]);
    for (const field of ["employeeName", "emplId", "documentEid", "timekeeperName"]) {
      assert.equal(publicKeys.includes(field), false, `${field} is committed as public config`);
    }
  });

  it("binds the canary's ONE document number to its exact registered reference", () => {
    const [subject] = TEST_TARGET_REGISTRY.targets;
    const chain = subject?.workflows[SEPARATIONS_WORKFLOW];
    if (chain === undefined) throw new Error("the sole canary has no separations chain arm");
    if (chain.publicInput.document.state !== "configured") {
      throw new Error("the sole canary commits no configured document reference");
    }
    assert.deepEqual(chain.publicInput.document.reference, DOCUMENT_NUMBER_REFERENCE);

    assert.equal(Object.hasOwn(subject?.workflows[FINALIZATION_WORKFLOW] ?? {}, "secretInput"), false);

    assert.deepEqual([...TEST_DATA_INPUT_NAMES], [DOCUMENT_NUMBER_REFERENCE.name, EID_REFERENCE.name]);
    assert.equal(TestDataInputValueSchemas[DOCUMENT_NUMBER_REFERENCE.name].safeParse("4999").success, true);
    assert.equal(TestDataInputValueSchemas[DOCUMENT_NUMBER_REFERENCE.name].safeParse("10800000x").success, false);
    assert.equal(TestDataInputValueSchemas[EID_REFERENCE.name].safeParse("10800000").success, true);
    assert.equal(TestDataInputValueSchemas[EID_REFERENCE.name].safeParse("4999").success, false);
    assert.deepEqual([...RETIRED_TEST_TARGET_PROTECTED_NAMES], [...TEST_DATA_INPUT_NAMES]);
    for (const name of TEST_DATA_INPUT_NAMES) {
      assert.equal(ProtectedSettingsNameSchema.safeParse(name).success, false, `${name} left protected Settings`);
    }
  });

  it("exports a recursively frozen committed registry", () => {
    assert.equal(Object.isFrozen(TEST_TARGET_REGISTRY), true);
    assert.equal(Object.isFrozen(TEST_TARGET_REGISTRY.targets), true);
    assert.equal(TEST_TARGET_REGISTRY.targets.every((target) =>
      Object.isFrozen(target) && Object.isFrozen(target.workflows)), true);
    const document = TEST_TARGET_REGISTRY.targets[0]?.workflows[SEPARATIONS_WORKFLOW]?.publicInput.document;
    assert.equal(Object.isFrozen(document), true);
    if (document?.state !== "configured") {
      throw new Error("the committed canary does not carry a configured document reference");
    }
    assert.equal(Object.isFrozen(document.reference), true);
  });

  it("commits no Kuali document number in either separations arm", () => {
    const subject = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === SOLE_SUBJECT_LABEL);
    const serialized = JSON.stringify(subject?.workflows ?? {});
    assert.equal(/\b4\d{3}\b/u.test(serialized), false);
    assert.equal(Object.hasOwn(subject?.workflows[FINALIZATION_WORKFLOW]?.publicInput ?? {}, "documentNumber"), false);
  });

  it("gives every entry an owning workflow the build manifest actually built", () => {
    const built = new Set<string>(GENERATED_BUILD_MANIFEST.workflows.map(({ id }) => id));
    for (const { label, workflows } of TEST_TARGET_REGISTRY.targets) {
      for (const workflow of Object.keys(workflows)) {
        assert.equal(built.has(workflow), true, `test target ${label} names unbuilt workflow ${workflow}`);
      }
    }
  });

  it("pins every separations chain subject to doc 03.3's kind and availability", () => {
    const rows = TEST_TARGET_REGISTRY.targets
      .flatMap((target) => {
        const chain = target.workflows.separations;
        return chain === undefined ? [] : [{
          label: target.label,
          kind: chain.kind,
          state: target.availability.state,
          lastObserved: target.availability.lastObserved,

          document: chain.publicInput.document.state === "configured"
            ? chain.publicInput.document.reference.name
            : "none",
        }];
      })
      .sort((left, right) => left.label.localeCompare(right.label));
    assert.deepEqual(rows, [
      {
        label: SOLE_SUBJECT_LABEL,
        kind: "full-chain-dry-run",
        state: "available",
        lastObserved: SOLE_SUBJECT_LAST_OBSERVED,
        document: DOCUMENT_NUMBER_REFERENCE.name,
      },
    ]);
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
        reRead: { ordinal: 2, reason: "Task 1.6.7 full rehearsal after pending-set observation repair; failed reread 1 retained." },
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

  it("gives every entry the purpose the registry exists to record", () => {
    for (const { label, purpose } of TEST_TARGET_REGISTRY.targets) {
      assert.equal(purpose.length > 0, true, `test target ${label} records no purpose`);
    }
  });
});
