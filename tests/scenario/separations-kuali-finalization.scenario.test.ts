/**
 * Executable scenarios for `separations-kuali-finalization` — separations
 * chunk 5 (`docs/migrations/separations.md` §4e), the Kuali finalization write.
 *
 * The corpus is split by what each arm falsifies, exactly as chunk 4's is:
 *
 * - **Task walks** (5a) run the REAL task implementations against the
 *   deterministic driver, because a refusal is only observable as "it refused"
 *   rather than "it returned something plausible" when the real implementation
 *   runs. They are S55-S59's contract halves.
 * - **Sequencer walks** (5b) drive the REAL write sequencer over a REAL
 *   authority database, which is the only way to say "zero rows in
 *   `write_intents`" about anything. They produce the transaction node's four
 *   coverage points, plus S60's park and S61's dry run at graph level.
 * - **A pure graph walk** (5b) runs the descriptor's real binds and its real
 *   terminal derive, so it falsifies the PATH and produces the gate's points.
 *
 * Nothing here touches a browser and nothing here saves anything: the
 * controlled real commit is chunk 5c, waiting on the operator-named canary
 * (§4f2).
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
import { afterEach, describe, it } from "vitest";
import { mintMutationCapability } from "../../src/base/mutation-capability.js";
import { WriteParkedError } from "../../src/core/write-sequencer.js";
import { manualClock } from "../../src/domain/clock.js";
import {
  EidSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
} from "../../src/domain/ids.js";
import { MatchIdentityOutputSchema } from "../../src/domain/contracts/separations/match-identity.js";
import type { MatchIdentityOutput } from "../../src/domain/contracts/separations/match-identity.js";
import type { SearchPersonOrgOutput } from "../../src/domain/contracts/ucpath/search-person-org.js";
import { UcpathJobSummaryReadSchema } from "../../src/domain/ui/ucpath-job-summary.js";
import type { UcpathJobSummary } from "../../src/domain/ui/ucpath-job-summary.js";
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
import { createDeterministicUcpathPersonOrgDriver } from "../../src/stores/ucpath/driver/fake.js";
import { deriveJobRowFromCells } from "../../src/stores/ucpath/driver/person-org-operation.js";
import { readJobSummaryTask } from "../../src/stores/ucpath/tasks/read-job-summary.js";
import { matchIdentityTask } from "../../src/stores/separations/tasks/match-identity.js";
import { verifyIdentityApprovalTask } from "../../src/stores/separations/tasks/verify-identity-approval.js";
import { matchDepartmentOptionTask } from "../../src/stores/separations/tasks/match-department-option.js";
import { matchSeparationFinalizationTask } from "../../src/stores/kuali/tasks/match-separation-finalization.js";
import { saveSeparationFinalizationTask } from "../../src/stores/kuali/tasks/save-separation-finalization.js";
import { stageSeparationFinalizationTask } from "../../src/stores/kuali/tasks/stage-separation-finalization.js";
import { verifySeparationFinalizationTask } from "../../src/stores/kuali/tasks/verify-separation-finalization.js";
import { separationsKualiFinalizationDescriptor } from "../../src/workflows/separations-kuali-finalization/descriptor.js";
import { SEPARATIONS_KUALI_FINALIZATION_CLAIMS } from "./coverage-claims.js";
import { walkDescriptor } from "./helpers/pure-walk.js";
import {
  FINALIZATION_DEPARTMENT_NODE,
  FINALIZATION_DEPARTMENT_OPTION,
  FINALIZATION_FIELDS,
  FINALIZATION_NODE,
  FINALIZATION_OTHER_EID,
  FINALIZATION_RUN_INPUT,
  FINALIZATION_SCOPE_OUTPUTS,
  finalizationClaimRunning,
  finalizationContext,
  finalizationDurableFootprint,
  finalizationHarness,
  finalizationQueuedRun,
  type FinalizationHarness,
} from "../unit/fixtures/kuali-finalization-fixtures.js";
import { noSeparationWritePlan } from "../../src/domain/separations/write-plan.js";

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

/* ── the graph half (5b): shared identity fixtures ────────────────────────── */

const GRAPH_OBSERVED_AT = IsoInstantSchema.parse("2026-08-14T18:00:00.000Z");

/** One *Employment Instances* row, in the live grid's twelve-column order. */
const GRAPH_CELLS: readonly string[] = [
  "0", "07/01/2025", "Active", "SDCMP", "40012345", "000412",
  "HOUSING/DINING/HOSPITALITY", "004921", "STDT 2", "", "0.500000", "Student",
];

function graphJobSummary(): UcpathJobSummary {
  const jobRows = [deriveJobRowFromCells(GRAPH_CELLS, 0)];
  return {
    pageStateId: "ucpath.person-org.detail-ready",
    emplId: FINALIZATION_RUN_INPUT.emplId,
    displayedName: FINALIZATION_SCOPE_OUTPUTS.approval.approved.ucpathName,
    jobRows,
    rowCount: jobRows.length,
    renderContext: {
      entry: "auto-detail",
      searchResultRows: 0,
      employmentInstances: "already-complete",
    },
    observedAt: GRAPH_OBSERVED_AT,
  };
}

function graphNameSearch(): SearchPersonOrgOutput {
  const candidate = {
    emplId: FINALIZATION_RUN_INPUT.emplId,
    name: FINALIZATION_RUN_INPUT.employeeName,
    department: "Housing Dining Hospitality",
    jobTitle: "STDT 2",
    employeeStatus: "active" as const,
    hdh: true,
  };
  return {
    results: [candidate],
    selection: { status: "resolved", selected: candidate, candidateEids: [FINALIZATION_RUN_INPUT.emplId] },
  };
}

async function graphReadJobSummary(): Promise<UcpathJobSummary> {
  const driver = createDeterministicUcpathPersonOrgDriver(
    undefined,
    UcpathJobSummaryReadSchema.parse({ state: "read", summary: graphJobSummary() }),
  );
  return await readJobSummaryTask.impl.run({
    input: { emplId: FINALIZATION_RUN_INPUT.emplId },
    ctx: { ...taskCtx, driver },
  }) as UcpathJobSummary;
}

async function graphComparison(summary: UcpathJobSummary): Promise<MatchIdentityOutput> {
  return MatchIdentityOutputSchema.parse(await matchIdentityTask.impl.run({
    input: {
      documentNumber: FINALIZATION_RUN_INPUT.documentNumber,
      documentName: FINALIZATION_RUN_INPUT.employeeName,
      documentEid: FINALIZATION_RUN_INPUT.documentEid,
      emplId: FINALIZATION_RUN_INPUT.emplId,
      emplIdSource: FINALIZATION_RUN_INPUT.emplIdSource,
      jobSummary: summary,
      nameSelection: graphNameSearch().selection,
      plan: noSeparationWritePlan("this fixture composes no separation write plan"),
    },
    ctx: taskCtx,
  }));
}

function claimFor(scenarioId: string): readonly string[] {
  const entry = SEPARATIONS_KUALI_FINALIZATION_CLAIMS.find(
    (candidate) => candidate.scenarioId === scenarioId,
  );
  assert.ok(entry, `no registered claim for ${scenarioId}`);
  return entry.covers;
}

const open: FinalizationHarness[] = [];
afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
});

function harness(options?: Parameters<typeof finalizationHarness>[0]): FinalizationHarness {
  const created = finalizationHarness(options);
  open.push(created);
  return created;
}

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

  /* ── the graph half (5b): the real sequencer, over a real authority DB ──── */

  it("separations-kuali-finalization/dry-run-preview — a complete ten-field staging that persists NOTHING", async () => {
    // **S61**, at graph level. Legacy's dry run leaves the timekeeper name and a
    // `similar`-tier name rewrite on the live Kuali draft; this one stages all
    // ten controls, reads every one of them back, and leaves the document as it
    // found it.
    const h = harness();
    const { run, claim } = finalizationClaimRunning(
      h.database, h.clock, finalizationQueuedRun({ dryRun: true }),
    );

    const preview = await h.bound(() => h.sequencer.executeDryRun(
      finalizationContext(run, claim, true),
    ));

    assert.equal(preview.kind, "transaction-dry-run-preview");
    assert.equal(preview.subject.state, "match");
    // The staging really happened — this is a preview of a real preparation.
    assert.ok(h.world.events.includes(`stage-finalization:${FINALIZATION_FIELDS.transactionNumber}`));
    assert.equal(h.world.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.equal(h.world.persistedFinalization, undefined, "the document is still unfinalized");
    assert.equal(h.world.lastCapability, undefined, "no mutation capability was ever minted");

    const footprint = finalizationDurableFootprint(h);
    assert.equal(footprint.intent, undefined, "zero write intents");
    assert.equal(footprint.checkpoint, undefined, "zero transaction checkpoints");
    assert.deepEqual(footprint.outboxes, [], "zero ledger/span outboxes");

    assert.deepEqual(claimFor("separations-kuali-finalization/dry-run-preview"), [
      `transaction:${FINALIZATION_NODE}/dry-run`,
    ]);
  });

  it("separations-kuali-finalization/subject-mismatch — the document moved after staging: zero fence, zero click", async () => {
    // Doc 09 beat ③: the probe AND the prepare both saw the right person, then
    // the pooled page moved to a different one before the fence. Ten staged
    // values are abandoned rather than saved onto somebody else's separation.
    const h = harness({ displayedEidAfterStage: FINALIZATION_OTHER_EID });
    const { run, claim } = finalizationClaimRunning(h.database, h.clock);

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(finalizationContext(run, claim))),
      /subject mismatch, zero fence, zero click/u,
    );

    assert.equal(h.world.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.equal(h.world.persistedFinalization, undefined, "Kuali was not written");
    const footprint = finalizationDurableFootprint(h);
    assert.equal(footprint.intent, undefined, "the fence was never reached");
    assert.equal(footprint.checkpoint, undefined);

    assert.deepEqual(claimFor("separations-kuali-finalization/subject-mismatch"), [
      `transaction:${FINALIZATION_NODE}/subject-mismatch`,
    ]);
  });

  it("separations-kuali-finalization/committed — ONE fenced click writes all ten fields, and the reload read-back is the proof", async () => {
    const h = harness();
    const { run, claim } = finalizationClaimRunning(h.database, h.clock);

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      finalizationContext(run, claim),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    // §4e beat 4: every written field, against the EXACT staged variables.
    assert.deepEqual(h.world.persistedFinalization, FINALIZATION_FIELDS);
    assert.deepEqual(
      Reflect.get(Reflect.get(outcome as object, "proof") as object, "fields"),
      FINALIZATION_FIELDS,
    );
    assert.equal(
      h.world.events.filter((event) => event.startsWith("commit:")).length, 1, "exactly one click",
    );
    assert.notEqual(h.world.lastCapability, undefined);
    const footprint = finalizationDurableFootprint(h);
    assert.notEqual(footprint.intent, undefined, "the fence is durable");
    assert.notEqual(footprint.checkpoint, undefined, "the settlement is durable");

    assert.deepEqual(claimFor("separations-kuali-finalization/committed"), [
      `transaction:${FINALIZATION_NODE}/committed`,
    ]);
  });

  it("separations-kuali-finalization/already-present — a document already carrying this finalization is not saved twice", async () => {
    // The permanent key asks "is document N already finalized against
    // transaction T?", and the probe answers it off the document itself — so a
    // re-run performs no click at all.
    const h = harness({ persistedFinalization: FINALIZATION_FIELDS });
    const { run, claim } = finalizationClaimRunning(h.database, h.clock);

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      finalizationContext(run, claim),
    ));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(h.world.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.deepEqual(h.world.persistedFinalization, FINALIZATION_FIELDS);

    assert.deepEqual(claimFor("separations-kuali-finalization/already-present"), [
      `transaction:${FINALIZATION_NODE}/already-present`,
    ]);
  });

  it("separations-kuali-finalization/save-not-landed-parks — S59 at graph level, which is S60's disposition (§4c)", async () => {
    // The click succeeds, Kuali persists nothing, and the reload read-back is
    // the only thing that can tell. That is post-fence, so the run PARKS with
    // its intent fenced and NOTHING settled — §4c's answer, because by this
    // point the UCPath termination this document was going to record is already
    // real. A `failed` run here would leave "UCPath done, Kuali not" in the
    // operator's head, which is exactly what §4c refuses.
    const h = harness({ commitDoesNotPersist: true });
    const { run, claim } = finalizationClaimRunning(h.database, h.clock);

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(finalizationContext(run, claim))),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError, String(error));
        return true;
      },
    );

    assert.equal(
      h.world.events.filter((event) => event.startsWith("commit:")).length, 1, "the click happened",
    );
    assert.equal(h.world.persistedFinalization, undefined, "and Kuali kept nothing");
    const footprint = finalizationDurableFootprint(h);
    assert.notEqual(footprint.intent, undefined, "the fence is durable: the click was reachable");
    const intent = footprint.intent as object;
    assert.equal(Reflect.get(intent, "status"), "parked", JSON.stringify(intent));
    assert.equal(Reflect.get(intent, "parkedCode"), "unknown", JSON.stringify(intent));
    assert.equal(footprint.checkpoint, undefined, "nothing settled over an unproven save");
  });

  it("separations-kuali-finalization/gate-approved — the whole graph, from two reads to one settled finalization", async () => {
    const summary = await graphReadJobSummary();
    const comparison = await graphComparison(summary);
    const approval = {
      decision: "approved" as const,
      eid: FINALIZATION_RUN_INPUT.emplId,
      chosenFrom: "checked" as const,
      evidenceDigest: comparison.evidenceDigest,
    };
    const department = await matchDepartmentOptionTask.impl.run({
      input: {
        deptId: FINALIZATION_RUN_INPUT.ucpathDeptId,
        department: FINALIZATION_RUN_INPUT.ucpathDepartment,
        observedOptions: [...FINALIZATION_RUN_INPUT.observedDepartmentOptions],
        documentNumber: FINALIZATION_RUN_INPUT.documentNumber,
      },
      ctx: taskCtx,
    });
    const walk = walkDescriptor(separationsKualiFinalizationDescriptor, FINALIZATION_RUN_INPUT, {
      outputs: {
        "job-summary": summary,
        "name-search": graphNameSearch(),
        [FINALIZATION_DEPARTMENT_NODE]: department,
        comparison,
        "identity-approval": approval,
        approval: await verifyIdentityApprovalTask.impl.run({
          input: { packet: comparison.packet, evidenceDigest: comparison.evidenceDigest, approval },
          ctx: taskCtx,
        }),
        [FINALIZATION_NODE]: {
          disposition: "committed",
          output: {
            savedState: {
              kind: "kuali-saved-finalization",
              actionId: FINALIZATION_RUN_INPUT.actionId,
              documentNumber: FINALIZATION_RUN_INPUT.documentNumber,
              observedEid: FINALIZATION_RUN_INPUT.emplId,
              fields: FINALIZATION_FIELDS,
              source: "reload-read-back",
            },
          },
        },
      },
    });

    for (const point of claimFor("separations-kuali-finalization/gate-approved")) {
      assert.ok(walk.covered.includes(point), point);
    }
    const result = walk.result as {
      department: { option: string };
      finalization: { proof: { fields: { transactionNumber: string } } };
    };
    // The department the operator saw at the gate is the department that was
    // staged — the fold's output reaches the terminal result unchanged.
    assert.equal(result.department.option, FINALIZATION_DEPARTMENT_OPTION);
    assert.equal(
      result.finalization.proof.fields.transactionNumber,
      FINALIZATION_FIELDS.transactionNumber,
    );
  });
});
