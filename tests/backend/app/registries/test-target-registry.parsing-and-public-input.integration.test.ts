import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import {
FINALIZATION_WORKFLOW,
parseTestTargetRegistry,
SEPARATIONS_WORKFLOW,
type TestTargetRegistryInput
} from "../../../../src/backend/app/registries/test-target-registry.js";

type TestTargetEntryInput = TestTargetRegistryInput["targets"][number];
type FinalizationArmInput = NonNullable<TestTargetEntryInput["workflows"]["separations-kuali-finalization"]>;
type ChainArmInput = NonNullable<TestTargetEntryInput["workflows"]["separations"]>;


const DOCUMENT_NUMBER_SECRET = {
  name: "separationsKualiFinalizationCanaryDocumentNumber",
} as const;


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

/** The same leaves plus the two a run only has once ② has filed and ③ composed. */
const COMPLETE_PUBLIC_INPUT: FinalizationArmInput["publicInput"] = {
  ...OBSERVED_PUBLIC_INPUT,
  transactionNumber: "T009000001",
  timekeeperComments: "Synthetic finalization comment.",
};


const FINALIZATION_ARM: FinalizationArmInput = {
  kind: "ordinary",
  publicInput: COMPLETE_PUBLIC_INPUT,
};

const CHAIN_ARM: ChainArmInput = {
  kind: "full-chain-dry-run",
  publicInput: { document: { state: "configured", reference: DOCUMENT_NUMBER_SECRET } },
};

function registry(targets: TestTargetRegistryInput["targets"]): TestTargetRegistryInput {
  return { schemaVersion: 2, targets };
}


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

/** A source whose private file is invalid: the loader already refused it by key, never by value. */
const privateRoots: string[] = [];
afterEach(() => { for (const root of privateRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

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

    const parsed = parseTestTargetRegistry(registry([chainSubject()]), [{
      workflow: "separations",
      cases: [{ subjectLabel: "fixture-target", subjectKind: "full-chain-dry-run" }],
    }]);
    assert.equal(parsed.targets[0]?.workflows.separations?.kind, "full-chain-dry-run");
  });

  it("blames the manifest, not the entry, for a workflow no resolver models", () => {

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
