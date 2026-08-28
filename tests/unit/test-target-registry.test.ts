import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  parseTestTargetRegistry,
  SeparationsKualiFinalizationPendingSchema,
  resolveSeparationsKualiFinalizationTestTarget,
  resolveSeparationsTestTarget,
  TEST_TARGET_REGISTRY,
  type TestTargetRegistryInput,
} from "../../src/control/test-target-registry.js";

type TestTargetEntryInput = TestTargetRegistryInput["targets"][number];
type FinalizationArmInput = NonNullable<TestTargetEntryInput["workflows"]["separations-kuali-finalization"]>;
type ChainArmInput = NonNullable<TestTargetEntryInput["workflows"]["separations"]>;

const EID_SECRET = {
  name: "separationsKualiFinalizationCanaryEid",
  env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID",
} as const;

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

/** Every finalization canonical leaf a live read can observe, minus the two EIDs. */
const OBSERVED_PUBLIC_INPUT: FinalizationArmInput["publicInput"] = {
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
const READY_PUBLIC_INPUT: FinalizationArmInput["publicInput"] = {
  ...OBSERVED_PUBLIC_INPUT,
  transactionNumber: "T009000001",
  timekeeperComments: "Synthetic finalization comment.",
};

const FINALIZATION_ARM: FinalizationArmInput = {
  kind: "ordinary",
  publicInput: READY_PUBLIC_INPUT,
  secretInput: {
    emplId: EID_SECRET,
    documentEid: { state: "present", eid: EID_SECRET },
  },
};

const CHAIN_ARM: ChainArmInput = {
  kind: "full-chain-dry-run",
  publicInput: { document: { state: "present", documentNumber: "4502" } },
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
 * The shape a REJECTION case needs: the compiler refuses an unknown arm or an
 * EID in public input, which is half the point — so the invalid cases go in as
 * data and are judged by the parser, exactly as config is.
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

/** An env whose every read is recorded, so "no secret was read" is provable. */
function recordingEnv(values: Record<string, string>): {
  readonly env: NodeJS.ProcessEnv;
  readonly read: readonly string[];
} {
  const read: string[] = [];
  const env = new Proxy({ ...values }, {
    get(target, property: string | symbol): unknown {
      if (typeof property === "string") read.push(property);
      return Reflect.get(target, property);
    },
  });
  return { env, read };
}

describe("the committed test target registry", () => {
  it("carries exactly one subject, doc 4537 under the label finalization-canary", () => {
    assert.deepEqual(TEST_TARGET_REGISTRY.targets.map(({ label }) => label), ["finalization-canary"]);
    assert.equal(TEST_TARGET_REGISTRY.schemaVersion, 2);
  });

  it("declares that one subject for BOTH workflow resolvers", () => {
    const [target] = TEST_TARGET_REGISTRY.targets;
    assert.deepEqual(Object.keys(target?.workflows ?? {}).sort(), [
      "separations",
      "separations-kuali-finalization",
    ]);
  });

  it("resolves the composed chain to doc 4537 through the descriptor's own start box", () => {
    assert.deepEqual(resolveSeparationsTestTarget(TEST_TARGET_REGISTRY, "finalization-canary"), {
      state: "ready",
      label: "finalization-canary",
      canonicalInput: {
        documentNumber: "4537",
        timekeeperName: "Julian Zaw",
        searchTimeoutMs: 15_000,
      },
    });
  });

  it("blocks the finalization arm on every leaf the live read could not supply", () => {
    const { env, read } = recordingEnv({ [EID_SECRET.env]: "MUST_NOT_BE_READ" });
    const result = resolveSeparationsKualiFinalizationTestTarget(
      TEST_TARGET_REGISTRY,
      "finalization-canary",
      env,
    );
    assert.deepEqual(result, {
      state: "blocked",
      label: "finalization-canary",
      reason: "blocked: needs finalization-canary for separations-kuali-finalization; "
        + "transactionNumber not yet filed (UCPath filing ② pending); "
        + "timekeeperComments not authored (the composed chain's comments node composes it); "
        + "terminationEffectiveDate not observed on the form; the chain's dates node derives it "
        + "(separation date + 1), last observed 2026-08-28",
    });
    // The pending check precedes every secret read, so a blocked subject never
    // spends a credential: the recording env proves the EID variable was never
    // even looked at.
    assert.equal(read.includes(EID_SECRET.env), false);
  });

  it("both resolvers answer under the same one label", () => {
    const chain = resolveSeparationsTestTarget(TEST_TARGET_REGISTRY, "finalization-canary");
    const finalization = resolveSeparationsKualiFinalizationTestTarget(
      TEST_TARGET_REGISTRY,
      "finalization-canary",
      {},
    );
    assert.equal(chain.label, "finalization-canary");
    assert.equal(finalization.label, "finalization-canary");
  });

  it("is recursively frozen, EID-free, and free of every retired label", () => {
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
    // resolve past the pending gate and defect at canonical parse. An arm with
    // nothing pending omits the block.
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
          publicInput: { ...READY_PUBLIC_INPUT, emplId: "10800000" },
        },
      },
    }])));
  });

  it("recursively freezes parsed registries", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject()]));
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.targets), true);
    assert.equal(Object.isFrozen(parsed.targets[0]?.availability), true);
    assert.equal(Object.isFrozen(parsed.targets[0]?.workflows), true);
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
        workflow: "person-lookup",
        cases: [{ subjectLabel: "fixture-target", subjectKind: "ordinary" }],
      }]),
      /no resolver models workflow person-lookup; modelled: separations, separations-kuali-finalization/,
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
  it("resolves a complete available subject into the exact canonical workflow input", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject({ availability: AVAILABLE })]));

    assert.deepEqual(
      resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
        [EID_SECRET.env]: "10800000",
      }),
      {
        state: "ready",
        label: "fixture-target",
        canonicalInput: {
          ...READY_PUBLIC_INPUT,
          observedDepartmentOptions: ["- - -", "000412 - Housing/Dining/Hospitality"],
          emplId: "10800000",
          documentEid: { state: "present", value: "10800000" },
        },
      },
    );
  });

  it("blocks an unknown requested label before resolution", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject()]));
    assert.deepEqual(resolveSeparationsKualiFinalizationTestTarget(parsed, "unmapped-target", {}), {
      state: "blocked",
      label: "unmapped-target",
      reason: "blocked: needs unmapped-target",
    });
  });

  it("refuses by name a label whose subject declares no finalization arm", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject()]));
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {}),
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

  it("blocks gone and unknown subjects before reading their EID secret", () => {
    const states = ["gone", "unknown"] as const;
    const results = states.map((state) => {
      const parsed = parseTestTargetRegistry(registry([finalizationSubject({
        availability: { state, lastObserved: "2026-08-19", reason: `${state} fixture` },
      })]));
      return resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
        [EID_SECRET.env]: "SECRET_THAT_MUST_NOT_BE_READ",
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
      resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
        [EID_SECRET.env]: "10800000",
      }),
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
    // key the schema declares but the report order omits would slip past
    // `blocked`, spend the EID secret and defect at canonical parse — the
    // blocked/defect inversion D284 forbids — so the pin walks the schema
    // itself rather than a copy of its keys.
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
    const result = resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
      [EID_SECRET.env]: "10800000",
    });
    if (result.state !== "blocked") throw new Error(`expected blocked, got ${result.state}`);
    for (const field of declared) {
      assert.match(result.reason, new RegExp(`${field} ${field} fixture reason`));
    }
  });

  it("fails an UNDECLARED missing public field by label and observation date", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject({
      availability: AVAILABLE,
      workflows: {
        "separations-kuali-finalization": { ...FINALIZATION_ARM, publicInput: OBSERVED_PUBLIC_INPUT },
      },
    })]));
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
        [EID_SECRET.env]: "10800000",
      }),
      /fixture-target marked available, last observed 2026-08-25:.*complete canonical input.*transactionNumber/s,
    );
  });

  it("fails a falsely available subject with a missing EID secret by label and observation date", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject({ availability: AVAILABLE })]));
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {}),
      /fixture-target marked available, last observed 2026-08-25:.*secret EID reference.*missing/,
    );
  });

  it("carries the secret failure's own name and message into the defect", () => {
    // A bare `catch {}` dropped WHY the read failed — a missing registry entry
    // and a malformed value became the same sentence. Both `SecretMissingError`
    // and `SecretSourceError` name the secret's registered name and its env-var
    // KEY, never its value, so the cause is safe to quote and hiding it only
    // costs the reader the diagnosis.
    const parsed = parseTestTargetRegistry(registry([finalizationSubject({ availability: AVAILABLE })]));
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
        [EID_SECRET.env]: "NOT_AN_EID",
      }),
      new RegExp(
        `secret EID reference ${EID_SECRET.name} is invalid `
        + `\\(SecretSourceError: test-target EID ${EID_SECRET.name} is invalid `
        + `in registered environment source ${EID_SECRET.env}\\)`,
      ),
    );
  });

  it("never retains an invalid EID secret value in the registry defect", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject({ availability: AVAILABLE })]));
    const eidCanary = "CANARY_REAL_EID_MUST_NOT_LEAK";
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(parsed, "fixture-target", {
        [EID_SECRET.env]: eidCanary,
      }),
      (error: unknown) => {
        assert.match(String(error), /fixture-target marked available, last observed 2026-08-25/);
        assert.equal(String(error).includes(eidCanary), false);
        return true;
      },
    );
  });
});

describe("separations chain test target resolution", () => {
  it("resolves an available chain subject through the descriptor's own start box", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })]));

    assert.deepEqual(resolveSeparationsTestTarget(parsed, "fixture-target"), {
      state: "ready",
      label: "fixture-target",
      // The document number is the box's ONE varying value; `timekeeperName`
      // rides in the descriptor's own `constants[]` and `searchTimeoutMs` is
      // the ingress default the real start path applies. Nothing here is
      // authored by the resolver.
      canonicalInput: {
        documentNumber: "4502",
        timekeeperName: "Julian Zaw",
        searchTimeoutMs: 15_000,
      },
    });
  });

  it("blocks a chain label the registry does not carry", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject()]));
    assert.deepEqual(resolveSeparationsTestTarget(parsed, "unmapped-chain-target"), {
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
      return resolveSeparationsTestTarget(parsed, "fixture-target");
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
      () => resolveSeparationsTestTarget(parsed, "fixture-target"),
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
      () => resolveSeparationsTestTarget(parsed, "fixture-target"),
      /fixture-target marked available, last observed 2026-08-25: no Kuali document exists to run: The only mapped subject lost its row\./,
    );
  });
});
