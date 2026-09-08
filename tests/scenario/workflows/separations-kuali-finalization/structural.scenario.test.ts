/**
 * Executable scenarios for `separations-kuali-finalization` — separations
 * chunk 5 (`docs/rebuild/migrations/separations.md` §4e), the Kuali finalization write.
 *
 * The corpus is split by what each arm falsifies, exactly as chunk 4's is:
 *
 * - **Task walks** (5a) run the REAL task implementations against the
 *   deterministic driver, because a refusal is only observable as "it refused"
 *   rather than "it returned something plausible" when the real implementation
 *   runs. They are S55-S59's contract halves.
 * - **Sequencer walks** (5b) drive the REAL write sequencer over a REAL
 *   authority database, which is the only way to say "zero rows in
 *   `run_operations`" about anything. They produce the transaction node's four
 *   coverage points, plus S60's park and S61's dry run at graph level.
 * - **A pure graph walk** (5b) runs the descriptor's real binds and its real
 *   terminal derive, so it falsifies the PATH and produces the gate's points.
 *
 * Nothing here touches a browser and nothing here saves anything: the
 * controlled real commit is chunk 5c, waiting on the operator-named canary
 * (§4f2). This is the T1a half of D266's first pair; the T1b half — the live
 * rehearsal against a registered canary — is the sibling `dry-run.scenario.ts`,
 * which no vitest project may import (ref guards-and-tests §10.4).
 *
 * **Every subject value here is SYNTHETIC** (ref guards-and-tests §10.3). The
 * EIDs are the harness's `10800000`/`10800001`, which no live system resolves;
 * a real person's identifier is a dry-run fact and lives in the registry, read
 * by LABEL. The remaining fixture material is also rekeyed and synthetic. It
 * preserves the page-state shapes captured by the 2026-08-12 read-only pass —
 * including the department option list and the blank controls of an
 * unprocessed form — without claiming any current Kuali document has them.
 *
 * The commit arms drive the task against a `commit` stub rather than through
 * the write sequencer. That is on purpose: the capability's unforgeability is
 * the DRIVER's invariant and is pinned by the sequencer-driven cases below,
 * while what these arms falsify is the TASK's mapping of the driver's answers
 * onto durable error codes.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { mintMutationCapability } from "../../../../src/base/mutation-capability.js";
import { workflowTerminalResultExecution } from "../../../../src/base/workflow.js";
import { buildRunPreviewResult } from "../../../../src/core/run-result.js";
import { WriteParkedError } from "../../../../src/core/write-sequencer.js";
import { manualClock } from "../../../../src/domain/clock.js";
import type { RunRecord } from "../../../../src/domain/run/record.js";
import { RunDryRunPreviewResultSchema } from "../../../../src/domain/run/result.js";
import { deriveSchemaHash } from "../../../../src/domain/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/domain/workflow/checkpoint.js";
import { KualiSaveSeparationFinalization } from "../../../../src/domain/contracts/kuali/save-separation-finalization.js";
import { UcpathVerifyTerminationFilingPresent } from "../../../../src/domain/contracts/ucpath/verify-termination-filing-present.js";
import { SeparationsMatchDepartmentOption } from "../../../../src/domain/contracts/separations/match-department-option.js";
import { SeparationsVerifyIdentityApproval } from "../../../../src/domain/contracts/separations/verify-identity-approval.js";
import {
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
} from "../../../../src/domain/ids.js";
import { MatchIdentityOutputSchema } from "../../../../src/domain/contracts/separations/match-identity.js";
import type { MatchIdentityOutput } from "../../../../src/domain/contracts/separations/match-identity.js";
import type { SearchPersonOrgOutput } from "../../../../src/domain/contracts/ucpath/search-person-org.js";
import { UcpathJobSummaryReadSchema } from "../../../../src/domain/ui/ucpath-job-summary.js";
import type { UcpathJobSummary } from "../../../../src/domain/ui/ucpath-job-summary.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../../src/domain/ui/kuali-rrss-document.js";
import {
  KualiSaveRefusedError,
  kualiFinalizationFields,
} from "../../../../src/domain/ui/kuali-separation-finalization.js";
import type {
  KualiFinalizationTarget,
  KualiFinalizationVariables,
} from "../../../../src/domain/ui/kuali-separation-finalization.js";
import type { KualiRrssDocumentDriver } from "../../../../src/domain/ui/kuali-rrss-document.js";
import {
  KUALI_FAKE_UNFINALIZED_FIELDS,
  createDeterministicKualiDriver,
  createKualiFakeWorld,
} from "../../../../src/stores/kuali/driver/fake.js";
import type { KualiFakeWorld } from "../../../../src/stores/kuali/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/stores/ucpath/driver/fake.js";
import { deriveJobRowFromCells } from "../../../../src/stores/ucpath/driver/person-org-operation.js";
import { readJobSummaryTask } from "../../../../src/stores/ucpath/tasks/read-job-summary.js";
import { matchIdentityTask } from "../../../../src/stores/separations/tasks/match-identity.js";
import { verifyIdentityApprovalTask } from "../../../../src/stores/separations/tasks/verify-identity-approval.js";
import { matchDepartmentOptionTask } from "../../../../src/stores/separations/tasks/match-department-option.js";
import { matchSeparationFinalizationTask } from "../../../../src/stores/kuali/tasks/match-separation-finalization.js";
import { saveSeparationFinalizationTask } from "../../../../src/stores/kuali/tasks/save-separation-finalization.js";
import { stageSeparationFinalizationTask } from "../../../../src/stores/kuali/tasks/stage-separation-finalization.js";
import { verifySeparationFinalizationTask } from "../../../../src/stores/kuali/tasks/verify-separation-finalization.js";
import { separationsKualiFinalizationDescriptor } from "../../../helpers/registered-workflows.js";
import { SEPARATIONS_KUALI_FINALIZATION_CLAIMS } from "../../coverage-claims.js";
import { walkDescriptor } from "../../helpers/pure-walk.js";
import {
  FINALIZATION_DEPARTMENT_NODE,
  FINALIZATION_DEPARTMENT_OPTION,
  FINALIZATION_EID,
  FINALIZATION_FIELDS,
  FINALIZATION_IMPL_FINGERPRINT,
  FINALIZATION_NODE,
  FINALIZATION_NOW,
  FINALIZATION_OTHER_EID,
  FINALIZATION_RUN_INPUT,
  FINALIZATION_SCOPE_OUTPUTS,
  finalizationClaimRunning,
  finalizationContext,
  finalizationDurableFootprint,
  finalizationHarness,
  finalizationQueuedRun,
  type FinalizationHarness,
} from "../../../helpers/kuali-finalization-fixtures.js";
import { noSeparationWritePlan } from "../../../../src/domain/separations/write-plan.js";

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
const DOCUMENT_NUMBER = "4444";
/**
 * Synthetic, and schema-shaped so the ingress still parses it (§10.3). This
 * file used to hardcode a real subject's EID — the same id, with a name beside
 * it, in `docs/rebuild/migrations/separations.md` §9.3 — which is exactly the "fixture
 * scenario that pretends" R10 exists to end: a structural walk over fake stores
 * can never assert anything about the person that id names, so naming them buys
 * nothing and commits a real identifier to git.
 */
const EID = FINALIZATION_EID;

/**
 * Synthetic finalization shape derived from the 2026-08-12 observation. The
 * two date write-backs §4e's 2026-08-14 amendment added are composed
 * consistently with the fixture effective date rather than invented: the
 * reconciliation's own rule is `terminationEffectiveDate = separationDate + 1`,
 * so `06/11/2026` fixes the separation date at `06/10/2026`, and this is the
 * ordinary case where no leave day moved it off the last day worked.
 */
const VARIABLES: KualiFinalizationVariables = Object.freeze({
  department: "000412 - Housing/Dining/Hospitality",
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  timekeeperName: "Julian Zaw",
  lastDayWorked: "06/10/2026",
  separationDate: "06/10/2026",
  terminationEffectiveDate: "06/11/2026",
  transactionNumber: "T009000000",
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

const NAME_ONLY_FINALIZATION_INPUT = {
  ...FINALIZATION_RUN_INPUT,
  emplIdSource: "name-resolved" as const,
  documentEid: { state: "absent" as const, reason: "name-only structural path" },
};

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

async function graphComparison(
  summary: UcpathJobSummary,
  input: typeof FINALIZATION_RUN_INPUT | typeof NAME_ONLY_FINALIZATION_INPUT = FINALIZATION_RUN_INPUT,
): Promise<MatchIdentityOutput> {
  return MatchIdentityOutputSchema.parse(await matchIdentityTask.impl.run({
    input: {
      documentNumber: input.documentNumber,
      documentName: input.employeeName,
      documentEid: input.documentEid,
      emplId: input.emplId,
      emplIdSource: input.emplIdSource,
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

/**
 * The two post-authority node outputs, produced by the REAL task implementations
 * over the shared identity fixtures — the same call chain the gate-approved
 * walk makes, extracted so both use one source rather than two copies.
 */
async function graphPostGateOutputs(
  input: typeof FINALIZATION_RUN_INPUT | typeof NAME_ONLY_FINALIZATION_INPUT = FINALIZATION_RUN_INPUT,
): Promise<Readonly<{
  summary: UcpathJobSummary;
  comparison: MatchIdentityOutput;
  approval: unknown;
  approvalOutput: unknown;
  department: unknown;
}>> {
  const summary = await graphReadJobSummary();
  const comparison = await graphComparison(summary, input);
  const approval = comparison.packet.emplIdSource === "name-resolved"
    ? {
      decision: "approved" as const,
      eid: FINALIZATION_RUN_INPUT.emplId,
      chosenFrom: "checked" as const,
      evidenceDigest: comparison.evidenceDigest,
    }
    : undefined;
  return {
    summary,
    comparison,
    approval,
    approvalOutput: await verifyIdentityApprovalTask.impl.run({
      input: { packet: comparison.packet, evidenceDigest: comparison.evidenceDigest, approval },
      ctx: taskCtx,
    }),
    department: await matchDepartmentOptionTask.impl.run({
      input: {
        deptId: FINALIZATION_RUN_INPUT.ucpathDeptId,
        department: FINALIZATION_RUN_INPUT.ucpathDepartment,
        observedOptions: [...FINALIZATION_RUN_INPUT.observedDepartmentOptions],
        documentNumber: FINALIZATION_RUN_INPUT.documentNumber,
      },
      ctx: taskCtx,
    }),
  };
}

/**
 * The terminal's authenticated `dependsOn`, minus the transaction node the
 * preview itself supplies: `approval` and `department-option`.
 *
 * Nothing is fabricated. Both outputs come from the REAL task implementations
 * above and are re-parsed through their OWNING contract schemas, so a
 * checkpoint this builds is one the real executor could have written — an
 * invented row would have been the plausible-wrong value this tree bans. The
 * sequencer harness starts the run AT the transaction node, so the upstream
 * rows do not exist in authority to be read back; producing them from the real
 * tasks is the honest substitute for reading them.
 */
async function previewDependencyEvidence(run: RunRecord): Promise<readonly unknown[]> {
  const outputs = await graphPostGateOutputs();
  const rowFor = (nodeId: string, schema: z.ZodType, value: unknown): unknown =>
    RunCheckpointRecordSchema.parse({
      workflowId: separationsKualiFinalizationDescriptor.id,
      itemId: run.envelope.itemId,
      nodeId,
      attempt: 1,
      runId: run.envelope.runId,
      output: { schemaHash: deriveSchemaHash(schema, "output"), value: schema.parse(value) },
      descriptorVersion: separationsKualiFinalizationDescriptor.version,
      contractFingerprint: separationsKualiFinalizationDescriptor.contractFingerprint,
      implFingerprint: FINALIZATION_IMPL_FINGERPRINT,
      provenance: [
        { path: "state", source: "derived", observedAt: FINALIZATION_NOW, originalObservedAt: FINALIZATION_NOW },
      ],
      writtenAt: FINALIZATION_NOW,
    });
  return [
    {
      state: "resolved",
      nodeId: "approval",
      checkpoint: rowFor("approval", SeparationsVerifyIdentityApproval.output, outputs.approvalOutput),
    },
    {
      state: "resolved",
      nodeId: FINALIZATION_DEPARTMENT_NODE,
      checkpoint: rowFor(
        FINALIZATION_DEPARTMENT_NODE,
        SeparationsMatchDepartmentOption.output,
        outputs.department,
      ),
    },
    {
      state: "resolved",
      nodeId: "filing-presence",
      checkpoint: rowFor(
        "filing-presence",
        UcpathVerifyTerminationFilingPresent.output,
        FINALIZATION_SCOPE_OUTPUTS["filing-presence"],
      ),
    },
  ];
}

/**
 * Every module specifier a file actually imports — static `import`/`export …
 * from`, and dynamic `import(…)`. A dynamic import whose specifier is not a
 * literal is refused rather than ignored: a computed specifier is exactly how a
 * manifest would be reached without this audit noticing.
 */
function moduleSpecifiers(file: string, source: string): readonly string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [only] = node.arguments;
      if (only === undefined || !ts.isStringLiteralLike(only)) {
        throw new Error(`${file} takes a dynamic import whose specifier is not a literal`);
      }
      specifiers.push(only.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
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
    // Twelve fields since §4e's 2026-08-14 amendment, and the two date
    // write-backs are staged like every other variable — asserted here rather
    // than left to the field-set fold, because "one pass stages EVERY field" is
    // the property this walk exists to hold.
    assert.equal(staging.stagedFields.lastDayWorked, VARIABLES.lastDayWorked);
    assert.equal(staging.stagedFields.separationDate, VARIABLES.separationDate);
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

    // §4e's 2026-08-14 amendment, on the same arm: the two date write-backs are
    // ordinary staged fields, so a control that drops one refuses exactly like
    // the transaction number does — which is what keeps them from being a
    // best-effort write nobody notices failing.
    const droppedDates = world();
    droppedDates.finalizationStagingDrops = ["lastDayWorked", "separationDate"];
    assert.equal(
      await refusalCode(() => stageSeparationFinalizationTask.impl.run({
        input: TARGET,
        ctx: { ...taskCtx, driver: driverFor(droppedDates) },
      })),
      "stage-not-persisted",
    );

    // The wrong person's document: defence in depth ahead of the kernel's own
    // beat-③ binding, and never a reason to leave a staged value behind.
    const wrongPerson = world();
    wrongPerson.displayedEid = FINALIZATION_OTHER_EID;
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

  it("separations-kuali-finalization/dry-run-preview — a complete twelve-field staging that persists NOTHING", async () => {
    // **S61**, at graph level. Legacy's dry run leaves the timekeeper name and a
    // `similar`-tier name rewrite on the live Kuali draft; this one stages all
    // twelve controls — including §4e's two date write-backs, which are exactly
    // the fields legacy's step 13 would have written for real — reads every one
    // of them back, and leaves the document as it found it.
    const h = harness();
    const { run, claim } = finalizationClaimRunning(
      h.database, h.clock, finalizationQueuedRun({ dryRun: true }),
    );

    const preview = await h.bound(() => h.sequencer.executeDryRun(
      finalizationContext(run, claim, true),
    ));

    assert.equal(preview.kind, "transaction-dry-run-preview");
    assert.equal(preview.probe.state, "absent");
    assert.equal(
      preview.outcome.state === "would-prepare" ? preview.outcome.subject.state : undefined,
      "match",
    );
    // The staging really happened — this is a preview of a real preparation.
    assert.ok(h.world.events.includes(`stage-finalization:${FINALIZATION_FIELDS.transactionNumber}`));
    assert.equal(h.world.events.some((event) => event.startsWith("commit:")), false, "zero clicks");
    assert.equal(h.world.persistedFinalization, undefined, "the document is still unfinalized");
    // The preview's staged value is the reconciled separation date the run WOULD
    // write back — §4e's amendment visible in the rehearsal, not only in the run.
    assert.equal(
      preview.outcome.state === "would-prepare"
        ? (preview.outcome.prepare.value as { stagedFields: { separationDate: string } })
          .stagedFields.separationDate
        : undefined,
      FINALIZATION_FIELDS.separationDate,
    );
    assert.equal(h.world.lastCapability, undefined, "no mutation capability was ever minted");

    const footprint = finalizationDurableFootprint(h);
    assert.equal(footprint.intent, undefined, "zero write intents");
    assert.equal(footprint.checkpoint, undefined, "zero transaction checkpoints");
    assert.deepEqual(footprint.outboxes, [], "zero ledger/span outboxes");
    assert.equal(
      h.emitter.events().some((event) => String(event.spanPath).endsWith("/commit")),
      false,
      "zero commit spans",
    );

    /*
     * D210 — and the preview is a terminal RECORD, not a value that evaporates.
     * The sealed factory turns it into the run's `RunResultRecord` bound to the
     * PREVIEW schema hash rather than this workflow's declared result, so a
     * consumer demanding a finalized document sees a hash it does not expect
     * instead of reading a rehearsal as a completed write. That is the half a
     * `zero durable rows` assertion cannot reach, and it is the terminal the
     * sibling `dry-run.scenario.ts` manifest declares for the live rehearsal.
     */
    const built = buildRunPreviewResult(
      separationsKualiFinalizationDescriptor,
      run,
      preview,
      await previewDependencyEvidence(run),
      h.clock,
    );
    assert.equal(
      built.record.resultSchemaHash,
      deriveSchemaHash(RunDryRunPreviewResultSchema, "output"),
    );
    assert.notEqual(
      built.record.resultSchemaHash,
      workflowTerminalResultExecution(separationsKualiFinalizationDescriptor).schemaHash,
    );
    const settled = RunDryRunPreviewResultSchema.parse(built.record.result.value);
    assert.equal(settled.externalCommit, "none");
    assert.equal(settled.stoppedAtNodeId, FINALIZATION_NODE);

    assert.deepEqual(claimFor("separations-kuali-finalization/dry-run-preview"), [
      `transaction:${FINALIZATION_NODE}/dry-run`,
    ]);
  });

  it("separations-kuali-finalization/subject-mismatch — the document moved after staging: zero fence, zero click", async () => {
    // Ref write-safety beat ③: the probe AND the prepare both saw the right person, then
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
    assert.deepEqual(footprint.outboxes, [], "zero ledger/span outboxes");

    assert.deepEqual(claimFor("separations-kuali-finalization/subject-mismatch"), [
      `transaction:${FINALIZATION_NODE}/subject-mismatch`,
    ]);
  });

  it("separations-kuali-finalization/committed — ONE fenced click writes all twelve fields, and the reload read-back is the proof", async () => {
    const h = harness();
    const { run, claim } = finalizationClaimRunning(h.database, h.clock);

    const outcome = await h.bound(() => h.sequencer.executeTransaction(
      finalizationContext(run, claim),
    ));

    const settled = z.strictObject({
      disposition: z.literal("committed"),
      proofSource: z.literal("normal-output"),
      proof: KualiSaveSeparationFinalization.writeSafety.completion.proofSchema,
      output: KualiSaveSeparationFinalization.output,
    }).parse(outcome);
    const expectedProof = {
      kind: "kuali-saved-finalization" as const,
      actionId: FINALIZATION_RUN_INPUT.actionId,
      documentNumber: FINALIZATION_RUN_INPUT.documentNumber,
      observedEid: FINALIZATION_RUN_INPUT.emplId,
      fields: FINALIZATION_FIELDS,
      source: "reload-read-back" as const,
    };
    assert.equal(settled.disposition, "committed");
    assert.equal(settled.proofSource, "normal-output", "the post-save verifier supplied the proof");
    assert.deepEqual(settled.proof, expectedProof);
    assert.deepEqual(settled.output, { savedState: expectedProof });
    // §4e beat 4: every written field, against the EXACT staged variables.
    assert.deepEqual(h.world.persistedFinalization, FINALIZATION_FIELDS);
    assert.equal(
      h.world.events.filter((event) => event.startsWith("commit:")).length, 1, "exactly one click",
    );
    assert.notEqual(h.world.lastCapability, undefined);
    const footprint = finalizationDurableFootprint(h);
    assert.notEqual(footprint.intent, undefined, "the fence is durable");
    // The STATUS, not merely the row: a fenced-but-unsettled intent is exactly
    // what the park arm below produces, so "a row exists" cannot tell them apart.
    assert.equal(
      Reflect.get(footprint.intent as object, "status"),
      "committed",
      JSON.stringify(footprint.intent),
    );
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
    assert.equal(
      Reflect.get(outcome as object, "proofSource"),
      "live-probe",
      "the probe settled it, so the proof cites the probe",
    );
    assert.equal(
      Reflect.get(
        finalizationDurableFootprint(h).intent as object,
        "status",
      ),
      "observed-present",
      "discovering a finalization is not evidence WE filed it",
    );

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
    const outputs = await graphPostGateOutputs(NAME_ONLY_FINALIZATION_INPUT);
    const walk = walkDescriptor(separationsKualiFinalizationDescriptor, NAME_ONLY_FINALIZATION_INPUT, {
      outputs: {
        "job-summary": outputs.summary,
        "name-search": graphNameSearch(),
        [FINALIZATION_DEPARTMENT_NODE]: outputs.department,
        comparison: outputs.comparison,
        "identity-approval": outputs.approval,
        approval: outputs.approvalOutput,
        "filing-presence": FINALIZATION_SCOPE_OUTPUTS["filing-presence"],
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
      approved: { authority: string };
      department: { option: string };
      finalization: { proof: { fields: { transactionNumber: string } } };
    };
    assert.equal(result.approved.authority, "operator-approval");
    // The department the operator saw at the gate is the department that was
    // staged — the fold's output reaches the terminal result unchanged.
    assert.equal(result.department.option, FINALIZATION_DEPARTMENT_OPTION);
    assert.equal(
      result.finalization.proof.fields.transactionNumber,
      FINALIZATION_FIELDS.transactionNumber,
    );
  });

  /**
   * Ref guards-and-tests §10.4's structural half, asserted where the pair lives.
   *
   * `dry-run.scenario.ts` is a DECLARATION: running it starts a browser and
   * reaches live UCPath and live Kuali, so a vitest project that collected it —
   * or a collected file that imported it and executed its side effects — would
   * put a live rehearsal inside the per-commit gate. Two facts keep it out, and
   * neither is self-evident from reading the manifest: it carries no `.test.`
   * segment, and nothing vitest collects imports it.
   */
  it("keeps the dry-run manifest out of every vitest project", () => {
    const testsRoot = join(import.meta.dirname, "..", "..", "..");
    const manifest = join(import.meta.dirname, "dry-run.scenario.ts");
    assert.ok(existsSync(manifest), "the T1b manifest is missing from this workflow's folder");

    // The NAME, asserted against what is on disk rather than against the string
    // this test just built: a hard-coded literal cannot carry `.test.`, so the
    // old form could never fail. A `dry-run*.test.*` sibling would be collected
    // and would start a browser.
    assert.deepEqual(
      readdirSync(import.meta.dirname).filter((entry) => /^dry-run.*\.test\./u.test(entry)),
      [],
      "a collectible dry-run file sits beside the manifest",
    );

    // An actual import of a manifest — determined by the PARSER, not by a
    // pattern over the raw text. A dynamic import executes the declaration
    // exactly as a static one does, `.ts` resolves as readily as `.js`, and
    // prose that merely names a manifest is not an import. A regex could not
    // separate those three, and the file it would false-positive on first is
    // this one.
    //
    // Every `.ts` under `tests/` is scanned, not only `*.test.ts`: a helper,
    // fixture or world file is never collected by vitest itself, but a
    // collected `*.test.ts` importing THAT file would import the manifest
    // transitively without this audit's direct-specifier check on the
    // `.test.ts` file ever seeing it. Scanning every file the corpus can
    // reach closes that gap without re-deriving the whole import graph.
    const collected: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile() && entry.name.endsWith(".ts")) collected.push(full);
      }
    };
    visit(testsRoot);
    assert.ok(collected.length > 0, "the test corpus scan found nothing, so it proves nothing");
    const importers = collected.filter((file) => {
      if (file === manifest) return false;
      const source = readFileSync(file, "utf8");
      // Cheap pre-filter; every candidate is then judged by the parser alone.
      if (!source.includes("dry-run.scenario.")) return false;
      return moduleSpecifiers(file, source).some((specifier) =>
        /dry-run\.scenario\.(?:js|ts)$/u.test(specifier));
    });
    assert.deepEqual(importers, [], "a file the test corpus can reach imports a dry-run manifest");
  });
});
