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
 * ## No branch; one identity-origin condition
 *
 * §4b's hard-fail removed the legacy arm that skipped Kronos for a non-HDH
 * department. The only declared condition is the operator identity gate: it is
 * required for `name-resolved` identity and skipped for an independently
 * supplied EID that UCPath actually reads back. No run mode, caller or frontend
 * controls that condition.
 *
 * ## The reads all land first, and the GATE sits in the gap they leave
 *
 * §4e is normative: every read lands as a typed variable before anything is
 * written, and the whole write half consumes those variables rather than
 * re-deriving anything at fill time. Identity authority sits between the two
 * halves — ref write-safety §14.3, and D26, which forbids any park between
 * `prepare` and `commit`. The operator gate opens there only for name-resolved
 * identity; supplied-EID machine verification settles at the same seam.
 *
 * §5A widened that gap on purpose (`maxAgeMs: Infinity` on the three reads —
 * the separation document is a saved, stable artifact and refresh is a
 * deliberate operator RE-RUN, never an age check firing mid-run), which is what
 * makes the packet's write-plan block load-bearing: the authority task verifies
 * those VALUES, and §14.5's digest binds either machine or operator authority
 * to them.
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
import { OmittedStepResultArmSchema } from "../../domain/workflow/step-omission.js";
import { KUALI_FINALIZATION_STEP } from "./kuali-finalization/step.js";
import { UCPATH_TRANSACTION_STEP } from "./ucpath-transaction/step.js";
import { compileWorkflowRecipe, defineWorkflowRecipe } from "../../base/workflow-recipe.js";
import { requireFact } from "../../base/workflow.js";
import { WorkflowIdSchema } from "../../domain/ids.js";
import { ResolvedIdentitySubjectSchema } from "../../domain/separations/identity-approval.js";
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
import { UcpathPendingSweepHistoricalOrCurrentProofSchema } from "../../domain/ui/ucpath-smart-hr-termination.js";
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
  NAME_SEARCH_NODE,
  SUBJECT_NODE,
  approvalNode,
  comparisonNode,
  identityApprovalGate,
  nameSearchNode,
  subjectNode,
} from "./identity-check/nodes.js";
import { IDENTITY_CHECK_STEP } from "./identity-check/step.js";
import {
  DEPARTMENT_NODE,
  EMPLOYMENT_NODE,
  JOB_SUMMARY_NODE,
  departmentOptionNode,
  employmentNode,
  jobSummaryNode,
} from "./job-summary/nodes.js";
import { JOB_SUMMARY_STEP } from "./job-summary/step.js";
import {
  DATES_NODE,
  TIMECARD_NODE,
  TIMECARD_SEARCH_NODE,
  datesNode,
  timecardNode,
  timecardSearchNode,
} from "./kronos-timecard/nodes.js";
import { KRONOS_TIMECARD_OMISSION } from "./kronos-timecard/omission.js";
import { KRONOS_TIMECARD_STEP } from "./kronos-timecard/step.js";
import {
  ACTION_NODE,
  DOCUMENT_NODE,
  PLAN_NODE,
  TERMINATION_TYPE_NODE,
  actionNode,
  documentNode,
  planNode,
  terminationTypeNode,
} from "./kuali-extraction/nodes.js";
import { KUALI_EXTRACTION_STEP } from "./kuali-extraction/step.js";
import {
  FILING_PRESENCE_NODE,
  FINALIZE_NODE,
  existingComments,
  filingPresenceNode,
  finalizeKualiNode,
} from "./kuali-finalization/nodes.js";
import { KUALI_FINALIZATION_OMISSION } from "./kuali-finalization/omission.js";
import {
  PENDING_SET_NODE,
  RECEIPT_NODE,
  SWEEP_NODE,
  TERMINATION_NODE,
  clearPendingNode,
  fileTerminationNode,
  pendingSetNode,
  receiptNode,
} from "./ucpath-transaction/nodes.js";
import { UCPATH_TRANSACTION_OMISSION } from "./ucpath-transaction/omission.js";

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

// D307 — the performed arms below keep their pre-D307 shape byte for byte, so
// every earlier result still parses; the omitted arm is the domain's.
export const SeparationsResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  /** The subject established by machine verification or operator approval. */
  approved: ResolvedIdentitySubjectSchema,
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
  pendingSweep: z.union([
    z.strictObject({
      disposition: z.enum(["committed", "already-present"]),
      proof: UcpathPendingSweepHistoricalOrCurrentProofSchema,
    }),
    OmittedStepResultArmSchema,
  ]),
  /**
   * §4c's completion shape: the receipt PAIR, checked rather than carried. The
   * number alone is never a proof (D130).
   */
  termination: TerminationReceiptSchema,
  /** The finalization's landing proof — always the reload read-back's (D128/S59). */
  finalization: z.union([
    z.strictObject({
      disposition: z.enum(["committed", "already-present"]),
      proof: KualiSavedFinalizationProofSchema,
    }),
    OmittedStepResultArmSchema,
  ]),
});


/**
 * D307 — a terminal derive reads an omitted node as `undefined` even though
 * the scope type says otherwise (the factory admits the `step-omitted` arm
 * only for nodes of an omittable step). Widening here is a declared read of
 * that arm, not a fallback: the value is either the node's real output or the
 * named omission, never a default.
 */
function omittedOr<T, R>(
  value: T,
  step: string,
  present: (value: T) => R,
): R | Readonly<{ state: "omitted"; step: string }> {
  const widened: T | undefined = value;
  return widened === undefined ? Object.freeze({ state: "omitted" as const, step }) : present(widened);
}

export const separationsRecipe = defineWorkflowRecipe(
  SeparationsInput,
  ({ group, taskFromFragment, transactionFromFragment, gateFromFragment, result }) => {
    const action = taskFromFragment(actionNode, [], ({ input }) => ({
      documentNumber: input.documentNumber,
    }));
    const document = taskFromFragment(documentNode, [action], ({ input, outputs }) => ({
      actionId: outputs[ACTION_NODE].actionId,
      documentNumber: input.documentNumber,
    }));
    const plan = taskFromFragment(planNode, [document], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[DOCUMENT_NODE].employee.name,
      lastDayWorked: outputs[DOCUMENT_NODE].separation.lastDayWorked,
      separationDate: outputs[DOCUMENT_NODE].separation.separationDate,
      // S7's reference is the READ's own instant, not a clock: the refusal then
      // says what is true — *as of the moment this run read the document*.
      observedAt: outputs[DOCUMENT_NODE].observedAt,
    }));
    const terminationType = taskFromFragment(
      terminationTypeNode,
      [document],
      ({ input, outputs }) => ({
      terminationType: outputs[DOCUMENT_NODE].separation.terminationType,
      // The complete option list this run ACTUALLY observed, so a republished
      // control refuses on the first run that sees it (§4a's accepted cost).
      observedOptions: outputs[DOCUMENT_NODE].options.terminationType,
      documentNumber: input.documentNumber,
      }),
    );
    const nameSearch = taskFromFragment(nameSearchNode, [plan], ({ outputs }) => ({
    // `keepNonHdh: true`, always, and UNCONDITIONALLY run — the fragment's own
    // doc says why; the composition feeds it the plan's employee name.
      kind: "by-name" as const,
      name: outputs[PLAN_NODE].employeeName,
      keepNonHdh: true,
    }));
    const subject = taskFromFragment(subjectNode, [document, plan, nameSearch], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[PLAN_NODE].employeeName,
      documentEid: outputs[DOCUMENT_NODE].employee.eid,
      nameSelection: outputs[NAME_SEARCH_NODE].selection,
    }));
    const jobSummary = taskFromFragment(jobSummaryNode, [subject], ({ outputs }) => ({
      emplId: outputs[SUBJECT_NODE].emplId,
    }));
    const employment = taskFromFragment(employmentNode, [document, jobSummary], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      jobSummary: outputs[JOB_SUMMARY_NODE],
    }));
    const departmentOption = taskFromFragment(
      departmentOptionNode,
      [document, employment],
      ({ input, outputs }) => ({
      deptId: outputs[EMPLOYMENT_NODE].deptId,
      department: outputs[EMPLOYMENT_NODE].department,
      // This document's OWN control, read this run — never a captured constant,
      // because a new campus department is a legitimate option nobody has to
      // teach this repository about before somebody can be separated.
      observedOptions: outputs[DOCUMENT_NODE].options.department,
      documentNumber: input.documentNumber,
      }),
    );
    const timecardSearch = taskFromFragment(timecardSearchNode, [subject], ({ input, outputs }) => ({
      emplId: outputs[SUBJECT_NODE].emplId,
      searchTimeoutMs: input.searchTimeoutMs,
    }));
    const timecard = taskFromFragment(timecardNode, [subject, plan, timecardSearch], ({ outputs }) => {
      // Reading the search's own match is what makes the dependency load-bearing
      // rather than decorative: Go To is disabled without the selection, and a
      // disabled Go To is a loud failure, never an empty card.
      requireFact(outputs[TIMECARD_SEARCH_NODE].matched, TIMECARD_SEARCH_NODE, "matched");
      return {
        emplId: outputs[SUBJECT_NODE].emplId,
        rangeStart: outputs[PLAN_NODE].timecardWindow.start,
        rangeEnd: outputs[PLAN_NODE].timecardWindow.end,
      };
    });
    const dates = taskFromFragment(datesNode, [plan, timecard], ({ input, outputs }) => ({
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
    }));
    const comparison = taskFromFragment(
      comparisonNode,
      [document, plan, subject, jobSummary, nameSearch, terminationType, departmentOption, employment, dates],
      ({ input, outputs }) => ({
    /**
     * Everything identity authority consumes depends INTO this node. That is
     * what makes `identity-gate-before-commit` pass on a graph with three
     * transaction nodes: no write can consume a value outside the packet that
     * machine verification or the operator decision was bound to.
     */
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
          source: outputs[DATES_NODE].source,
        },
      },
      }),
    );
    const identityGate = gateFromFragment(identityApprovalGate, [comparison]);
    const approval = taskFromFragment(approvalNode, [comparison, identityGate], ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }));
    const pendingSet = taskFromFragment(pendingSetNode, [approval], ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
    }));
    const clearPending = transactionFromFragment(clearPendingNode, [approval, pendingSet], {
    prepareBind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      observedSet: outputs[PENDING_SET_NODE],
    }),
    commitBind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      observedSet: outputs[PENDING_SET_NODE],
    }),
    });
    const fileTermination = transactionFromFragment(
      fileTerminationNode,
      [approval, terminationType, employment, dates, clearPending],
      {
    prepareBind: ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
      emplRecord: outputs[EMPLOYMENT_NODE].emplRecord,
      effectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
      template: outputs[TERMINATION_TYPE_NODE].template,
      reasonCode: outputs[TERMINATION_TYPE_NODE].reasonCode,
      lastDateWorked: outputs[DATES_NODE].lastDayWorked,
      initiatorComments: outputs[DATES_NODE].terminationComments,
    }),
    commitBind: ({ outputs }) => ({
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
    );
    const receipt = taskFromFragment(receiptNode, [approval, dates, fileTermination], ({ outputs }) => ({
      // A transaction node's scope value is the typed outcome envelope (D144);
      // `output` is the COMMIT contract's own bare output.
      proof: outputs[TERMINATION_NODE].output.receipt,
      disposition: outputs[TERMINATION_NODE].disposition,
      approvedEmplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
    }));
    const filingPresence = taskFromFragment(filingPresenceNode, [receipt], ({ outputs }) =>
      outputs[RECEIPT_NODE]);
    const finalizeKuali = transactionFromFragment(
      finalizeKualiNode,
      [approval, action, document, plan, employment, departmentOption, dates, receipt, filingPresence],
      {
    prepareBind: ({ input, outputs }) => ({
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
        transactionNumber: outputs[FILING_PRESENCE_NODE].transactionId,
        timekeeperComments: buildFinalizationComments({
          existingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
          dateChangeComments: outputs[DATES_NODE].dateChangeComments,
          documentNumber: input.documentNumber,
          transactionNumber: outputs[FILING_PRESENCE_NODE].transactionId,
          initials: separationInitials(input.timekeeperName),
          asOfDate: outputs[PLAN_NODE].asOfDate,
        }),
        observedExistingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
      },
    }),
    /**
     * The SAME target the prepare staged, bound from workflow input plus the
     * gate-approved identity and the folds — never from the prepare's own
     * output. That is what makes the permanent key stable before any page
     * mutation (ref workflow-model §3.1), and what the beat-⑥ read-back compares against.
     */
    commitBind: ({ input, outputs }) => ({
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
        transactionNumber: outputs[FILING_PRESENCE_NODE].transactionId,
        timekeeperComments: buildFinalizationComments({
          existingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
          dateChangeComments: outputs[DATES_NODE].dateChangeComments,
          documentNumber: input.documentNumber,
          transactionNumber: outputs[FILING_PRESENCE_NODE].transactionId,
          initials: separationInitials(input.timekeeperName),
          asOfDate: outputs[PLAN_NODE].asOfDate,
        }),
        observedExistingComments: existingComments(outputs[DOCUMENT_NODE].timekeeper.comments),
      },
    }),
      },
    );

    return {
      steps: [
        [KUALI_EXTRACTION_STEP, [action, document, plan, terminationType]],
        [IDENTITY_CHECK_STEP, [nameSearch, subject, comparison, identityGate, approval]],
        [JOB_SUMMARY_STEP, [jobSummary, employment, departmentOption]],
        [group(KRONOS_TIMECARD_STEP, { omission: KRONOS_TIMECARD_OMISSION }), [timecardSearch, timecard, dates]],
        [group(UCPATH_TRANSACTION_STEP, { omission: UCPATH_TRANSACTION_OMISSION }), [pendingSet, clearPending, fileTermination, receipt]],
        [group(KUALI_FINALIZATION_STEP, { omission: KUALI_FINALIZATION_OMISSION }), [filingPresence, finalizeKuali]],
      ],
      result: result(
        SeparationsResultSchema,
        [approval, employment, departmentOption, dates, receipt, clearPending, fileTermination, finalizeKuali],
        ({ outputs }) => ({
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
      // D307 — an omitted write step's node is absent from the scope (the
      // factory admits it as `step-omitted`); the result names the step.
      pendingSweep: omittedOr(outputs[SWEEP_NODE], UCPATH_TRANSACTION_STEP.key, (sweep) => ({
        disposition: sweep.disposition,
        proof: sweep.output.cleared,
      })),
      termination: outputs[RECEIPT_NODE],
      finalization: omittedOr(outputs[FINALIZE_NODE], KUALI_FINALIZATION_STEP.key, (finalize) => ({
        disposition: finalize.disposition,
        proof: finalize.output.savedState,
      })),
        }),
      ),
    };
  },
);

export const separationsDescriptor = compileWorkflowRecipe(separationsRecipe, {
  id: "separations",
  version: 1,
  contractFingerprint: resolveWorkflowFingerprint(
    BUILD_MANIFEST,
    WorkflowIdSchema.parse("separations"),
  ),
  code: "sp",
  label: "Separations",
  summary:
    "The composition: ONE Kuali RRSS separation document becomes ONE terminated employee across three "
    + "systems. It reads Kuali, UCPath and Kronos, reconciles the dates against what the timecard "
    + "actually shows, establishes identity from supplied-EID read-back or the name-only gate, then clears any pending termination, "
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
      purpose: "Builds the identity evidence packet — DISCONFIRMING evidence first — and the digest that "
        + "machine verification or an operator decision binds to. Pure: it reaches no browser.",
    },
    {
      nodeId: "identity-approval",
      purpose: "Requires the typed operator resolve-gate command when the packet's EID came from a name search; "
        + "a supplied-EID packet makes this declared condition false and records no human decision.",
    },
    {
      nodeId: "approval",
      purpose: "Re-derives the evidence and produces explicit machine-verification or operator-approval "
        + "authority. It re-runs on every attempt, so moved evidence or identity origin cannot reuse an old answer.",
    },
    {
      nodeId: "pending-set",
      purpose: "Reads and freezes the exact stable-ID set of eligible pending terminations plus every protected "
        + "transaction before the sweep. The run admission authorizes this machine observation; it is not another gate.",
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
    {
      nodeId: "filing-presence",
      purpose: "Freshly re-reads the exact UCPath transaction named by the durable receipt and requires its "
        + "subject, effective date, termination action, and acceptable status to survive before Kuali can prepare.",
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
});
