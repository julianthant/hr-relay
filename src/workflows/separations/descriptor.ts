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
 * ref write-safety §14.3, and D26, which forbids any park between `prepare` and `commit`.
 * So the ALWAYS-GATE opens once, after the last read, before the first fence.
 *
 * §5A widened that gap on purpose (`maxAgeMs: Infinity` on the three reads —
 * the separation document is a saved, stable artifact and refresh is a
 * deliberate operator RE-RUN, never an age check firing mid-run), which is what
 * makes the packet's write-plan block load-bearing: the operator approves the
 * VALUES, and §14.5's digest binds the approval to them.
 *
 * ## Three transaction nodes, in ref write-safety's order
 *
 * `clear-pending` (S30/S31 — legacy's first mutation, unfenced and unverified)
 * → `file-termination` (the real HR write) → `finalize-kuali` (§4e's one save
 * over twelve staged fields). Each carries its own permanent key, its own probe and
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
import { WorkflowIdSchema } from "../../domain/ids.js";
import { ApprovedIdentitySubjectSchema } from "../../domain/separations/identity-approval.js";
import {
  buildFinalizationComments,
  separationInitials,
} from "../../domain/separations/separation-dates.js";
import { TerminationReceiptSchema } from "../../domain/separations/termination-receipt.js";
import {
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
import {
  APPROVAL_NODE,
  COMPARISON_NODE,
  GATE_NODE,
  IDENTITY_CHECK_STEP_NODES,
  NAME_SEARCH_NODE,
  SUBJECT_NODE,
  approvalNode,
  comparisonNode,
  identityApprovalGate,
  nameSearchNode,
  subjectNode,
} from "./identity-check/nodes.js";
import {
  DEPARTMENT_NODE,
  EMPLOYMENT_NODE,
  JOB_SUMMARY_NODE,
  JOB_SUMMARY_STEP_NODES,
  departmentOptionNode,
  employmentNode,
  jobSummaryNode,
} from "./job-summary/nodes.js";
import {
  DATES_NODE,
  KRONOS_TIMECARD_STEP_NODES,
  TIMECARD_NODE,
  TIMECARD_SEARCH_NODE,
  datesNode,
  timecardNode,
  timecardSearchNode,
} from "./kronos-timecard/nodes.js";
import {
  ACTION_NODE,
  DOCUMENT_NODE,
  KUALI_EXTRACTION_STEP_NODES,
  PLAN_NODE,
  TERMINATION_TYPE_NODE,
  actionNode,
  documentNode,
  planNode,
  terminationTypeNode,
} from "./kuali-extraction/nodes.js";
import {
  FINALIZE_NODE,
  KUALI_FINALIZATION_STEP_NODES,
  existingComments,
  finalizeKualiNode,
} from "./kuali-finalization/nodes.js";
import {
  RECEIPT_NODE,
  SWEEP_NODE,
  TERMINATION_NODE,
  UCPATH_TRANSACTION_STEP_NODES,
  clearPendingNode,
  fileTerminationNode,
  receiptNode,
} from "./ucpath-transaction/nodes.js";

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
  /**
   * The ONE varying value a run carries — D261, and the operator's ruling of
   * 2026-08-20: *"document number should work. no need action id."*
   *
   * Kuali's `actionId` used to sit beside it, because `…/actions/<actionId>` is
   * the only address Kuali offers. D260 measured the consequence: two varying
   * values per run, and therefore no typed start box, because `EntryRule.emit`
   * is a single field and `constants[]` can only carry a value that does not
   * vary. The id is now a GRAPH OUTPUT — the `resolve-action` node reads it off
   * the Action List's own row — so this schema has exactly one required field
   * that varies per run and the modal has a box.
   *
   * The number keeps doing its old job unchanged: it is the run's own CLAIM,
   * proved against the document's level-1 heading before anything else runs
   * (D129 — an `actionId` names a workflow STEP, not a document). Resolving the
   * id from the number does not weaken that check; it is now proved TWICE, once
   * against the Action-List link's anchored accessible name and once against
   * the opened document's heading.
   */
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
      documentNumber: "4510",
      timekeeperName: "Julian Zaw",
    },
    {
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


const separationsFlow = flow(SeparationsInput)
  .pipe(actionNode.wire({
    dependsOn: [],
    bind: ({ input }) => ({ documentNumber: input.documentNumber }),
  }))
  .pipe(documentNode.wire({
    dependsOn: [ACTION_NODE],
    bind: ({ input, outputs }) => ({
      actionId: outputs[ACTION_NODE].actionId,
      documentNumber: input.documentNumber,
    }),
  }))
  .pipe(planNode.wire({
    dependsOn: [DOCUMENT_NODE],
    bind: ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[DOCUMENT_NODE].employee.name,
      lastDayWorked: outputs[DOCUMENT_NODE].separation.lastDayWorked,
      separationDate: outputs[DOCUMENT_NODE].separation.separationDate,
      // S7's reference is the READ's own instant, not a clock: the refusal then
      // says what is true — *as of the moment this run read the document*.
      observedAt: outputs[DOCUMENT_NODE].observedAt,
    }),
  }))
  .pipe(terminationTypeNode.wire({
    dependsOn: [DOCUMENT_NODE],
    bind: ({ input, outputs }) => ({
      terminationType: outputs[DOCUMENT_NODE].separation.terminationType,
      // The complete option list this run ACTUALLY observed, so a republished
      // control refuses on the first run that sees it (§4a's accepted cost).
      observedOptions: outputs[DOCUMENT_NODE].options.terminationType,
      documentNumber: input.documentNumber,
    }),
  }))
  .pipe(nameSearchNode.wire({
    dependsOn: [PLAN_NODE],
    // `keepNonHdh: true`, always, and UNCONDITIONALLY run — the fragment's own
    // doc says why; the composition feeds it the plan's employee name.
    bind: ({ outputs }) => ({
      kind: "by-name" as const,
      name: outputs[PLAN_NODE].employeeName,
      keepNonHdh: true,
    }),
  }))
  .pipe(subjectNode.wire({
    dependsOn: [DOCUMENT_NODE, PLAN_NODE, NAME_SEARCH_NODE],
    bind: ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[PLAN_NODE].employeeName,
      documentEid: outputs[DOCUMENT_NODE].employee.eid,
      nameSelection: outputs[NAME_SEARCH_NODE].selection,
    }),
  }))
  .pipe(jobSummaryNode.wire({
    dependsOn: [SUBJECT_NODE],
    bind: ({ outputs }) => ({ emplId: outputs[SUBJECT_NODE].emplId }),
  }))
  .pipe(employmentNode.wire({
    dependsOn: [DOCUMENT_NODE, JOB_SUMMARY_NODE],
    bind: ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      jobSummary: outputs[JOB_SUMMARY_NODE],
    }),
  }))
  .pipe(departmentOptionNode.wire({
    dependsOn: [DOCUMENT_NODE, EMPLOYMENT_NODE],
    bind: ({ input, outputs }) => ({
      deptId: outputs[EMPLOYMENT_NODE].deptId,
      department: outputs[EMPLOYMENT_NODE].department,
      // This document's OWN control, read this run — never a captured constant,
      // because a new campus department is a legitimate option nobody has to
      // teach this repository about before somebody can be separated.
      observedOptions: outputs[DOCUMENT_NODE].options.department,
      documentNumber: input.documentNumber,
    }),
  }))
  .pipe(timecardSearchNode.wire({
    dependsOn: [SUBJECT_NODE],
    bind: ({ input, outputs }) => ({
      emplId: outputs[SUBJECT_NODE].emplId,
      searchTimeoutMs: input.searchTimeoutMs,
    }),
  }))
  .pipe(timecardNode.wire({
    dependsOn: [SUBJECT_NODE, PLAN_NODE, TIMECARD_SEARCH_NODE],
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
  }))
  .pipe(datesNode.wire({
    dependsOn: [PLAN_NODE, TIMECARD_NODE],
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
  }))
  .pipe(comparisonNode.wire({
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
  }))
  .pipe(identityApprovalGate.wire({ dependsOn: [COMPARISON_NODE] }))
  .pipe(approvalNode.wire({
    dependsOn: [COMPARISON_NODE, GATE_NODE],
    bind: ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }),
  }))
  .pipe(clearPendingNode.wire({
    dependsOn: [APPROVAL_NODE],
    prepare: { bind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
    }) },
    commit: { bind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
    }) },
  }))
  .pipe(fileTerminationNode.wire({
    dependsOn: [APPROVAL_NODE, TERMINATION_TYPE_NODE, EMPLOYMENT_NODE, DATES_NODE, SWEEP_NODE],
    prepare: { bind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
      effectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
      template: outputs[TERMINATION_TYPE_NODE].template,
      reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
      lastDateWorked: outputs[DATES_NODE].lastDayWorked,
      initiatorComments: outputs[DATES_NODE].terminationComments,
    }) },
    commit: { bind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
      effectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
      template: outputs[TERMINATION_TYPE_NODE].template,
      reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
      lastDateWorked: outputs[DATES_NODE].lastDayWorked,
      initiatorComments: outputs[DATES_NODE].terminationComments,
    }) },
  }))
  .pipe(receiptNode.wire({
    dependsOn: [APPROVAL_NODE, DATES_NODE, TERMINATION_NODE],
    bind: ({ outputs }) => ({
      // A transaction node's scope value is the typed outcome envelope (D144);
      // `output` is the COMMIT contract's own bare output.
      proof: outputs[TERMINATION_NODE].output.receipt,
      disposition: outputs[TERMINATION_NODE].disposition,
      approvedEmplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
    }),
  }))
  .pipe(finalizeKualiNode.wire({
    dependsOn: [
      APPROVAL_NODE, ACTION_NODE, DOCUMENT_NODE, PLAN_NODE, EMPLOYMENT_NODE, DEPARTMENT_NODE,
      DATES_NODE, RECEIPT_NODE,
    ],
    prepare: { bind: ({ input, outputs }) => ({
      actionId: outputs[ACTION_NODE].actionId,
      documentNumber: input.documentNumber,
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      variables: {
        department: outputs[DEPARTMENT_NODE].option,
        payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
        payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
        timekeeperName: input.timekeeperName,
        // §4e's 2026-08-14 amendment — legacy's step-13 write-backs, staged
        // from the RECONCILED variables and UNCONDITIONALLY. When nothing
        // moved these equal what the document already carries, so the save
        // writes the same string back and the read-back proves it either way;
        // a conditional stage would need an expectation composed from the
        // page's own prior value, which is the re-read §4e forbids.
        lastDayWorked: outputs[DATES_NODE].lastDayWorked,
        separationDate: outputs[DATES_NODE].separationDate,
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
    }) },
    /**
     * The SAME target the prepare staged, bound from workflow input plus the
     * gate-approved identity and the folds — never from the prepare's own
     * output. That is what makes the permanent key stable before any page
     * mutation (ref workflow-model §3.1), and what the beat-⑥ read-back compares against.
     */
    commit: { bind: ({ input, outputs }) => ({
      actionId: outputs[ACTION_NODE].actionId,
      documentNumber: input.documentNumber,
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      variables: {
        department: outputs[DEPARTMENT_NODE].option,
        payrollTitleCode: outputs[EMPLOYMENT_NODE].payrollTitleCode,
        payrollTitle: outputs[EMPLOYMENT_NODE].payrollTitle,
        timekeeperName: input.timekeeperName,
        // §4e's 2026-08-14 amendment, bound identically to the prepare's.
        lastDayWorked: outputs[DATES_NODE].lastDayWorked,
        separationDate: outputs[DATES_NODE].separationDate,
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
    }) },
  }))
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
  summary:
    "The composition: ONE Kuali RRSS separation document becomes ONE terminated employee across three "
    + "systems. It reads Kuali, UCPath and Kronos, reconciles the dates against what the timecard "
    + "actually shows, parks for a human to confirm the person, then clears any pending termination, "
    + "files the termination, verifies the receipt, and finalizes the Kuali document.",
  icon: "ShieldCheck",
  category: "separation",
  canonicalInput: SeparationsCanonicalInput,
  inputSubject: "document",
  surface: { shape: "single" },
  /**
   * `reject-active` per item — and the item is the document plus the operator's
   * re-read ordinal. Two concurrent runs on one separation document is never
   * intended, and ref write-safety's same-key mutex refuses the second fence anyway;
   * **S5** is why the mutex matters more than the enqueue policy, because
   * legacy's enqueue-supersede only cancels non-terminal prior runs, so a
   * completed document could be re-run with nothing but two live page probes
   * standing between it and a second termination.
   */
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  /**
   * **The one-box door (D261).** D260 refused to build this surface and stated
   * exactly what would unblock it: `inputRun` carries ONE varying value per
   * run, and `separations` needed two. The operator ruled *"document number
   * should work. no need action id."*, the graph's new head node resolves the
   * action from the number, and the schema now has exactly one required field
   * that varies — so the modal has a box and the rule D260 wrote is unchanged.
   *
   * `timekeeperName` rides in `constants[]`, which is only legitimate because
   * it does not vary per RUN — §9.16 decision 6a-2 ratified it as ingress, and
   * D260's own table records it as constant *per operator*. That is the honest
   * scope of this constant and it is worth stating where somebody will read it:
   * it is a fact about WHO is filing, baked into a bundle-safe descriptor, and
   * the trigger that ends it is a SECOND timekeeper — at which point it must
   * become a typed form field (D260 shape 1) rather than a second constant.
   * `config.operator.timekeeperName` stays deliberately unused: a descriptor is
   * bundle-safe and cannot read config, and a value retained in the canonical
   * input is one `explain run` can show for the run that used it.
   */
  surfaces: {
    inputRun: {
      placeholder: "Enter Kuali document numbers, semicolon-separated (e.g. 4502; 4510)",
      parser: {
        split: { kind: "delimited", delimiters: [";", "\n"] },
        /**
         * ONE rule and NO `otherwise` arm, deliberately. A separation is filed
         * against a Kuali document and there is no second thing this box could
         * mean, so an entry that is not a document number refuses the whole box
         * and starts nothing — which `inputRunParserLabel` says out loud before
         * an operator pastes forty lines. An `otherwise` arm here would send
         * arbitrary text into `documentNumber` for the input schema to refuse
         * one layer later, with a worse message.
         */
        rules: [
          { when: { kind: "pattern", pattern: "document-number" }, emit: "documentNumber" },
        ],
        constants: [
          { field: "timekeeperName", value: { kind: "text", text: "Julian Zaw" } },
        ],
      },
      /**
       * D250. Both texts are real document numbers this migration has read live
       * (4502 on 2026-08-12 and again on 2026-08-20; 4510 on 2026-08-12), and
       * the factory proves each one parses AND satisfies `SeparationsInput`
       * before this descriptor exists. The pair shows the one thing a
       * placeholder cannot: that the SAME box starts several separations at
       * once, one run per document.
       */
      examples: [
        {
          key: "one-document",
          label: "One document",
          text: "4502",
          note: "the ordinary case — one run for one Kuali separation document",
        },
        {
          key: "two-documents",
          label: "Two documents",
          text: "4502; 4510",
          note: "two runs from one box: each document number starts its own separation, and the "
            + "action id for each is resolved from the Kuali Action List at run time",
        },
      ],
    },
  },
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
  /**
   * Ref dashboard-surfaces §1.2: the queue row starts as `Separation 4502` — the only thing the
   * start input knows — and becomes the PERSON the moment UCPath's Job Summary
   * has answered. Three separations rows on one real day carried the same
   * document number, so the column an operator scans distinguished nothing.
   *
   * `job-summary.displayedName` and not the Kuali document's own employee name:
   * the whole point of the identity chunk is that the Kuali form's name is the
   * CLAIM and UCPath's is the record, and the queue row must not print a name
   * the gate has not yet compared. Before that node runs, the document number
   * stands.
   */
  subjectProjection: { nodeId: JOB_SUMMARY_NODE, fieldPath: "displayedName" },
  /**
   * D225 — the operator-approved categorical timeline (2026-08-18, separations
   * §9.18): six categories over the nineteen nodes, each keyed (D265) by the
   * step folder that owns its nodes, legacy's step vocabulary
   * kept where it fits. Each category is IMPORTED whole from the folder that is
   * the step (D265 §1.2.2 rule 2): its key and label from the folder's
   * `step.ts`, its member ids from the folder's own node fragments — this
   * declaration only lists the six, so a folder and its category cannot come
   * to disagree about what the step is called or which nodes it owns.
   * Legacy's `transaction-check` folds into *UCPath
   * transaction*, because here the pending check is the sweep transaction plus
   * the in-write probes, not a standalone step. The gate is a MEMBER of
   * *Identity check* — a wait is a state of a step, not a step of its own —
   * and the always-rerun re-executions around a gate resume fold into their
   * category's `×N` marker instead of drawing duplicate segments.
   */
  timeline: [
    KUALI_EXTRACTION_STEP_NODES,
    IDENTITY_CHECK_STEP_NODES,
    JOB_SUMMARY_STEP_NODES,
    KRONOS_TIMECARD_STEP_NODES,
    UCPATH_TRANSACTION_STEP_NODES,
    KUALI_FINALIZATION_STEP_NODES,
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
    /**
     * D261 removed the action id from the ingress, so the subtitle no longer
     * has one to abbreviate — and it never should have carried it: an operator
     * reading a queue row learns nothing from eight hex characters of a
     * workflow-step address. The filer is the fact the row was missing.
     */
    subtitle: (input) => (input.reRead === undefined
      ? `Filed by ${input.timekeeperName}`
      : `re-read ${String(input.reRead.ordinal)} — ${input.reRead.reason}`),
  },
  /** D229 — the descriptor's own words about each node, projected by the explorer. */
  nodePurposes: [
    {
      nodeId: "resolve-action",
      purpose: "Turns the Kuali document number the operator typed into the action id Kuali is actually "
        + "addressed by, by filtering the Action List's own search box and reading the matched row's link. "
        + "It refuses a document nobody holds an action on, and refuses two actions for one number.",
    },
    {
      nodeId: "document",
      purpose: "Reads the entire Kuali RRSS separation request form in ONE page visit: the employee, the "
        + "separation dates, the comments, and every control's own option list as this run observed it.",
    },
    {
      nodeId: "termination-type",
      purpose: "Resolves the document's termination type to the UCPath template and reason code it files under, "
        + "refusing a type nobody has mapped. Pure: it reaches no browser.",
    },
    {
      nodeId: "name-search",
      purpose: "Searches UCPath Person Org by the document's employee name, unconditionally, so the operator "
        + "sees every person that name matches rather than only the ones a similarity threshold selected.",
    },
    {
      nodeId: "job-summary",
      purpose: "Reads the subject's whole UCPath job summary grid verbatim — every row, every status — and "
        + "classifies nothing; the disposition is a separate, pure fold.",
    },
    {
      nodeId: "department-option",
      purpose: "Resolves the subject's UCPath department to the exact option this document's OWN control offers, "
        + "refusing one the control does not carry. Pure: it reaches no browser.",
    },
    {
      nodeId: "comparison",
      purpose: "Builds the identity evidence packet the gate shows — DISCONFIRMING evidence first — and the "
        + "digest an approval binds to. Pure: it reaches no browser.",
    },
    {
      nodeId: "identity-approval",
      purpose: "The ALWAYS-GATE. A human confirms this is the right person before anything downstream may "
        + "consume the identity, and only the typed resolve-gate command can settle it.",
    },
    {
      nodeId: "approval",
      purpose: "Re-derives the evidence and checks the stored approval against it, so an approval of a packet "
        + "that has since moved cannot stand. It re-runs on every attempt rather than replaying its own "
        + "previous answer.",
    },
    {
      nodeId: "clear-pending",
      purpose: "Sweeps any pending termination already sitting on the subject's record, so the filing below is "
        + "not the second one. It probes before it fences, and a dry run stops after staging.",
    },
    {
      nodeId: "file-termination",
      purpose: "Files the termination through the UCPath Smart HR wizard — the real write. It probes for a "
        + "filing that already exists, fences before the click, and a dry run stops after staging.",
    },
    {
      nodeId: "finalize-kuali",
      purpose: "Stages every finalization field in ONE pass from the reconciled variables, saves once, and "
        + "proves the save by reloading and comparing each written field against exactly what was staged.",
    },
    {
      nodeId: "plan",
      purpose: "Derives the separation plan from the document — the employee's name, the dates to reconcile, and "
        + "the timecard window to read — as of the instant this run READ the document, never a clock.",
    },
    {
      nodeId: "subject",
      purpose: "Reduces the name-search candidates to the ONE person this separation is about, using the "
        + "document's own EID. A grid it cannot reduce to one row is a run that cannot compute what it is "
        + "about to write, so it refuses before the gate opens.",
    },
    {
      nodeId: "employment",
      purpose: "Folds the job summary into the employment facts the filing needs — empl record, department, "
        + "payroll title — and refuses a subject with no active job.",
    },
    {
      nodeId: "timecard-search",
      purpose: "Searches the New Kronos WFD panel for the employee and leaves them SELECTED — the selection is "
        + "what enables Go To, so this node's real product is browser state and it re-runs on every "
        + "attempt.",
    },
    {
      nodeId: "timecard",
      purpose: "Opens the selected employee's timecard and reads the whole separation window — last punch, sick "
        + "and holiday days, and any pay code nobody has classified — refusing a range it cannot prove the "
        + "grid was showing.",
    },
    {
      nodeId: "dates",
      purpose: "Reconciles the Kuali dates against what the timecard actually shows: the last day worked, the "
        + "separation date, the termination effective date, and the comments that explain any move.",
    },
    {
      nodeId: "receipt",
      purpose: "Checks the receipt the filing produced against the approved subject and the effective date. It "
        + "re-runs on every attempt rather than replaying its own previous answer.",
    },
  ],
  scenarios: [
    "separations/action-resolved",
    "separations/action-not-in-action-list",
    "separations/action-ambiguous",
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
