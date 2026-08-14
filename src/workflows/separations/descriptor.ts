/**
 * `separations` — chunk 6 of the separations migration
 * (`docs/migrations/separations.md` §3): the COMPOSITION. One Kuali RRSS
 * separation document → one terminated employee, across three systems.
 *
 * ## The graph
 *
 * ```
 *   document ─┬─► plan ─┬─► name-search ─┐
 *             │         │                ├─► subject ─► job-summary ─► employment ─┐
 *             │         │   (document) ──┘                   │                     │
 *             │         └─► timecard-search ─► timecard ─► dates                   │
 *             └─► termination-type                    department-option ◄──────────┘
 *                              └────────────┬───────────────┘
 *                                           ▼
 *                                      comparison ─► GATE identity-approval ─► approval
 *                                                                                 │
 *        ┌──────────────────────────────────────────────────────────────────────--┘
 *        ▼
 *   clear-pending (TXN) ─► file-termination (TXN) ─► receipt ─► finalize-kuali (TXN) ─► result
 * ```
 *
 * ## §3's answer to item 10, applied exactly: ONE descriptor over reused tasks
 *
 * §5 item 10's recorded answer is **no delegation**. The `ChildRunExecutor` seam
 * stays unwired and this migration does not own wiring it; recomposition (§3.1)
 * means assembling a DESCRIPTOR from proven chunks and store tasks, which is the
 * mechanism this tree has built and proved. So every node below is a task an
 * earlier chunk authored and live-proved, plus five pure folds that only a
 * composition could need — and the five sub-workflow descriptors stay exactly
 * what §3 said they were: the scaffolding that made each piece provable.
 *
 * ## No branch, no `when`, anywhere
 *
 * §3.1 says scenario variability is served by recomposition, never by
 * conditionals; §4b's hard-fail removed the one arm legacy had (skip Kronos for
 * a non-HDH department); §4d says **no run mode changes the graph at all**. A
 * graph with no conditional edge cannot have one, and that is the structural
 * half of pattern D7's death.
 *
 * ## The reads all land first, and the GATE sits in the gap they leave
 *
 * §4e is normative: every read lands as a typed variable before anything is
 * written, and the whole write half consumes those variables rather than
 * re-deriving anything at fill time. The gate sits between the two halves —
 * doc 09 §14.3, and D26, which forbids any park between `prepare` and `commit`.
 * So the ALWAYS-GATE opens once, after the last read, before the first fence.
 *
 * §5A widened that gap on purpose (`maxAgeMs: Infinity` on the three reads —
 * the separation document is a saved, stable artifact and refresh is a
 * deliberate operator RE-RUN, never an age check firing mid-run), which is what
 * makes the packet's write-plan block load-bearing: the operator approves the
 * VALUES, and §14.5's digest binds the approval to them.
 *
 * ## Three transaction nodes, in doc 09's order
 *
 * `clear-pending` (S30/S31 — legacy's first mutation, unfenced and unverified)
 * → `file-termination` (the real HR write) → `finalize-kuali` (§4e's one save
 * over ten staged fields). Each carries its own permanent key, its own probe and
 * its own landing proof, and each is a node chunk 4 or chunk 5 already proved
 * alone against a real authority database.
 *
 * `receipt` sits between the last two on purpose. §5 item 2's answer is that the
 * UCPath receipt is the PAIR `(transactionNumber, approvalStatus)` and never the
 * number alone, because D130 proved a **Denied** transaction carries a
 * well-formed `T…`. §9.11 recorded that binding both belongs here; this node is
 * that binding, and it refuses to hand the Kuali write a number that records a
 * termination UCPath did not put into effect.
 *
 * ## §4c, honestly
 *
 * A post-fence Kuali uncertainty PARKS (chunk 5 proved that arm against the real
 * sequencer). A pre-fence refusal after the termination committed terminalizes
 * `failed` — and the receipt pair is durable on `file-termination`'s own
 * checkpoint before `finalize-kuali` is ever entered, which is exactly what §4c
 * asks for ("durable authority rather than a remembered fact"). A re-run of the
 * same item replays that checkpoint and re-enters only the finalization, under
 * its own permanent key, with the gate re-crossed (§4d).
 *
 * ## The re-read affordance (§"the re-run wall" item 2)
 *
 * A checkpoint is keyed `(workflow, itemId, node, attempt)` with no run id, so a
 * second run of one document is the same ITEM and replays the first run's reads
 * — whose `observedAt` differs by construction, which is the wall chunks 2 and 3
 * both hit. `reRead` is the operator's explicit "read it again": it is part of
 * the canonical input, so it is part of `matchKey`, so it is a NEW logical item
 * with its own checkpoints and its own gate. It changes no permanent key —
 * those are derived from the EID, the effective date and the document, so a
 * re-read can never file a second termination.
 */
import { z } from "zod";
import { flow } from "../../base/flow.js";
import { defineWorkflowDescriptor, requireFact } from "../../base/workflow.js";
import { KualiReadSeparationDocument } from "../../domain/contracts/kuali/read-separation-document.js";
import { KualiSaveSeparationFinalization } from "../../domain/contracts/kuali/save-separation-finalization.js";
import { KualiStageSeparationFinalization } from "../../domain/contracts/kuali/stage-separation-finalization.js";
import { NewKronosReadSeparationTimecard } from "../../domain/contracts/new-kronos/read-separation-timecard.js";
import { NewKronosSearchEmployee } from "../../domain/contracts/new-kronos/search-employee.js";
import { SeparationsMatchActiveEmployment } from "../../domain/contracts/separations/match-active-employment.js";
import { SeparationsMatchDepartmentOption } from "../../domain/contracts/separations/match-department-option.js";
import { SeparationsMatchIdentity } from "../../domain/contracts/separations/match-identity.js";
import { SeparationsMatchSeparationSubject } from "../../domain/contracts/separations/match-separation-subject.js";
import { SeparationsMatchTerminationType } from "../../domain/contracts/separations/match-termination-type.js";
import { SeparationsReadSeparationDates } from "../../domain/contracts/separations/read-separation-dates.js";
import { SeparationsReadSeparationPlan } from "../../domain/contracts/separations/read-separation-plan.js";
import { SeparationsVerifyIdentityApproval } from "../../domain/contracts/separations/verify-identity-approval.js";
import { SeparationsVerifyTerminationReceipt } from "../../domain/contracts/separations/verify-termination-receipt.js";
import { UcpathCreateTermination } from "../../domain/contracts/ucpath/create-termination.js";
import { UcpathDeletePendingTerminations } from "../../domain/contracts/ucpath/delete-pending-terminations.js";
import { UcpathReadJobSummary } from "../../domain/contracts/ucpath/read-job-summary.js";
import { SearchPersonOrg } from "../../domain/contracts/ucpath/search-person-org.js";
import { UcpathStagePendingTerminationSweep } from "../../domain/contracts/ucpath/stage-pending-termination-sweep.js";
import { UcpathStageTermination } from "../../domain/contracts/ucpath/stage-termination.js";
import { WorkflowIdSchema } from "../../domain/ids.js";
import {
  ApprovedIdentitySubjectSchema,
  IdentityApprovalResultSchema,
} from "../../domain/separations/identity-approval.js";
import {
  buildFinalizationComments,
  separationInitials,
} from "../../domain/separations/separation-dates.js";
import { TerminationReceiptSchema } from "../../domain/separations/termination-receipt.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "../../domain/ui/kuali-document-identity.js";
import { KualiSavedFinalizationProofSchema } from "../../domain/ui/kuali-separation-finalization.js";
import { UcpathPendingSweepProofSchema } from "../../domain/ui/ucpath-smart-hr-termination.js";
import {
  BUILD_MANIFEST,
  resolveWorkflowFingerprint,
} from "../../domain/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../domain/workflow/presentation.js";

/**
 * How long a New Kronos search may go without answering EITHER WAY. Chunk 1's
 * value and chunk 1's argument: the genuine no-results sentinel surfaced in
 * 548 ms live, so this is the line past which silence becomes its own reported
 * failure rather than a fabricated negative (S35).
 */
const SEARCH_TIMEOUT_DEFAULT_MS = 15_000;

/**
 * The operator's explicit "read it again" — §"the re-run wall" item 2.
 *
 * `ordinal` is what makes each re-read its OWN logical item; `reason` is what
 * makes it a decision somebody recorded rather than a button somebody found.
 * Both ride in the canonical input, so `explain run` answers "why was this
 * document read a second time" without archaeology.
 */
const SeparationReReadSchema = z.strictObject({
  ordinal: z.number().int().min(1).max(99),
  reason: z.string().min(1).max(200),
});

const SeparationsInputShape = {
  /** Kuali's action id for the document's CURRENT workflow step (D129). */
  actionId: KualiActionIdSchema,
  /** The run's own claim about which separation this is, proved off the heading. */
  documentNumber: KualiDocumentNumberSchema,
  /**
   * The timekeeper this separation is filed by: staged into the Kuali document
   * and the source of the initials that sign every audit line.
   *
   * It is INGRESS rather than config for chunk 5's reason, one level up: the
   * finalization descriptor already takes it as a per-run variable, and a value
   * retained in the canonical input is one `explain run` can show for the run
   * that used it. Legacy reads `TIMEKEEPER_NAME` from the environment, which is
   * a fact about the machine rather than about the transaction.
   */
  timekeeperName: KualiTimekeeperNameSchema,
} as const;

export const SeparationsInput = z.strictObject({
  ...SeparationsInputShape,
  searchTimeoutMs: z.number().int().positive().max(120_000).default(SEARCH_TIMEOUT_DEFAULT_MS),
  reRead: SeparationReReadSchema.optional(),
});

export const SeparationsCanonicalInput = defineCanonicalInput(
  SeparationsInput,
  z.strictObject({
    ...SeparationsInputShape,
    searchTimeoutMs: z.number().int().positive().max(120_000),
    reRead: SeparationReReadSchema.optional(),
  }),
  [
    {
      actionId: "6a7a33b2ac106d428b3217e0",
      documentNumber: "4510",
      timekeeperName: "Julian Zaw",
    },
    {
      actionId: "6a7e45bcbac487bbc6a2ceae",
      documentNumber: "4524",
      timekeeperName: "Julian Zaw",
      searchTimeoutMs: 30_000,
      reRead: { ordinal: 1, reason: "the department corrected the last day worked" },
    },
  ],
);

export const SeparationsResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  /** The subject a human approved, and the evidence they approved it on. */
  approved: ApprovedIdentitySubjectSchema,
  /** The one employment row the termination was filed against (S23). */
  employment: z.strictObject({
    emplRecord: z.string().min(1),
    payrollTitleCode: z.string().min(1),
    payrollTitle: z.string().min(1),
  }),
  /** Which Kuali department option was staged, and the UCPath code it was keyed by. */
  department: z.strictObject({
    option: z.string().min(1),
    departmentCode: z.string().min(1),
  }),
  /** What the run reconciled, beside what the form carried. */
  dates: z.strictObject({
    kualiLastDayWorked: z.string().min(1),
    lastDayWorked: z.string().min(1),
    kualiSeparationDate: z.string().min(1),
    separationDate: z.string().min(1),
    terminationEffectiveDate: z.string().min(1),
    lastDayWorkedChanged: z.boolean(),
    separationDateChanged: z.boolean(),
  }),
  /** Whether the sweep had anything to do, and what the grid showed after it. */
  pendingSweep: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: UcpathPendingSweepProofSchema,
  }),
  /**
   * §4c's completion shape: the receipt PAIR, checked rather than carried. The
   * number alone is never a proof (D130).
   */
  termination: TerminationReceiptSchema,
  /** The finalization's landing proof — always the reload read-back's (D128/S59). */
  finalization: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: KualiSavedFinalizationProofSchema,
  }),
});

const DOCUMENT_NODE = "document";
const PLAN_NODE = "plan";
const TERMINATION_TYPE_NODE = "termination-type";
const NAME_SEARCH_NODE = "name-search";
const SUBJECT_NODE = "subject";
const JOB_SUMMARY_NODE = "job-summary";
const EMPLOYMENT_NODE = "employment";
const DEPARTMENT_NODE = "department-option";
const TIMECARD_SEARCH_NODE = "timecard-search";
const TIMECARD_NODE = "timecard";
const DATES_NODE = "dates";
const COMPARISON_NODE = "comparison";
const GATE_NODE = "identity-approval";
const APPROVAL_NODE = "approval";
const RECEIPT_NODE = "receipt";
const SWEEP_NODE = "clear-pending";
const TERMINATION_NODE = "file-termination";
const FINALIZE_NODE = "finalize-kuali";

/** `""` when the control was empty — S56's baseline, which is a real value. */
function existingComments(comments: { state: "present"; value: string } | { state: "absent" }): string {
  return comments.state === "present" ? comments.value : "";
}

const separationsFlow = flow(SeparationsInput)
  .step(DOCUMENT_NODE, KualiReadSeparationDocument, {
    label: "Separation Document",
    dependsOn: [],
    /**
     * Chunk 2's argument verbatim: this node's product is its VALUE, not browser
     * state, so restoring the checkpoint into a fresh browser leaves nothing
     * broken. That matters more here than it did there — the gate parks and the
     * executor releases every session on the way in, so every read upstream of
     * the gate is replayed into a browser that has never seen these pages.
     */
    replay: "checkpoint",
    bind: ({ input }) => ({ actionId: input.actionId, documentNumber: input.documentNumber }),
  })
  .step(PLAN_NODE, SeparationsReadSeparationPlan, {
    label: "Separation Plan",
    dependsOn: [DOCUMENT_NODE],
    replay: "checkpoint",
    bind: ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[DOCUMENT_NODE].employee.name,
      lastDayWorked: outputs[DOCUMENT_NODE].separation.lastDayWorked,
      separationDate: outputs[DOCUMENT_NODE].separation.separationDate,
      // S7's reference is the READ's own instant, not a clock: the refusal then
      // says what is true — *as of the moment this run read the document*.
      observedAt: outputs[DOCUMENT_NODE].observedAt,
    }),
  })
  .step(TERMINATION_TYPE_NODE, SeparationsMatchTerminationType, {
    label: "Termination Type",
    dependsOn: [DOCUMENT_NODE],
    replay: "checkpoint",
    bind: ({ input, outputs }) => ({
      terminationType: outputs[DOCUMENT_NODE].separation.terminationType,
      // The complete option list this run ACTUALLY observed, so a republished
      // control refuses on the first run that sees it (§4a's accepted cost).
      observedOptions: outputs[DOCUMENT_NODE].options.terminationType,
      documentNumber: input.documentNumber,
    }),
  })
  .step(NAME_SEARCH_NODE, SearchPersonOrg, {
    label: "Name Search",
    dependsOn: [PLAN_NODE],
    replay: "checkpoint",
    /**
     * `keepNonHdh: true`, always, and UNCONDITIONALLY run — chunk 3's two
     * sharpest choices. Legacy searches only when its name tier came back
     * `different`, so the alternative candidate `T002173685` turned on exists
     * only on the runs a Levenshtein threshold happened to select; and an HDH
     * filter would hide exactly the career employee a common name matched.
     */
    bind: ({ outputs }) => ({
      kind: "by-name" as const,
      name: outputs[PLAN_NODE].employeeName,
      keepNonHdh: true,
    }),
  })
  .step(SUBJECT_NODE, SeparationsMatchSeparationSubject, {
    label: "Separation Subject",
    dependsOn: [DOCUMENT_NODE, PLAN_NODE, NAME_SEARCH_NODE],
    replay: "checkpoint",
    bind: ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[PLAN_NODE].employeeName,
      documentEid: outputs[DOCUMENT_NODE].employee.eid,
      nameSelection: outputs[NAME_SEARCH_NODE].selection,
    }),
  })
  .step(JOB_SUMMARY_NODE, UcpathReadJobSummary, {
    label: "Job Summary",
    dependsOn: [SUBJECT_NODE],
    replay: "checkpoint",
    bind: ({ outputs }) => ({ emplId: outputs[SUBJECT_NODE].emplId }),
  })
  .step(EMPLOYMENT_NODE, SeparationsMatchActiveEmployment, {
    label: "Employment",
    dependsOn: [DOCUMENT_NODE, JOB_SUMMARY_NODE],
    replay: "checkpoint",
    bind: ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      jobSummary: outputs[JOB_SUMMARY_NODE],
    }),
  })
  .step(DEPARTMENT_NODE, SeparationsMatchDepartmentOption, {
    label: "Department Option",
    dependsOn: [DOCUMENT_NODE, EMPLOYMENT_NODE],
    replay: "checkpoint",
    bind: ({ input, outputs }) => ({
      deptId: outputs[EMPLOYMENT_NODE].deptId,
      department: outputs[EMPLOYMENT_NODE].department,
      // This document's OWN control, read this run — never a captured constant,
      // because a new campus department is a legitimate option nobody has to
      // teach this repository about before somebody can be separated.
      observedOptions: outputs[DOCUMENT_NODE].options.department,
      documentNumber: input.documentNumber,
    }),
  })
  .step(TIMECARD_SEARCH_NODE, NewKronosSearchEmployee, {
    label: "Timecard Search",
    dependsOn: [SUBJECT_NODE],
    /**
     * `always-rerun`, and chunk 1 paid for the rule live (`sk-124132-9beb`): the
     * search's OUTPUT is durable but its POINT is a side effect that is not — it
     * leaves the employee selected in the WFD panel, which is the only thing
     * that enables Go To. **A node whose real product is BROWSER state may not
     * be `replay: "checkpoint"`.**
     *
     * The composition pays a real cost for that: a gate resume re-runs this node
     * (the timecard replays from its checkpoint, so nothing consumes the panel),
     * which is one New Kronos session per gated run. The alternative is a
     * checkpoint that restores a selection into a browser that never made one,
     * and that is the failure chunk 1 already recorded.
     */
    replay: "always-rerun",
    bind: ({ input, outputs }) => ({
      emplId: outputs[SUBJECT_NODE].emplId,
      searchTimeoutMs: input.searchTimeoutMs,
    }),
  })
  .step(TIMECARD_NODE, NewKronosReadSeparationTimecard, {
    label: "Timecard",
    dependsOn: [SUBJECT_NODE, PLAN_NODE, TIMECARD_SEARCH_NODE],
    replay: "checkpoint",
    bind: ({ outputs }) => {
      // Reading the search's own match is what makes the dependency load-bearing
      // rather than decorative: Go To is disabled without the selection, and a
      // disabled Go To is a loud failure, never an empty card.
      requireFact(outputs[TIMECARD_SEARCH_NODE].matched, TIMECARD_SEARCH_NODE, "matched");
      return {
        emplId: outputs[SUBJECT_NODE].emplId,
        rangeStart: outputs[PLAN_NODE].timecardWindow.start,
        rangeEnd: outputs[PLAN_NODE].timecardWindow.end,
      };
    },
  })
  .step(DATES_NODE, SeparationsReadSeparationDates, {
    label: "Reconciled Dates",
    dependsOn: [PLAN_NODE, TIMECARD_NODE],
    replay: "checkpoint",
    bind: ({ input, outputs }) => ({
      plan: outputs[PLAN_NODE],
      timekeeperName: input.timekeeperName,
      lastPunchDate: outputs[TIMECARD_NODE].grid.lastPunchDate,
      sickDates: outputs[TIMECARD_NODE].grid.sickDates,
      holidayDates: outputs[TIMECARD_NODE].grid.holidayDates,
      unclassifiedPayCodes: outputs[TIMECARD_NODE].grid.unclassifiedPayCodes,
      // The window the grid was PROVED to be showing, not the one asked for
      // (S40) — a leave day outside it is a year-stamp defect, not a leave day.
      observedWindow: {
        start: outputs[TIMECARD_NODE].range.observedStart,
        end: outputs[TIMECARD_NODE].range.observedEnd,
      },
    }),
  })
  .step(COMPARISON_NODE, SeparationsMatchIdentity, {
    label: "Identity Comparison",
    /**
     * Everything the gate must have seen depends INTO this node, which is what
     * makes `identity-gate-before-commit` pass on a graph with three transaction
     * nodes: the gate's own ancestry is the whole read half, so no write can
     * consume a value the operator did not see.
     */
    dependsOn: [
      DOCUMENT_NODE, PLAN_NODE, SUBJECT_NODE, JOB_SUMMARY_NODE, NAME_SEARCH_NODE,
      TERMINATION_TYPE_NODE, DEPARTMENT_NODE, EMPLOYMENT_NODE, DATES_NODE,
    ],
    replay: "checkpoint",
    bind: ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      documentName: outputs[PLAN_NODE].employeeName,
      documentEid: outputs[DOCUMENT_NODE].employee.eid,
      emplId: outputs[SUBJECT_NODE].emplId,
      emplIdSource: outputs[SUBJECT_NODE].emplIdSource,
      jobSummary: outputs[JOB_SUMMARY_NODE],
      nameSelection: outputs[NAME_SEARCH_NODE].selection,
      /**
       * **What the writes will consume.** Chunks 4 and 5 both recorded this as
       * the composition's job in the same words, and §14.5's digest is why it
       * matters: the approval binds to these values, so a date that moves after
       * approval re-opens the gate instead of being filed on a click that never
       * saw it.
       */
      plan: {
        state: "planned" as const,
        termination: {
          terminationType: outputs[TERMINATION_TYPE_NODE].terminationType,
          classification: outputs[TERMINATION_TYPE_NODE].classification,
          template: outputs[TERMINATION_TYPE_NODE].template,
          reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
          emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
          effectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
          lastDateWorked: outputs[DATES_NODE].lastDayWorked,
          initiatorComments: outputs[DATES_NODE].terminationComments,
        },
        document: {
          documentNumber: input.documentNumber,
          department: outputs[DEPARTMENT_NODE].option,
          departmentCode: outputs[DEPARTMENT_NODE].departmentCode,
          ucpathDepartment: outputs[DEPARTMENT_NODE].ucpathDepartment,
          payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
          payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
          terminationEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
          timekeeperName: input.timekeeperName,
        },
        dates: {
          kualiLastDayWorked: outputs[DATES_NODE].kualiLastDayWorked,
          lastDayWorked: outputs[DATES_NODE].lastDayWorked,
          lastDayWorkedChanged: outputs[DATES_NODE].lastDayWorkedChanged,
          kualiSeparationDate: outputs[DATES_NODE].kualiSeparationDate,
          separationDate: outputs[DATES_NODE].separationDate,
          separationDateChanged: outputs[DATES_NODE].separationDateChanged,
          separationDeterminingLeave: outputs[DATES_NODE].separationDeterminingLeave,
          unclassifiedPayCodes: outputs[DATES_NODE].unclassifiedPayCodes,
        },
      },
    }),
  })
  .gate(GATE_NODE, {
    label: "Identity Approval",
    statusKey: "awaitingIdentityApproval",
    dependsOn: [COMPARISON_NODE],
    /**
     * `resolvedBy: "operator"` and nothing else can resolve it (§14.4). Not a
     * retry, not a bump, not a cascade, not AI (charter §23 / D60), and not a
     * generic "Done" — the kernel's ONLY path into `gate_results` is the typed
     * `resolve-gate` command, which parses this exact schema and CASes the run
     * version.
     */
    resolvedBy: "operator",
    result: IdentityApprovalResultSchema,
  })
  .step(APPROVAL_NODE, SeparationsVerifyIdentityApproval, {
    label: "Approval Check",
    dependsOn: [COMPARISON_NODE, GATE_NODE],
    /**
     * `always-rerun`: this node's whole job is to compare a stored gate result
     * against re-derived evidence, and a replayed checkpoint would be the
     * previous comparison's ANSWER standing in for the comparison.
     */
    replay: "always-rerun",
    bind: ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }),
  })
  .transaction(SWEEP_NODE, {
    label: "Clear Pending Terminations",
    dependsOn: [APPROVAL_NODE],
    prepare: {
      uses: UcpathStagePendingTerminationSweep,
      bind: ({ outputs }) => ({
        emplId: outputs[APPROVAL_NODE].approved.emplId,
        expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      }),
    },
    commit: {
      uses: UcpathDeletePendingTerminations,
      bind: ({ outputs }) => ({
        emplId: outputs[APPROVAL_NODE].approved.emplId,
        expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      }),
    },
    dryRun: "stop-after-prepare",
    probePolicy: "always",
    // Chunk 4's measured bound, unchanged: probe search open 4.6 s + search run
    // 7.4 s + detail 4.9 s ≈ 17 s to read the grid (live 2026-08-13, §9.7).
    probeToFenceMaxMs: 90_000,
  })
  .transaction(TERMINATION_NODE, {
    label: "File Termination",
    dependsOn: [APPROVAL_NODE, TERMINATION_TYPE_NODE, EMPLOYMENT_NODE, DATES_NODE, SWEEP_NODE],
    prepare: {
      uses: UcpathStageTermination,
      bind: ({ outputs }) => ({
        emplId: outputs[APPROVAL_NODE].approved.emplId,
        expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
        emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
        effectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
        template: outputs[TERMINATION_TYPE_NODE].template,
        reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
        lastDateWorked: outputs[DATES_NODE].lastDayWorked,
        initiatorComments: outputs[DATES_NODE].terminationComments,
      }),
    },
    commit: {
      uses: UcpathCreateTermination,
      bind: ({ outputs }) => ({
        emplId: outputs[APPROVAL_NODE].approved.emplId,
        expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
        emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
        effectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
        template: outputs[TERMINATION_TYPE_NODE].template,
        reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
        lastDateWorked: outputs[DATES_NODE].lastDayWorked,
        initiatorComments: outputs[DATES_NODE].terminationComments,
      }),
    },
    dryRun: "stop-after-prepare",
    probePolicy: "always",
    // Chunk 4's measured bound, unchanged: ≈32.4 s of live wizard staging on
    // top of ≈17 s of probe (2026-08-13, §9.7), and 120 s is ~3.7x that.
    probeToFenceMaxMs: 120_000,
  })
  .step(RECEIPT_NODE, SeparationsVerifyTerminationReceipt, {
    label: "Termination Receipt",
    dependsOn: [APPROVAL_NODE, DATES_NODE, TERMINATION_NODE],
    /**
     * `always-rerun`, for `approval`'s reason: this node's job is to CHECK a
     * proof, and a replayed checkpoint would be the previous check's answer
     * standing in for the check. It is a pure fold over a durable proof, so
     * re-running it costs nothing and reaches no browser.
     */
    replay: "always-rerun",
    bind: ({ outputs }) => ({
      // A transaction node's scope value is the typed outcome envelope (D144);
      // `output` is the COMMIT contract's own bare output.
      proof: outputs[TERMINATION_NODE].output.receipt,
      disposition: outputs[TERMINATION_NODE].disposition,
      approvedEmplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
    }),
  })
  .transaction(FINALIZE_NODE, {
    label: "Finalize Kuali Document",
    dependsOn: [
      APPROVAL_NODE, DOCUMENT_NODE, PLAN_NODE, EMPLOYMENT_NODE, DEPARTMENT_NODE,
      DATES_NODE, RECEIPT_NODE,
    ],
    prepare: {
      uses: KualiStageSeparationFinalization,
      bind: ({ input, outputs }) => ({
        actionId: input.actionId,
        documentNumber: input.documentNumber,
        emplId: outputs[APPROVAL_NODE].approved.emplId,
        variables: {
          department: outputs[DEPARTMENT_NODE].option,
          payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
          payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
          timekeeperName: input.timekeeperName,
          terminationEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
          transactionNumber: outputs[RECEIPT_NODE].transactionNumber,
          timekeeperComments: buildFinalizationComments({
            existingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
            dateChangeComments: outputs[DATES_NODE].dateChangeComments,
            documentNumber: input.documentNumber,
            transactionNumber: outputs[RECEIPT_NODE].transactionNumber,
            initials: separationInitials(input.timekeeperName),
            asOfDate: outputs[PLAN_NODE].asOfDate,
          }),
          observedExistingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
        },
      }),
    },
    commit: {
      /**
       * The SAME target the prepare staged, bound from workflow input plus the
       * gate-approved identity and the folds — never from the prepare's own
       * output. That is what makes the permanent key stable before any page
       * mutation (doc 02 §3.1), and what the beat-⑥ read-back compares against.
       */
      uses: KualiSaveSeparationFinalization,
      bind: ({ input, outputs }) => ({
        actionId: input.actionId,
        documentNumber: input.documentNumber,
        emplId: outputs[APPROVAL_NODE].approved.emplId,
        variables: {
          department: outputs[DEPARTMENT_NODE].option,
          payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
          payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
          timekeeperName: input.timekeeperName,
          terminationEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
          transactionNumber: outputs[RECEIPT_NODE].transactionNumber,
          timekeeperComments: buildFinalizationComments({
            existingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
            dateChangeComments: outputs[DATES_NODE].dateChangeComments,
            documentNumber: input.documentNumber,
            transactionNumber: outputs[RECEIPT_NODE].transactionNumber,
            initials: separationInitials(input.timekeeperName),
            asOfDate: outputs[PLAN_NODE].asOfDate,
          }),
          observedExistingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
        },
      }),
    },
    dryRun: "stop-after-prepare",
    probePolicy: "always",
    // Chunk 5's bound, CONFIRMED live 2026-08-14 (§9.12 item 6): probe 3.30 s +
    // prepare 8.06 s = 11.4 s worst legs against 45 000 ms, ~4x headroom.
    probeToFenceMaxMs: 45_000,
  })
  .build({
    schema: SeparationsResultSchema,
    dependsOn: [
      APPROVAL_NODE, EMPLOYMENT_NODE, DEPARTMENT_NODE, DATES_NODE, RECEIPT_NODE,
      SWEEP_NODE, TERMINATION_NODE, FINALIZE_NODE,
    ],
    derive: ({ outputs }) => ({
      documentNumber: outputs[APPROVAL_NODE].documentNumber,
      approved: outputs[APPROVAL_NODE].approved,
      employment: {
        emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
        payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
        payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
      },
      department: {
        option: outputs[DEPARTMENT_NODE].option,
        departmentCode: outputs[DEPARTMENT_NODE].departmentCode,
      },
      dates: {
        kualiLastDayWorked: outputs[DATES_NODE].kualiLastDayWorked,
        lastDayWorked: outputs[DATES_NODE].lastDayWorked,
        kualiSeparationDate: outputs[DATES_NODE].kualiSeparationDate,
        separationDate: outputs[DATES_NODE].separationDate,
        terminationEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
        lastDayWorkedChanged: outputs[DATES_NODE].lastDayWorkedChanged,
        separationDateChanged: outputs[DATES_NODE].separationDateChanged,
      },
      pendingSweep: {
        disposition: outputs[SWEEP_NODE].disposition,
        proof: outputs[SWEEP_NODE].output.cleared,
      },
      termination: outputs[RECEIPT_NODE],
      finalization: {
        disposition: outputs[FINALIZE_NODE].disposition,
        proof: outputs[FINALIZE_NODE].output.savedState,
      },
    }),
  });

export const separationsDescriptor = defineWorkflowDescriptor({
  id: "separations",
  version: 1,
  contractFingerprint: resolveWorkflowFingerprint(
    BUILD_MANIFEST,
    WorkflowIdSchema.parse("separations"),
  ),
  code: "sp",
  label: "Separation",
  icon: "ShieldCheck",
  category: "separation",
  canonicalInput: SeparationsCanonicalInput,
  inputSubject: "document",
  surface: { shape: "single" },
  /**
   * `reject-active` per item — and the item is the document plus the operator's
   * re-read ordinal. Two concurrent runs on one separation document is never
   * intended, and doc 09's same-key mutex refuses the second fence anyway;
   * **S5** is why the mutex matters more than the enqueue policy, because
   * legacy's enqueue-supersede only cancels non-terminal prior runs, so a
   * completed document could be re-run with nothing but two live page probes
   * standing between it and a second termination.
   */
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  /**
   * No `inputRun` surface: the paste-a-line parser splits ONE token per item and
   * this ingress is three correlated values, so a parser here would have to
   * invent the two it did not receive. Runs start through the generic start-plan
   * / command path with structured input, and the queue and run-detail wires
   * already render this workflow off the registry.
   */
  surfaces: {},
  /**
   * No `capabilities` block, and here it is a SAFETY property. Every value this
   * graph would let Edit Data patch is a value some read established: the punch
   * date, the department, the EID, the payroll title. Correcting one of those
   * without a live read behind it is exactly the substitution §4b removed from
   * the timecard path, arriving through the correction rail instead. The one
   * thing an operator may change about a run is the gate decision, and that goes
   * through the typed gate command; the one way to get fresh reads is `reRead`,
   * which is a NEW run over a new item rather than a patch over an old one.
   */
  verdicts: [
    { key: "name-differs", label: "Name differs from UCPath", tone: "warning", tag: true },
    { key: "eid-name-resolved", label: "EID resolved by name", tone: "warning", tag: true },
    { key: "dates-moved", label: "Kronos moved the dates", tone: "neutral", tag: true },
    { key: "unclassified-pay-codes", label: "Unclassified pay codes", tone: "warning", tag: true },
  ],
  details: [
    {
      key: "ucpath-name",
      label: "UCPath shows",
      source: { nodeId: JOB_SUMMARY_NODE, fieldPath: "displayedName" },
      display: "text",
    },
    {
      key: "template",
      label: "Template",
      source: { nodeId: TERMINATION_TYPE_NODE, fieldPath: "template" },
      display: "text",
    },
    {
      key: "reason-code",
      label: "Reason code",
      source: { nodeId: TERMINATION_TYPE_NODE, fieldPath: "reasonCode" },
      display: "text",
    },
    {
      key: "last-day-worked",
      label: "Last day worked",
      source: { nodeId: DATES_NODE, fieldPath: "lastDayWorked" },
      display: "text",
    },
    {
      key: "effective-date",
      label: "Termination effective",
      source: { nodeId: DATES_NODE, fieldPath: "terminationEffectiveDate" },
      display: "text",
    },
    {
      key: "department",
      label: "Department",
      source: { nodeId: DEPARTMENT_NODE, fieldPath: "option" },
      display: "text",
    },
    {
      key: "transaction-id",
      // A transaction node's field paths are the COMMIT contract's bare output
      // (D144) — `{ receipt }`, not the `TypedTransactionOutcome` envelope.
      label: "Transaction",
      source: { nodeId: TERMINATION_NODE, fieldPath: "receipt.transactionId" },
      display: "text",
    },
    {
      key: "approval-status",
      label: "Transaction status",
      source: { nodeId: TERMINATION_NODE, fieldPath: "receipt.approvalStatus" },
      display: "text",
    },
  ],
  identity: {
    /**
     * The ITEM is the DOCUMENT — one separation document is one separation — and
     * the operator's explicit re-read ordinal, which is §"the re-run wall" item
     * 2's whole affordance: a re-read is a new logical item with fresh
     * checkpoints and its own gate, not a replay collision against reads whose
     * `observedAt` differs by construction. It changes no permanent key, so a
     * re-read can never file a second termination.
     */
    matchKey: (input) => (input.reRead === undefined
      ? `separations:${input.documentNumber}`
      : `separations:${input.documentNumber}#re-read-${String(input.reRead.ordinal)}`),
  },
  presentation: {
    title: (input) => `Separation ${input.documentNumber}`,
    subtitle: (input) => (input.reRead === undefined
      ? `Kuali action ${input.actionId.slice(0, 8)}…`
      : `re-read ${String(input.reRead.ordinal)} — ${input.reRead.reason}`),
  },
  scenarios: [
    "separations/plan-refusals",
    "separations/subject-resolution",
    "separations/employment-refusals",
    "separations/date-reconciliation",
    "separations/receipt-refusals",
    "separations/kronos-hard-fails",
    "separations/gate-approved",
    "separations/dry-run-preview",
    "separations/subject-mismatch",
    "separations/pending-sweep-committed",
    "separations/pending-sweep-nothing-to-do",
    "separations/termination-committed",
    "separations/termination-already-present",
    "separations/finalization-committed",
    "separations/finalization-already-present",
    "separations/finalization-parks-after-termination",
    "separations/re-read-is-a-new-item",
    "separations/gate-resume-shape",
  ],
  flow: separationsFlow,
});
