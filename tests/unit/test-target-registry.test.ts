import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  FINALIZATION_PERSON_FACTS_DERIVED_REASON,
  parseTestTargetRegistry,
  SeparationsKualiFinalizationPendingSchema,
  resolvePersonLookupTestTarget,
  resolveSeparationsKualiFinalizationTestTarget,
  resolveSeparationsTestTarget,
  TEST_TARGET_REGISTRY,
  TestTargetWorkflowArmsSchema,
  SEPARATIONS_WORKFLOW,
  FINALIZATION_WORKFLOW,
  PERSON_LOOKUP_WORKFLOW,
  type TestTargetRegistryInput,
} from "../../src/control/test-target-registry.js";
import type { TestDataInputSource } from "../../src/domain/test-data.js";
import { createTestDataInputSource, testDataLocalPath } from "../../src/control/test-data.js";
import { testDataInputSource } from "./helpers/test-data-source.js";

type TestTargetEntryInput = TestTargetRegistryInput["targets"][number];
type FinalizationArmInput = NonNullable<TestTargetEntryInput["workflows"]["separations-kuali-finalization"]>;
type ChainArmInput = NonNullable<TestTargetEntryInput["workflows"]["separations"]>;

/**
 * The ONE test-target value that crosses the closed secret boundary (D300): the
 * canary's Kuali document number, bound to its test-data-local name. The
 * three person references D286 registered are retired, so no fixture in this
 * file can supply an EID or a display name through the registry at all.
 */
const DOCUMENT_NUMBER_SECRET = {
  name: "separationsKualiFinalizationCanaryDocumentNumber",
} as const;
/** The fixture subject's number, configured in ignored config/test-data.local.json (D341). */
const FIXTURE_DOCUMENT_NUMBER = "4502";
const FIXTURE_CONFIGURED_SOURCE = testDataInputSource({
  separationsKualiFinalizationCanaryDocumentNumber: FIXTURE_DOCUMENT_NUMBER,
});
/** A private canary-shaped value, supplied only by the test protected store. */
const COMMITTED_DOCUMENT_NUMBER = "4999";
const COMMITTED_CONFIGURED_SOURCE = testDataInputSource({
  separationsKualiFinalizationCanaryDocumentNumber: COMMITTED_DOCUMENT_NUMBER,
});

/**
 * The subject-level identity every fixture below starts from. It declares NO
 * workflow arm — each fixture adds exactly the arm(s) its behaviour needs, so a
 * case about the finalization arm cannot accidentally be carried by the chain
 * arm or the other way round.
 */
const SUBJECT = {
  label: "fixture-target",
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
  purpose: "The registry fixture every parse/resolve case in this file starts from.",
} as const;

/** Every finalization canonical leaf a live read can observe, minus the four person values. */
const OBSERVED_PUBLIC_INPUT: FinalizationArmInput["publicInput"] = {
  actionId: "0123456789abcdef01234567",
  documentNumber: "4444",
  emplIdSource: "document-eid",
  ucpathDeptId: { state: "present", value: "000412" },
  ucpathDepartment: { state: "present", value: "HOUSING/DINING/HOSPITALITY" },
  observedDepartmentOptions: ["- - -", "000412 - Housing/Dining/Hospitality"],
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  lastDayWorked: "06/09/2026",
  separationDate: "06/10/2026",
  terminationEffectiveDate: "06/11/2026",
  observedExistingComments: "",
};

/**
 * The observed leaves minus `terminationEffectiveDate` — the one pending leaf
 * `OBSERVED_PUBLIC_INPUT` above actually carries. The other two pending leaves
 * (`transactionNumber`, `timekeeperComments`) were never in it, so nothing has
 * to be removed for them: this is the input a case may declare EVERY pending
 * field against without tripping the both-observed-and-pending refusal.
 */
const PENDING_FREE_PUBLIC_INPUT: FinalizationArmInput["publicInput"] = (() => {
  const { terminationEffectiveDate: _staged, ...rest } = OBSERVED_PUBLIC_INPUT;
  return rest;
})();

/** The same leaves plus the two a run only has once ② has filed and ③ composed. */
const COMPLETE_PUBLIC_INPUT: FinalizationArmInput["publicInput"] = {
  ...OBSERVED_PUBLIC_INPUT,
  transactionNumber: "T009000001",
  timekeeperComments: "Synthetic finalization comment.",
};

/**
 * The standalone finalization arm is an OBSERVATION record since D300: it holds
 * no secret input at all, and no completeness of its public leaves can make its
 * resolver answer `ready`.
 */
const FINALIZATION_ARM: FinalizationArmInput = {
  kind: "ordinary",
  publicInput: COMPLETE_PUBLIC_INPUT,
};

const CHAIN_ARM: ChainArmInput = {
  kind: "full-chain-dry-run",
  publicInput: { document: { state: "configured", reference: DOCUMENT_NUMBER_SECRET } },
};

const AVAILABLE = {
  state: "available",
  lastObserved: "2026-08-25",
  reason: "Synthetic complete fixture.",
} as const;

function registry(targets: TestTargetRegistryInput["targets"]): TestTargetRegistryInput {
  return { schemaVersion: 2, targets };
}

/**
 * The shape a REJECTION case needs: the compiler refuses an unknown arm, an EID
 * in public input or a retired `secretInput` block, which is half the point —
 * so the invalid cases go in as data and are judged by the parser, exactly as
 * config is.
 */
function rawRegistry(targets: readonly unknown[]): unknown {
  return { schemaVersion: 2, targets };
}

function finalizationSubject(
  overrides: Partial<TestTargetEntryInput> = {},
): TestTargetEntryInput {
  return { ...SUBJECT, workflows: { "separations-kuali-finalization": FINALIZATION_ARM }, ...overrides };
}

function chainSubject(
  overrides: Partial<TestTargetEntryInput> = {},
): TestTargetEntryInput {
  return { ...SUBJECT, workflows: { separations: CHAIN_ARM }, ...overrides };
}

/** A test-data input source whose every read is recorded by input name. */
function recordingInputSource(values: Parameters<typeof testDataInputSource>[0]): {
  readonly source: TestDataInputSource;
  readonly read: readonly string[];
} {
  const read: string[] = [];
  const delegate = testDataInputSource(values);
  const source: TestDataInputSource = { read: (name) => {
    read.push(name);
    return delegate.read(name);
  } };
  return { source, read };
}

/** A source whose private file is invalid: the loader already refused it by key, never by value. */
const privateRoots: string[] = [];
afterEach(() => { for (const root of privateRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A REAL private file (0600) carrying one configured value, read through the production loader. */
function privateFileSource(name: string, value: string): TestDataInputSource {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-test-target-private-"));
  privateRoots.push(root);
  mkdirSync(join(root, "config"));
  const path = testDataLocalPath(root);
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, inputs: {
    [name]: { valueId: "10000000-0000-4000-8000-00000000000a", value, updatedAt: "2026-09-07T00:00:00.000Z" },
  }, files: {} })}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return createTestDataInputSource(path);
}

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
    // `declaredWorkflows` (internal) now derives its fixed order from
    // `TestTargetWorkflowArmsSchema.shape` rather than a hand-written pair, so a
    // third arm added to the schema is picked up automatically. This pins the
    // source of that order directly, and pins the committed canary's own parsed
    // key order (zod builds a parsed object by iterating the shape's keys, so
    // this is UNSORTED on purpose) to the same sequence — together they prove
    // `declaredWorkflows`'s output for this subject is
    // `[separations, separations-kuali-finalization]`, not an arbitrary sort.
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
    // D300: a literal here would let a COMMIT choose the live subject. The
    // reference makes ignored config/test-data.local.json the only place that can.
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
      reason: "blocked: needs finalization-canary for separations-kuali-finalization; transactionNumber not yet filed (UCPath filing \u2461 pending); timekeeperComments not authored (the composed chain's comments node composes it); terminationEffectiveDate not observed on the form; the chain's dates node derives it (separation date + 1), last observed 2026-09-03",
    });
    // Since D300 this resolver cannot spend a credential because it cannot be
    // HANDED one: it takes the registry and the label, and nothing else.
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
    // The three person references D286 registered are retired, not re-pointed:
    // none of their names may survive anywhere in the committed registry.
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

describe("test target registry parsing", () => {
  it("rejects the retired schemaVersion 1 shape", () => {
    assert.throws(() => parseTestTargetRegistry({ schemaVersion: 1, targets: [finalizationSubject()] }));
  });

  it("rejects a subject that declares no workflow arm at all", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([{ ...SUBJECT, workflows: {} }])),
      /fixture-target|at least one/,
    );
  });

  it("rejects an unknown workflow arm", () => {
    assert.throws(() => parseTestTargetRegistry(rawRegistry([
      { ...SUBJECT, workflows: { "person-lookup": CHAIN_ARM } },
    ])));
  });

  it("rejects a pending field that the same arm also declares as observed", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([finalizationSubject({
        workflows: {
          "separations-kuali-finalization": {
            ...FINALIZATION_ARM,
            pending: { transactionNumber: "not filed" },
          },
        },
      })])),
      /fixture-target.*transactionNumber.*both/,
    );
  });

  it("rejects a pending block that declares no field at all", () => {
    // `pending: {}` parses as "every leaf is optional and none is declared",
    // which reads as a truthful claim and makes none: the arm would then
    // resolve past the pending gate and report the standing refusal as though
    // nothing were outstanding. An arm with nothing pending omits the block.
    //
    // `{ transactionNumber: undefined }` is the SAME empty claim spelled with a
    // key, and it is the one that got through: zod's parsed object still OWNS
    // that key, so a refine counting `Object.keys` saw one field and passed it.
    // Both spellings must be refused with the refine's own message — matching
    // only /pending/ would pass on any message mentioning the word.
    for (const pending of [{}, { transactionNumber: undefined }]) {
      assert.throws(
        () => parseTestTargetRegistry(registry([finalizationSubject({
          workflows: {
            "separations-kuali-finalization": { ...FINALIZATION_ARM, pending },
          },
        })])),
        /pending declares no field/,
        `pending ${JSON.stringify(Object.keys(pending))} was accepted`,
      );
    }
  });

  it("rejects duplicate labels by name", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([finalizationSubject(), finalizationSubject()])),
      /test target registry repeats label fixture-target/,
    );
  });

  it("rejects unknown keys at every nested config boundary", () => {
    assert.throws(() => parseTestTargetRegistry(rawRegistry([{
      ...finalizationSubject(),
      availability: { ...SUBJECT.availability, guessedReady: true },
    }])));
  });

  it("rejects committing an EID inside public input", () => {
    assert.throws(() => parseTestTargetRegistry(rawRegistry([{
      ...SUBJECT,
      workflows: {
        "separations-kuali-finalization": {
          ...FINALIZATION_ARM,
          publicInput: { ...COMPLETE_PUBLIC_INPUT, emplId: "10800000" },
        },
      },
    }])));
  });

  it("rejects committing an employee display name inside public input", () => {
    assert.throws(() => parseTestTargetRegistry(rawRegistry([{
      ...SUBJECT,
      workflows: {
        "separations-kuali-finalization": {
          ...FINALIZATION_ARM,
          publicInput: { ...COMPLETE_PUBLIC_INPUT, employeeName: "Person, Private" },
        },
      },
    }])));
  });

  it("rejects committing a timekeeper display name inside public input", () => {
    assert.throws(() => parseTestTargetRegistry(rawRegistry([{
      ...SUBJECT,
      workflows: {
        "separations-kuali-finalization": {
          ...FINALIZATION_ARM,
          publicInput: { ...COMPLETE_PUBLIC_INPUT, timekeeperName: "Private Timekeeper" },
        },
      },
    }])));
  });

  it("refuses the retired secretInput block on the finalization arm", () => {
    // D300 deleted the three person references AND the block that carried them.
    // A config that still declares one is not "extra data the parser ignores":
    // it is a claim that the registry supplies person values, and the strict
    // arm schema must refuse it by name.
    assert.throws(
      () => parseTestTargetRegistry(rawRegistry([{
        ...SUBJECT,
        workflows: {
          "separations-kuali-finalization": {
            ...FINALIZATION_ARM,
            secretInput: {
              emplId: {
                name: "separationsKualiFinalizationCanaryEid",
                env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID",
              },
            },
          },
        },
      }])),
      /secretInput/,
    );
  });

  it("refuses a chain arm that commits a document NUMBER instead of the closed reference", () => {
    // The retired `{ state: "present", documentNumber }` shape is exactly the
    // commit-chooses-the-subject hazard D300 closed; the discriminated union
    // must not still accept it.
    assert.throws(() => parseTestTargetRegistry(rawRegistry([{
      ...SUBJECT,
      workflows: { separations: { kind: "full-chain-dry-run", publicInput: { document: { state: "present", documentNumber: "4537" } } } },
    }])));
    assert.throws(() => parseTestTargetRegistry(rawRegistry([{
      ...SUBJECT,
      workflows: {
        separations: {
          kind: "full-chain-dry-run",
          publicInput: { document: { state: "configured", reference: DOCUMENT_NUMBER_SECRET, documentNumber: "4537" } },
        },
      },
    }])));
  });

  it("refuses a chain reference that carries a legacy environment key or mismatched name", () => {
    for (const reference of [
      { name: DOCUMENT_NUMBER_SECRET.name, env: "HRAUTO_ARBITRARY_DOCUMENT_NUMBER" },
      { name: "separationsKualiFinalizationCanaryEid" },
    ]) {
      assert.throws(() => parseTestTargetRegistry(rawRegistry([{
        ...SUBJECT,
        workflows: { separations: { kind: "full-chain-dry-run", publicInput: { document: { state: "configured", reference } } } },
      }])), (error: unknown) => {
        assert.equal(error instanceof Error, true, `${JSON.stringify(reference)} was accepted`);
        return true;
      });
    }
  });

  it("recursively freezes parsed registries", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject(), finalizationSubject({ label: "fixture-finalization" })]));
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.targets), true);
    assert.equal(Object.isFrozen(parsed.targets[0]?.availability), true);
    assert.equal(Object.isFrozen(parsed.targets[0]?.workflows), true);
    const chain = parsed.targets[0]?.workflows[SEPARATIONS_WORKFLOW];
    assert.equal(Object.isFrozen(chain), true);
    assert.equal(Object.isFrozen(chain?.publicInput), true);
    assert.equal(Object.isFrozen(chain?.publicInput.document), true);
    if (chain?.publicInput.document.state !== "configured") {
      throw new Error("the recursive-freeze fixture does not carry a configured document reference");
    }
    assert.equal(Object.isFrozen(chain.publicInput.document.reference), true);
    const finalization = parsed.targets[1]?.workflows[FINALIZATION_WORKFLOW];
    assert.equal(Object.isFrozen(finalization), true);
    assert.equal(Object.isFrozen(finalization?.publicInput), true);
  });

  it("rejects a manifest kind that disagrees with the label's arm", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([finalizationSubject()]), [{
        workflow: "separations-kuali-finalization",
        cases: [{ subjectLabel: "fixture-target", subjectKind: "no-active-job" }],
      }]),
      /fixture-target.*kind ordinary.*manifest.*no-active-job/,
    );
  });

  it("rejects a manifest workflow the label declares no arm for", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([finalizationSubject()]), [{
        workflow: "separations",
        cases: [{ subjectLabel: "fixture-target", subjectKind: "full-chain-dry-run" }],
      }]),
      /fixture-target declares no separations arm.*separations-kuali-finalization/,
    );
  });

  it("refuses a manifest case for EITHER modelled workflow whose arm is absent", () => {
    // Both arms of the workflow→arm lookup, from both sides: the chain subject
    // declares no finalization arm and the finalization subject declares no
    // chain arm. A lookup that answered with the OTHER workflow's arm would
    // compare the manifest against the wrong kind and pass silently here.
    assert.throws(
      () => parseTestTargetRegistry(registry([chainSubject()]), [{
        workflow: "separations-kuali-finalization",
        cases: [{ subjectLabel: "fixture-target", subjectKind: "ordinary" }],
      }]),
      /fixture-target declares no separations-kuali-finalization arm; it declares separations/,
    );
    assert.throws(
      () => parseTestTargetRegistry(registry([finalizationSubject()]), [{
        workflow: "separations",
        cases: [{ subjectLabel: "fixture-target", subjectKind: "full-chain-dry-run" }],
      }]),
      /fixture-target declares no separations arm; it declares separations-kuali-finalization/,
    );
  });

  it("accepts a chain manifest case that matches the subject's own chain arm", () => {
    // The matching half of the same lookup: the chain arm must be REACHED, not
    // merely absent, or the case above would pass on a lookup that never
    // returns a chain arm at all.
    const parsed = parseTestTargetRegistry(registry([chainSubject()]), [{
      workflow: "separations",
      cases: [{ subjectLabel: "fixture-target", subjectKind: "full-chain-dry-run" }],
    }]);
    assert.equal(parsed.targets[0]?.workflows.separations?.kind, "full-chain-dry-run");
  });

  it("blames the manifest, not the entry, for a workflow no resolver models", () => {
    // An unmodelled workflow id is a defect in the MANIFEST; saying the entry
    // "declares no <workflow> arm" would send the reader to config to add an arm
    // for a workflow that has no resolver at all.
    assert.throws(
      () => parseTestTargetRegistry(registry([finalizationSubject()]), [{
        workflow: "i9-lookup",
        cases: [{ subjectLabel: "fixture-target", subjectKind: "ordinary" }],
      }]),
      /no resolver models workflow i9-lookup; modelled: separations, separations-kuali-finalization, person-lookup/,
    );
  });

  it("rejects a manifest label absent from the registry", () => {
    assert.throws(
      () => parseTestTargetRegistry(registry([finalizationSubject()]), [{
        workflow: "separations-kuali-finalization",
        cases: [{ subjectLabel: "missing-target", subjectKind: "ordinary" }],
      }]),
      /missing-target.*no test target registry entry/,
    );
  });

  it("accepts a manifest case that matches the label's own arm", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject()]), [{
      workflow: "separations-kuali-finalization",
      cases: [{ subjectLabel: "fixture-target", subjectKind: "ordinary" }],
    }]);
    assert.equal(parsed.targets.length, 1);
  });
});

describe("separations-kuali-finalization test target resolution", () => {
  it("states the standing refusal in the words the resolver reports", () => {
    // The constant the resolver and its readers share is pinned to its own
    // TEXT here, so the exact-reason assertions below cannot be satisfied by a
    // constant that quietly stopped saying anything.
    assert.equal(
      FINALIZATION_PERSON_FACTS_DERIVED_REASON,
      "employee name, EID and timekeeper name are derived live by the composed separations chain "
      + "and are never registry- or protected-settings-supplied (D300); run the composed separations workflow",
    );
  });

  it("blocks BY NAME even when every public leaf a live read can supply is present", () => {
    // D300: completeness of the public record can no longer produce `ready`.
    // The standalone harness holds no person facts, so its whole vocabulary is
    // `blocked` — and it says why, with the subject's own observation date.
    const parsed = parseTestTargetRegistry(registry([finalizationSubject({ availability: AVAILABLE })]));

    assert.deepEqual(resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target"), {
      state: "blocked",
      label: "fixture-target",
      reason: "blocked: needs fixture-target for separations-kuali-finalization; "
        + `${FINALIZATION_PERSON_FACTS_DERIVED_REASON}, last observed 2026-08-25`,
    });
  });

  it("blocks rather than defects when the public record is INCOMPLETE", () => {
    // The old resolver assembled a canonical input and threw a registry defect
    // for a missing undeclared leaf. It no longer parses one at all, so an
    // incomplete observation record must still answer with the standing public
    // refusal — never an exception a caller reads as "the registry is wrong".
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
    // The resolver's report order must be DERIVED from the pending schema. A
    // key the schema declares but the report order omits would drop out of the
    // reason entirely and leave the operator reading the standing refusal as
    // the whole story, so the pin walks the schema itself rather than a copy of
    // its keys.
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
    // The resolver's whole vocabulary is `blocked` since D300, so there is no
    // other state to narrow away here — the reason IS the report.
    const result = resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target");
    assert.equal(result.state, "blocked");
    for (const field of declared) {
      assert.match(result.reason, new RegExp(`${field} ${field} fixture reason`));
    }
  });
});

describe("separations chain test target resolution", () => {
  it("resolves an available chain subject through the descriptor's own start box", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })]));

    assert.deepEqual(resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE), {
      state: "ready",
      label: "fixture-target",
      // The document number is the box's ONE varying value, and it arrives from
      // ignored config/test-data.local.json through the arm's closed reference;
      // The server planner admits the protected timekeeper and applies
      // ingress defaults once after this readiness check.
      // Nothing here is authored by the resolver.
      protectedBindings: [{ kind: "test-data-local", inputPath: "documentNumber",
        name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: "00000000-0000-4000-8000-000000000010" }],
      canonicalInput: {
        documentNumber: FIXTURE_DOCUMENT_NUMBER,
      },
    });
  });

  it("reads the number once through the test-data-local source", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })]));
    const { source, read } = recordingInputSource({
      separationsKualiFinalizationCanaryDocumentNumber: FIXTURE_DOCUMENT_NUMBER,
    });
    const result = resolveSeparationsTestTarget(parsed, "fixture-target", source);
    assert.equal(result.state, "ready");
    assert.deepEqual(read, ["separationsKualiFinalizationCanaryDocumentNumber"]);
  });

  it("blocks BY NAME when the operator has configured no number", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })]));
    assert.deepEqual(resolveSeparationsTestTarget(parsed, "fixture-target", testDataInputSource()), {
      state: "blocked",
      label: "fixture-target",
      reason: "blocked: needs fixture-target; its Kuali document number is not configured — "
        + `set ${DOCUMENT_NUMBER_SECRET.name} in config/test-data.local.json (D341)`,
    });
  });

  it("defects by reference and key — never by value — on a malformed configured number", () => {
    // The value is judged by the SAME `KualiDocumentNumberSchema` the start box
    // applies (3-8 digits) when the private file loads, so what the resolver
    // accepts is exactly what an operator could have typed. Each malformed value
    // below is written to a real 0600 private file and read through the
    // production loader: a DEFECT in local configuration surfaces as a
    // TestDataLocalConfigError, and the resolver's message may name the
    // reference and the key only. Any other source failure propagates unchanged.
    const parsed = parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })]));
    assert.throws(
      () => resolveSeparationsTestTarget(parsed, "fixture-target", { read: () => { throw new TypeError("unexpected source failure"); } }),
      (error: unknown) => error instanceof TypeError && (error).name !== "TestTargetRegistryDefectError",
    );
    for (const malformed of ["abc", "1", "123456789", "CANARY_PRIVATE_DOCUMENT_NUMBER"]) {
      assert.throws(
        () => resolveSeparationsTestTarget(parsed, "fixture-target", privateFileSource(DOCUMENT_NUMBER_SECRET.name, malformed)),
        (error: unknown) => {
          assert.equal((error as Error).name, "TestTargetRegistryDefectError");
          const diagnostic = String(error);
          assert.match(diagnostic, /fixture-target marked available, last observed 2026-08-25/);
          assert.match(diagnostic, new RegExp(`document-number reference ${DOCUMENT_NUMBER_SECRET.name}`));
          assert.match(diagnostic, /config\/test-data\.local\.json/u);
          assert.match(diagnostic, /TestDataLocalConfigError/u);
          assert.equal(diagnostic.includes(malformed), false, `defect retained ${malformed}`);
          return true;
        },
        malformed,
      );
    }
  });

  it("blocks a chain label the registry does not carry", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject()]));
    assert.deepEqual(resolveSeparationsTestTarget(parsed, "unmapped-chain-target", FIXTURE_CONFIGURED_SOURCE), {
      state: "blocked",
      label: "unmapped-chain-target",
      reason: "blocked: needs unmapped-chain-target",
    });
  });

  it("blocks gone and unknown chain subjects with the registry's own dated claim", () => {
    const states = ["gone", "unknown"] as const;
    const results = states.map((state) => {
      const parsed = parseTestTargetRegistry(registry([chainSubject({
        availability: { state, lastObserved: "2026-08-19", reason: `${state} fixture` },
      })]));
      // A perfectly valid number is configured: the dated availability claim
      // must still win, so a decayed subject never reads the private file.
      return resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE);
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

  it("refuses by name a label whose subject declares no chain arm", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject()]));
    assert.throws(
      () => resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE),
      (error: unknown) => {
        // The refusal must be the registry's own defect type, not a bare Error:
        // a caller distinguishing "mis-addressed request" from "decayed canary"
        // reads the NAME, and a message regex alone would pass on either.
        assert.equal((error as Error).name, "TestTargetRegistryDefectError");
        assert.match(
          String(error),
          /fixture-target declares no separations arm; it declares separations-kuali-finalization/,
        );
        return true;
      },
    );
  });

  it("fails a falsely available chain subject that records no document", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject({
      availability: AVAILABLE,
      workflows: {
        separations: {
          kind: "controlled-commit-candidate",
          publicInput: { document: { state: "absent", reason: "The only mapped subject lost its row." } },
        },
      },
    })]));
    assert.throws(
      () => resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE),
      /fixture-target marked available, last observed 2026-08-25: no Kuali document exists to run: The only mapped subject lost its row\./,
    );
  });
});

describe("the person-lookup live-read resolver (D318)", () => {
  const PERSON_LOOKUP_LABEL = "person-lookup-canary";
  const EID_NAME = "personLookupCanaryEid";

  it("commits the canary's EID as a closed reference, never as a value", () => {
    const canary = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === PERSON_LOOKUP_LABEL);
    assert.deepEqual(canary?.workflows[PERSON_LOOKUP_WORKFLOW]?.publicInput.subject, {
      state: "configured",
      reference: { name: EID_NAME },
    });
    assert.equal(canary?.availability.state, "available");
  });

  it("blocks by name when the EID is not configured and reads the store once", () => {
    const { source, read } = recordingInputSource({});
    const resolution = resolvePersonLookupTestTarget(TEST_TARGET_REGISTRY, PERSON_LOOKUP_LABEL, source);
    assert.deepEqual(resolution, {
      state: "blocked",
      label: PERSON_LOOKUP_LABEL,
      reason: `blocked: needs ${PERSON_LOOKUP_LABEL}; its UCPath employee id is not configured — set ${EID_NAME} in config/test-data.local.json (D341)`,
    });
    assert.deepEqual(read, ["personLookupCanaryEid"]);
  });

  it("resolves the configured EID through the person-lookup start box into the exact canonical input", () => {
    const resolution = resolvePersonLookupTestTarget(
      TEST_TARGET_REGISTRY,
      PERSON_LOOKUP_LABEL,
      testDataInputSource({ personLookupCanaryEid: "10800000" }),
    );
    assert.deepEqual(resolution, {
      state: "ready",
      label: PERSON_LOOKUP_LABEL,
      protectedBindings: [{ kind: "test-data-local", inputPath: "emplId",
        name: "personLookupCanaryEid", sourceId: "00000000-0000-4000-8000-000000000010" }],
      canonicalInput: { emplId: "10800000", keepNonHdh: false, includeCrmDates: false },
    });
  });

  it("names the reference and key, never the value, for a malformed EID", () => {
    assert.throws(
      () => resolvePersonLookupTestTarget(
        TEST_TARGET_REGISTRY,
        PERSON_LOOKUP_LABEL,
        privateFileSource("personLookupCanaryEid", "not-an-eid-99"),
      ),
      (error: unknown) => error instanceof Error
        && /employee-id reference personLookupCanaryEid is invalid in config\/test-data\.local\.json/u.test(error.message)
        && !error.message.includes("not-an-eid-99"),
    );
  });

  it("refuses a label that declares no person-lookup arm by name", () => {
    assert.throws(
      () => resolvePersonLookupTestTarget(TEST_TARGET_REGISTRY, "finalization-canary", testDataInputSource()),
      /test target finalization-canary declares no person-lookup arm; it declares separations, separations-kuali-finalization/u,
    );
  });
});
