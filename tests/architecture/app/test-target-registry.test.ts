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

/** The one separations subject D284 left; its number is private configuration (D300). */
const SOLE_SUBJECT_LABEL = "finalization-canary";
const SOLE_SUBJECT_LAST_OBSERVED = "2026-09-08";

/**
 * The ONE test-target reference the registry may commit (D300). The chain arm
 * names this reference and never a number, so choosing the live subject stays
 * in ignored config/test-data.local.json (D341) rather than in a commit.
 */
const DOCUMENT_NUMBER_REFERENCE = {
  name: "separationsKualiFinalizationCanaryDocumentNumber",
} as const;
/**
 * Every arm key `TestTargetWorkflowArmsSchema` declares, derived from the
 * schema itself rather than hardcoded, so a third arm added to the schema
 * cannot go silently uncased by this file. The sanity assertion right below
 * pins today's known set — if the schema ever grows a third key, that
 * assertion goes red and the growth becomes a visible, deliberate change here.
 */
const ARM_WORKFLOW_KEYS = Object.keys(TestTargetWorkflowArmsSchema.shape) as readonly (keyof typeof TestTargetWorkflowArmsSchema.shape)[];
assert.deepEqual([...ARM_WORKFLOW_KEYS].sort(), [FINALIZATION_WORKFLOW, PERSON_LOOKUP_WORKFLOW, SEPARATIONS_WORKFLOW].sort());

/** D318 — the second committed subject: the person-lookup live-read canary, ONE EID selected in ignored config/test-data.local.json (D341). */
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
    // D284: one label, one availability, one document — an arm per workflow,
    // never a second entry and never an alias. D318 adds the ONE other subject
    // kind the tree has: a person, for the transaction-free live-read arm.
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
    // D300: the chain arm commits the closed REFERENCE; the number itself is
    // selected in the operator's ignored local environment, never here.
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
    // The standalone harness remains blocked on upstream-authored leaves and
    // commits no observations from the retired document.
    assert.deepEqual(canary?.workflows[FINALIZATION_WORKFLOW]?.publicInput, {});
    const pending = canary?.workflows[FINALIZATION_WORKFLOW]?.pending ?? {};
    // The resolver judges a leaf pending by a DEFINED reason; zod keeps an
    // explicitly-`undefined` key on the parsed object, so `Object.keys` alone
    // would let an unreasoned key slip past this pin unnoticed. Filter to
    // entries whose reason is actually defined before asserting the set.
    assert.deepEqual(
      Object.entries(pending)
        .filter(([, reason]) => reason !== undefined)
        .map(([key]) => key),
      ["transactionNumber", "timekeeperComments", "terminationEffectiveDate"],
    );
  });

  it("blocks every currently declared label, and cannot be handed an environment at all", () => {
    // D300 removed the resolver's `env` parameter with its ready path: the
    // standalone harness reads no secret because it can receive none.
    assert.equal(resolveSeparationsKualiFinalizationTestTarget.length, 2);
    const resolutions = TEST_TARGET_REGISTRY.targets
      .filter((target) => target.workflows["separations-kuali-finalization"] !== undefined)
      .map(({ label }) => resolveSeparationsKualiFinalizationTestTarget(TEST_TARGET_REGISTRY, label));
    // `.every` on an empty array is vacuously true: assert WHICH labels the
    // filter yielded first, so a registry that stopped declaring a finalization
    // arm cannot pass this guard by resolving nothing.
    assert.deepEqual(resolutions.map(({ label }) => label), [SOLE_SUBJECT_LABEL]);
    assert.equal(resolutions.every(({ state }) => state === "blocked"), true);

    // Function.length is not sufficient: an accidentally reintroduced
    // `env = {}` parameter would still report length 2. Pass a third argument
    // through the runtime calling convention and make every possible
    // environment access throw. The standalone resolver must ignore it and
    // return the same blocked result.
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
    // The retired person block may not come back under any spelling: the
    // finalization arm is an observation record and carries no secret input.
    assert.equal(Object.hasOwn(subject?.workflows[FINALIZATION_WORKFLOW] ?? {}, "secretInput"), false);
    // Exactly TWO test-data inputs (D341): the separations canary's document
    // number (D300) and the person-lookup live-read canary's EID (D318) — each
    // a closed reference to one workflow's own ingress value, judged by that
    // workflow's own value schema, never a person value with a document-shaped
    // name or the reverse. Neither is a protected Settings name any more.
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
          // D300: the chain arm's document is a closed reference, so the row
          // reports the NAME the operator configures — never a number.
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

  /**
   * D284 left ONE subject, declared for BOTH resolvers, so the committed
   * registry can no longer exhibit a label that belongs to the other workflow.
   * What it must still exhibit is that each resolver answers from its OWN arm
   * and never guesses across the boundary. The refusal-BY-NAME path for a subject that lacks an arm is pinned in
   * tests/unit/test-target-registry.test.ts, which can construct such a subject
   * without committing a false one to config.
  */
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
      /never registry- or protected-settings-supplied \(D300\)/,
    );
  });

  it("gives every entry the purpose the registry exists to record", () => {
    for (const { label, purpose } of TEST_TARGET_REGISTRY.targets) {
      assert.equal(purpose.length > 0, true, `test target ${label} records no purpose`);
    }
  });
});
