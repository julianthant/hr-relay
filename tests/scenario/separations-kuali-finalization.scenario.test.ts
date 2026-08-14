/**
 * Executable scenarios for `separations-kuali-finalization` — separations
 * chunk 5a (`docs/migrations/separations.md` §4e), the Kuali finalization
 * write's CONTRACT-level arms.
 *
 * These are deliberately **not** graph walks. The descriptor, its transaction
 * node and the sequencer-driven beats land in 5b; what 5a owns is the behaviour
 * of the four tasks themselves, and the only way to observe "it refused" rather
 * than "it returned something plausible" is to run the real task
 * implementations against the deterministic driver.
 *
 * Fixture values are live doc 4510's, observed read-only 2026-08-12 (§9.3) —
 * the one document in the operator's Action List that carried a complete
 * finalization, which is exactly what a finalized document should look like
 * afterwards. The starting state is live doc 4502's: blank in five controls and
 * on Kuali's `- - -` sentinel in a sixth.
 *
 * The commit arms drive the task against a `commit` stub rather than through
 * the write sequencer. That is on purpose: the capability's unforgeability is
 * the DRIVER's invariant and is already pinned by
 * `tests/unit/kuali-transaction-proof.test.ts`, while what these arms falsify is
 * the TASK's mapping of the driver's answers onto durable error codes.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { mintMutationCapability } from "../../src/base/mutation-capability.js";
import { manualClock } from "../../src/domain/clock.js";
import { EidSchema, FingerprintSchema, PositiveIntSchema } from "../../src/domain/ids.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../src/domain/ui/kuali-rrss-document.js";
import {
  KualiSaveRefusedError,
  kualiFinalizationFields,
} from "../../src/domain/ui/kuali-separation-finalization.js";
import type {
  KualiFinalizationTarget,
  KualiFinalizationVariables,
} from "../../src/domain/ui/kuali-separation-finalization.js";
import type { KualiRrssDocumentDriver } from "../../src/domain/ui/kuali-rrss-document.js";
import {
  KUALI_FAKE_UNFINALIZED_FIELDS,
  createDeterministicKualiDriver,
  createKualiFakeWorld,
} from "../../src/stores/kuali/driver/fake.js";
import type { KualiFakeWorld } from "../../src/stores/kuali/driver/fake.js";
import { matchDepartmentOptionTask } from "../../src/stores/separations/tasks/match-department-option.js";
import { matchSeparationFinalizationTask } from "../../src/stores/kuali/tasks/match-separation-finalization.js";
import { saveSeparationFinalizationTask } from "../../src/stores/kuali/tasks/save-separation-finalization.js";
import { stageSeparationFinalizationTask } from "../../src/stores/kuali/tasks/stage-separation-finalization.js";
import { verifySeparationFinalizationTask } from "../../src/stores/kuali/tasks/verify-separation-finalization.js";

const FAILURES: string[] = [];
const taskCtx = Object.freeze({
  signal: new AbortController().signal,
  log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
  fail: (code: string, message: string): never => {
    FAILURES.push(code);
    throw new Error(`${code}: ${message}`);
  },
  recordData: () => undefined,
});

const ACTION_ID = "6a7a33b2ac106d428b3217e0";
const DOCUMENT_NUMBER = "4510";
const EID = EidSchema.parse("10001799");

/** Live doc 4510's finalization, verbatim (2026-08-12). */
const VARIABLES: KualiFinalizationVariables = Object.freeze({
  department: "000412 - Housing/Dining/Hospitality",
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  timekeeperName: "Julian Zaw",
  terminationEffectiveDate: "06/11/2026",
  transactionNumber: "T002209631",
  timekeeperComments: "Termination effective date set from the reconciled separation date.",
  observedExistingComments: "",
});

const TARGET: KualiFinalizationTarget = Object.freeze({
  actionId: ACTION_ID,
  documentNumber: DOCUMENT_NUMBER,
  emplId: EID,
  variables: VARIABLES,
});

/** §9.3's complete `Department*` capture, verbatim — `000719`'s double space included. */
const LIVE_DEPARTMENT_OPTIONS: readonly string[] = Object.freeze([
  "- - -",
  "000141 - Early Childhood Education Center",
  "000412 - Housing/Dining/Hospitality",
  "000414 - Bookstore",
  "000422 - Triton Print & Digital Media",
  "000719 -  Supply Chain Services",
]);

const CLOCK = manualClock(new Date("2026-08-14T20:29:08.000Z"));

/**
 * The fake's `commit` verifies a sequencer-minted capability and there is no
 * back door — which is the point of D111's WeakSet. A task-level arm therefore
 * mints one directly. `src/core/write-sequencer.ts` remains the only PRODUCTION
 * caller (`task-driver-boundary` audits `src/**` and would fail any other), and
 * the fenced beats that mint it for real are chunk 5b's sequencer-driven
 * scenarios.
 */
const CAPABILITY = mintMutationCapability(
  PositiveIntSchema.parse(1),
  FingerprintSchema.parse("a".repeat(64)),
);

function world(): KualiFakeWorld {
  const value = createKualiFakeWorld({
    actionId: ACTION_ID,
    documentNumber: DOCUMENT_NUMBER,
    displayedEid: EID,
  });
  value.persistedFinalization = KUALI_FAKE_UNFINALIZED_FIELDS;
  return value;
}

function driverFor(value: KualiFakeWorld): KualiRrssDocumentDriver {
  return createDeterministicKualiDriver(value, CLOCK);
}

async function refusalCode(run: () => Promise<unknown>): Promise<string> {
  const before = FAILURES.length;
  await assert.rejects(run);
  return FAILURES[before] ?? "<no ctx.fail was called>";
}

describe("separations-kuali-finalization scenarios", () => {
  it("separations-kuali-finalization/stage-refusals — one pass stages every field, and each refusal names itself", async () => {
    // The happy pass first: ONE prepare, every field, straight from the
    // variables — and the previous values kept as the operator's undo record.
    const happy = world();
    const staging = await stageSeparationFinalizationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: driverFor(happy) },
    });
    assert.equal(staging.stagedPageState, "kuali.rrss-document.finalization-staged");
    assert.deepEqual(staging.stagedFields, kualiFinalizationFields(VARIABLES));
    assert.deepEqual(staging.previousFields, KUALI_FAKE_UNFINALIZED_FIELDS);
    assert.ok(staging.observedDepartmentOptions.includes(VARIABLES.department));
    // Staging saves NOTHING. S61 is legacy's dry run mutating a live document,
    // so "the document still reads unfinalized" is the assertion, not a note.
    assert.deepEqual(happy.persistedFinalization, KUALI_FAKE_UNFINALIZED_FIELDS);
    assert.ok(!happy.events.includes(`commit:${KUALI_RRSS_SAVE_BUTTON}`));

    // **S55** — the department option the live control does not offer.
    const noDepartment = world();
    noDepartment.finalizationDepartmentOptions = ["- - -", "000414 - Bookstore"];
    assert.equal(
      await refusalCode(() => stageSeparationFinalizationTask.impl.run({
        input: TARGET,
        ctx: { ...taskCtx, driver: driverFor(noDepartment) },
      })),
      "department-option-not-offered",
    );

    // **S56, strengthened** — somebody edited the comments after the read this
    // run composed its text from.
    const movedComments = world();
    movedComments.persistedFinalization = {
      ...KUALI_FAKE_UNFINALIZED_FIELDS,
      timekeeperComments: "Hold off entering this termination waiting for review by HDH HR.",
    };
    assert.equal(
      await refusalCode(() => stageSeparationFinalizationTask.impl.run({
        input: TARGET,
        ctx: { ...taskCtx, driver: driverFor(movedComments) },
      })),
      "comments-changed-since-read",
    );

    // `fillWithVerify`: a control that silently drops its value refuses BY NAME
    // rather than reaching the fence on a staging the page did not take.
    const dropped = world();
    dropped.finalizationStagingDrops = ["transactionNumber"];
    assert.equal(
      await refusalCode(() => stageSeparationFinalizationTask.impl.run({
        input: TARGET,
        ctx: { ...taskCtx, driver: driverFor(dropped) },
      })),
      "stage-not-persisted",
    );

    // The wrong person's document: defence in depth ahead of the kernel's own
    // beat-③ binding, and never a reason to leave a staged value behind.
    const wrongPerson = world();
    wrongPerson.displayedEid = "10001754";
    assert.equal(
      await refusalCode(() => stageSeparationFinalizationTask.impl.run({
        input: TARGET,
        ctx: { ...taskCtx, driver: driverFor(wrongPerson) },
      })),
      "subject-mismatch",
    );
  });

  it("separations-kuali-finalization/save-verify-read-back — the reload read-back is the only landing proof", async () => {
    // Beat ①: an unfinalized document is a real, evidenced ABSENCE — the common
    // case, and the one legacy's blank-field save would have written over.
    const fresh = world();
    const probe = await matchSeparationFinalizationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: driverFor(fresh) },
    });
    assert.equal(probe.state, "absent");

    // The whole round trip: stage → click → reload read-back → `present`.
    const landing = world();
    const landingDriver = driverFor(landing);
    await stageSeparationFinalizationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: landingDriver },
    });
    const saved = await saveSeparationFinalizationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: landingDriver, mutation: CAPABILITY },
    });
    // The commit's own output is a CLAIM. Nothing promotes it.
    assert.deepEqual(saved.savedState.fields, kualiFinalizationFields(VARIABLES));
    const verified = await verifySeparationFinalizationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: landingDriver },
    });
    assert.equal(verified.state, "present");

    // **S59 / D128** — the click succeeds, Kuali persists nothing, and the ONLY
    // thing that can tell is the reload read-back. `absent` parks; it is never
    // `done`, and it names every field that disagreed.
    const silent = world();
    silent.commitFinalizationDoesNotPersist = true;
    const silentDriver = driverFor(silent);
    await stageSeparationFinalizationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: silentDriver },
    });
    await saveSeparationFinalizationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: silentDriver, mutation: CAPABILITY },
    });
    const unlanded = await verifySeparationFinalizationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: silentDriver },
    });
    assert.equal(unlanded.state, "absent");

    // A failed check is never an absence.
    const blind = world();
    blind.readBackThrows = new Error("the document route never rendered");
    const unknown = await verifySeparationFinalizationTask.impl.run({
      input: TARGET,
      ctx: { ...taskCtx, driver: driverFor(blind) },
    });
    assert.equal(unknown.state, "unknown");

    // A STATED refusal from Kuali is post-fence: the click happened, so the
    // task records `save-refused` rather than pretending nothing occurred.
    const refusing = world();
    const refusingDriver: KualiRrssDocumentDriver = {
      ...driverFor(refusing),
      commit: async () => {
        throw new KualiSaveRefusedError({
          documentNumber: DOCUMENT_NUMBER,
          refusal: "submitDocumentV2 returned validations: [\"Transaction Number is required\"]",
        });
      },
    };
    assert.equal(
      await refusalCode(() => saveSeparationFinalizationTask.impl.run({
        input: TARGET,
        ctx: { ...taskCtx, driver: refusingDriver, mutation: CAPABILITY },
      })),
      "save-refused",
    );
  });

  it("separations-kuali-finalization/department-option-refusals — S55's UPSTREAM half, one code at a time", async () => {
    // The department reaches the write as a VARIABLE (§4e), so the decision is
    // made here — before the human is asked at all — and the driver's own S55
    // refusal covers only the case where the LIVE control has since moved.
    const resolved = await matchDepartmentOptionTask.impl.run({
      input: {
        deptId: { state: "present", value: "000412" },
        department: { state: "present", value: "HOUSING/DINING/HOSPITALITY" },
        observedOptions: [...LIVE_DEPARTMENT_OPTIONS],
        documentNumber: DOCUMENT_NUMBER,
      },
      ctx: taskCtx,
    });
    assert.equal(resolved.option, VARIABLES.department);
    assert.equal(resolved.departmentCode, "000412");

    // Each refusal reaches its OWN durable code, which is what an operator
    // queries on months later.
    const arms: readonly (readonly [string, Record<string, unknown>])[] = [
      ["department-code-unreadable", {
        deptId: { state: "absent", reason: "the grid rendered this cell empty" },
      }],
      ["department-code-not-offered", { deptId: { state: "present", value: "000999" } }],
      ["department-option-ambiguous", {
        observedOptions: [
          "000412 - Housing/Dining/Hospitality",
          "000412 - Housing Dining Hospitality (legacy)",
        ],
      }],
      ["department-option-unusable", { observedOptions: ["000412 -"] }],
    ];
    for (const [code, overrides] of arms) {
      assert.equal(
        await refusalCode(() => matchDepartmentOptionTask.impl.run({
          input: {
            deptId: { state: "present", value: "000412" },
            department: { state: "present", value: "HOUSING/DINING/HOSPITALITY" },
            observedOptions: [...LIVE_DEPARTMENT_OPTIONS],
            documentNumber: DOCUMENT_NUMBER,
            ...overrides,
          },
          ctx: taskCtx,
        })),
        code,
      );
    }
  });
});

