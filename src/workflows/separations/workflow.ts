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
import { OmittedStepResultArmSchema } from "../../models/workflow/step-omission.js";
import { defineWorkflow, defineStepEntries } from "../../workflow-kit/workflow-definition.js";
import { requireFact, defineWorkflowStep } from "../../workflow-kit/workflow.js";
import {
  ResolvedIdentitySubjectSchema,
  IdentityApprovalResultSchema,
} from "../../rules/separations/identity-approval.js";
import {
  buildFinalizationComments,
  separationInitials,
  assertSeparationDates,
} from "../../rules/separations/separation-dates.js";
import {
  TerminationReceiptSchema,
  TERMINATION_RECEIPT_ACCEPTED_STATUSES,
  assertTerminationReceipt,
} from "../../rules/separations/termination-receipt.js";
import {
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "../../models/ui/kuali-document-identity.js";
import { KualiSavedFinalizationProofSchema } from "../../models/ui/kuali-separation-finalization.js";
import {
  UcpathPendingSweepHistoricalOrCurrentProofSchema,
} from "../../models/ui/ucpath-smart-hr-termination.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { KualiReadSeparationDocument } from "../../models/systems/kuali/read-separation-document.js";
import { KualiSearchSeparationAction } from "../../models/systems/kuali/search-separation-action.js";
import {
  SeparationsMatchTerminationType,
} from "../../models/workflows/separations/match-termination-type.js";
import {
  SeparationsReadSeparationPlan,
  ReadSeparationPlanOutputSchema,
} from "../../models/workflows/separations/read-separation-plan.js";
import { SeparationsMatchIdentity } from "../../models/workflows/separations/match-identity.js";
import {
  SeparationsMatchSeparationSubject,
} from "../../models/workflows/separations/match-separation-subject.js";
import {
  SeparationsVerifyIdentityApproval,
  VerifyIdentityApprovalOutputSchema,
} from "../../models/workflows/separations/verify-identity-approval.js";
import { SearchPersonOrg } from "../../models/systems/ucpath/search-person-org.js";
import {
  SeparationsMatchActiveEmployment,
} from "../../models/workflows/separations/match-active-employment.js";
import {
  SeparationsMatchDepartmentOption,
} from "../../models/workflows/separations/match-department-option.js";
import { UcpathReadJobSummary } from "../../models/systems/ucpath/read-job-summary.js";
import {
  NewKronosReadSeparationTimecard,
} from "../../models/systems/new-kronos/read-separation-timecard.js";
import { NewKronosSearchEmployee } from "../../models/systems/new-kronos/search-employee.js";
import {
  SeparationsReadSeparationDates,
  ReadSeparationDatesOutputSchema,
} from "../../models/workflows/separations/read-separation-dates.js";
import type { JsonObject, JsonValue } from "../../rules/validation/canonical-json.js";
import type { StepOmissionDeclaration } from "../../models/workflow/step-omission.js";
import {
  SeparationsVerifyTerminationReceipt,
} from "../../models/workflows/separations/verify-termination-receipt.js";
import { UcpathCreateTermination } from "../../models/systems/ucpath/create-termination.js";
import {
  UcpathDeletePendingTerminations,
} from "../../models/systems/ucpath/delete-pending-terminations.js";
import {
  UcpathStagePendingTerminationSweep,
} from "../../models/systems/ucpath/stage-pending-termination-sweep.js";
import { UcpathStageTermination } from "../../models/systems/ucpath/stage-termination.js";
import {
  UcpathReadPendingTerminationSet,
} from "../../models/systems/ucpath/read-pending-termination-set.js";
import {
  KualiSaveSeparationFinalization,
} from "../../models/systems/kuali/save-separation-finalization.js";
import {
  KualiStageSeparationFinalization,
} from "../../models/systems/kuali/stage-separation-finalization.js";
import {
  UcpathVerifyTerminationFilingPresent,
} from "../../models/systems/ucpath/verify-termination-filing-present.js";

/* ── The timeline's step identities ─────────────────────────────────────────
 *
 * D312/D315 — this one file authors the composition's whole timeline — each
 * step's group, node ids, entry identities and (where the step is omittable) its
 * D307 omission, in timeline order — then the `defineWorkflow` call that wires them.
 * The chunk harnesses under `./<step>/workflow.ts` IMPORT the identities of the
 * step they prove from here (D265 §1.2.2 rule 3) and wire them from their own
 * ingress; nothing under a step folder authors an identity of its own.
 * ────────────────────────────────────────────────────────────────────────── */

/* ── step `kuali-extraction` — group, node ids, entry identities ── */

export const KUALI_EXTRACTION_STEP = defineWorkflowStep({
  key: "kuali-extraction",
  label: "Kuali extraction",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them (D307). */
export const ACTION_NODE = "resolve-action";
export const DOCUMENT_NODE = "document";
export const PLAN_NODE = "plan";
export const TERMINATION_TYPE_NODE = "termination-type";

/**
 * D265 §1.2.2 rule 2 — the *Kuali extraction* step's entry identities: what the
 * composition (this file) and the step's harness (`./<step>/workflow.ts`) each apply to
 * their own graph, wired from their own upstreams.
 *
 * An entry identity owns a node's IDENTITY — id, contract, label, replay — and
 * takes its WIRING (references + bind) from the workflow definition that uses
 * it (`defineStepEntries`, D315). The rationale for each node's replay
 * policy lives here, beside the policy; the rationale for what feeds a node
 * lives beside the bind that feeds it.
 */
const kualiExtractionEntries = defineStepEntries(KUALI_EXTRACTION_STEP);

/**
 * D261's head node. It turns the one number a human knows into the address
 * Kuali actually answers to, by filtering the Action List's own search box
 * and reading the matched row's `href` — no click into a document, nothing
 * staged, nothing written.
 *
 * `replay: "checkpoint"` for `document`'s reason, one node later: the node's
 * product is a VALUE, so restoring it into a fresh browser leaves nothing
 * broken, and the gate releases every session on the way in. The value CAN go
 * stale between the checkpoint and a post-gate finalization — an action id
 * names a workflow step — and that is exactly the case `openDocument` refuses
 * loudly on, by proving the document number off the page's own heading. A
 * freshness bound here would replace a precise refusal with a timer, and §5A
 * already ruled that out for this graph.
 */
export const actionNode = kualiExtractionEntries.task(ACTION_NODE, KualiSearchSeparationAction, {
  label: "Kuali Action",
  replay: "checkpoint",
});

/**
 * Chunk 2's argument verbatim: this node's product is its VALUE, not browser
 * state, so restoring the checkpoint into a fresh browser leaves nothing
 * broken. Nothing downstream stands on the page it opened — the consumers are
 * pure folds — and in the composition every read upstream of the gate is
 * replayed into a browser that has never seen these pages, because the gate
 * parks and the executor releases every session on the way in. Chunk 1's rule
 * ("a node whose real product is BROWSER state may not be `replay:
 * "checkpoint"`") is the same rule read the other way.
 */
export const documentNode = kualiExtractionEntries.task(DOCUMENT_NODE, KualiReadSeparationDocument, {
  label: "Separation Document",
  replay: "checkpoint",
});

export const planNode = kualiExtractionEntries.task(PLAN_NODE, SeparationsReadSeparationPlan, {
  label: "Separation Plan",
  replay: "checkpoint",
});

export const terminationTypeNode = kualiExtractionEntries.task(TERMINATION_TYPE_NODE, SeparationsMatchTerminationType, {
  label: "Termination Type",
  replay: "checkpoint",
});

/* ── step `identity-check` — group, node ids, entry identities ── */

export const IDENTITY_CHECK_STEP = defineWorkflowStep({
  key: "identity-check",
  label: "Identity check",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them (D307). */
export const NAME_SEARCH_NODE = "name-search";
export const SUBJECT_NODE = "subject";
export const COMPARISON_NODE = "comparison";
export const GATE_NODE = "identity-approval";
export const APPROVAL_NODE = "approval";

/**
 * D265 §1.2.2 rule 2 — the *Identity check* step's entry identities: UCPath's
 * own search for the name the Kuali form claims, the reduction to ONE subject,
 * the evidence packet, the conditional name-only gate and the shared identity
 * authority check.
 *
 * An entry identity owns a node's IDENTITY — id, contract, label, replay, or
 * the gate's status key and result schema — and takes its WIRING (references
 * + bind) from the workflow definition that uses it (`defineStepEntries`,
 * D315). The composition wires these from the Kuali reads upstream; the
 * identity-check harness (`./identity-check/workflow.ts`) wires them from its
 * own ingress and binds the comparison to `noSeparationWritePlan` because it
 * files nothing and has no whole plan to show (rule 3: a harness IMPORTS these
 * identities rather than restating them).
 */
const identityCheckEntries = defineStepEntries(IDENTITY_CHECK_STEP);

/**
 * Every graph that applies this node binds `keepNonHdh: true` and runs it
 * UNCONDITIONALLY — chunk 3's two sharpest choices. Legacy searches only when
 * its name tier came back `different`, so the alternative candidate
 * `T002173685` turned on exists only on the runs a Levenshtein threshold
 * happened to select; and an HDH filter would hide exactly the career
 * employee a common name matched. The HDH filter exists so person-lookup can
 * pick a preferred candidate; here the point is to SHOW the operator every
 * person this name resolves to.
 */
export const nameSearchNode = identityCheckEntries.task(NAME_SEARCH_NODE, SearchPersonOrg, {
  label: "Name Search",
  replay: "checkpoint",
});

export const subjectNode = identityCheckEntries.task(SUBJECT_NODE, SeparationsMatchSeparationSubject, {
  label: "Separation Subject",
  replay: "checkpoint",
});

export const comparisonNode = identityCheckEntries.task(COMPARISON_NODE, SeparationsMatchIdentity, {
  label: "Identity Comparison",
  replay: "checkpoint",
});

/**
 * When the declared source is `name-resolved`, `resolvedBy: "operator"` and
 * nothing else can resolve it (ref write-safety §14.4). Not a retry, not a bump,
 * not a cascade from a parent, not AI (charter
 * §23 / D60), and not a generic "Done" — the kernel's ONLY path into
 * `gate_results` is the typed `resolve-gate` command, which parses this exact
 * schema and CASes the run version. A supplied-EID packet makes the condition
 * false; the executor records no gate result or operator decision.
 */
export const identityApprovalGate = identityCheckEntries.operatorGate(GATE_NODE, {
  label: "Identity Approval",
  statusKey: "awaitingIdentityApproval",
  result: IdentityApprovalResultSchema,
  when: { kind: "equals", of: { from: "node", nodeId: COMPARISON_NODE, path: "packet.emplIdSource" }, value: "name-resolved" },
});

/**
 * `always-rerun`, deliberately: this node's whole job is to compare a stored
 * gate result against re-derived evidence, and a replayed checkpoint would be
 * the previous comparison's ANSWER standing in for the comparison.
 */
export const approvalNode = identityCheckEntries.task(APPROVAL_NODE, SeparationsVerifyIdentityApproval, {
  label: "Approval Check",
  replay: "always-rerun",
});

/* ── step `job-summary` — group, node ids, entry identities ── */

export const JOB_SUMMARY_STEP = defineWorkflowStep({
  key: "job-summary",
  label: "Job summary",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them (D307). */
export const JOB_SUMMARY_NODE = "job-summary";
export const EMPLOYMENT_NODE = "employment";
export const DEPARTMENT_NODE = "department-option";

/**
 * D265 §1.2.2 rule 2 — the *Job summary* step's entry identities: UCPath's Job
 * Summary grid read verbatim, and the two pure folds over it — the one active
 * employment the filing is against and the Kuali department option it maps to.
 *
 * An entry identity owns a node's IDENTITY — id, contract, label, replay — and
 * takes its WIRING (references + bind) from the workflow definition that uses
 * it (`defineStepEntries`, D315). This step has no harness of its own: the
 * composition wires `job-summary` from the resolved subject, and the
 * identity-check harness wires it straight from its ingress EID (rule 3 — it
 * IMPORTS the identity rather than restating it).
 */
const jobSummaryEntries = defineStepEntries(JOB_SUMMARY_STEP);

/**
 * `replay: "checkpoint"` is safe here for chunk 2's reason read the same way:
 * this node's product is its VALUE, not browser state. Nothing downstream
 * stands on the page it opened — the consumers are pure folds and one operator
 * gate — and a gate resume ALWAYS lands in a fresh browser, because the
 * executor releases every session on the way into a park. A node whose
 * product were browser state could not be replayed across a park at all.
 */
export const jobSummaryNode = jobSummaryEntries.task(JOB_SUMMARY_NODE, UcpathReadJobSummary, {
  label: "Job Summary",
  replay: "checkpoint",
});

export const employmentNode = jobSummaryEntries.task(EMPLOYMENT_NODE, SeparationsMatchActiveEmployment, {
  label: "Employment",
  replay: "checkpoint",
});

export const departmentOptionNode = jobSummaryEntries.task(DEPARTMENT_NODE, SeparationsMatchDepartmentOption, {
  label: "Department Option",
  replay: "checkpoint",
});

/* ── step `kronos-timecard` — group, node ids, entry identities, omission ── */

export const KRONOS_TIMECARD_STEP = defineWorkflowStep({
  key: "kronos-timecard",
  label: "Kronos timecard",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them (D307). */
export const TIMECARD_SEARCH_NODE = "timecard-search";
export const TIMECARD_NODE = "timecard";
export const DATES_NODE = "dates";

/**
 * D265 §1.2.2 rule 2 — the *Kronos timecard* step's entry identities: the New
 * Kronos employee search that leaves the subject SELECTED, the timecard read
 * over the separation window, and the pure date reconciliation over it.
 *
 * An entry identity owns a node's IDENTITY — id, contract, label, replay —
 * and takes its WIRING (references + bind) from the workflow definition that
 * uses it (`defineStepEntries`, D315). The harness in this folder uses
 * `timecard` from its own ingress; its search node is `search` / "Employee
 * Search" — a different id and label, so a different node identity — and stays
 * authored there rather than being passed off as this step's `timecard-search`.
 */
const kronosTimecardEntries = defineStepEntries(KRONOS_TIMECARD_STEP);

/**
 * `always-rerun`, and chunk 1 paid for the rule live (`sk-124132-9beb`): the
 * search's OUTPUT is durable but its POINT is a side effect that is not — it
 * leaves the employee selected in the WFD panel, which is the only thing that
 * enables Go To. **A node whose real product is BROWSER state may not be
 * `replay: "checkpoint"`.**
 *
 * The composition pays a real cost for that: a gate resume re-runs this node
 * (the timecard replays from its checkpoint, so nothing consumes the panel),
 * which is one New Kronos session per gated run. The alternative is a
 * checkpoint that restores a selection into a browser that never made one, and
 * that is the failure chunk 1 already recorded.
 */
export const timecardSearchNode = kronosTimecardEntries.task(TIMECARD_SEARCH_NODE, NewKronosSearchEmployee, {
  label: "Timecard Search",
  replay: "always-rerun",
});

/**
 * The timecard visit begins from the selection the search node left in the
 * panel, so every graph that applies it depends on that search structurally as
 * well as semantically, and its bind reads the search's own `matched` fact
 * through `requireFact` — Go To is disabled without the selection, and a
 * disabled Go To is a loud failure, never an empty card.
 */
export const timecardNode = kronosTimecardEntries.task(TIMECARD_NODE, NewKronosReadSeparationTimecard, {
  label: "Timecard",
  replay: "checkpoint",
});

export const datesNode = kronosTimecardEntries.task(DATES_NODE, SeparationsReadSeparationDates, {
  label: "Reconciled Dates",
  replay: "checkpoint",
});

/**
 * D307 — omitting the Kronos timecard step.
 *
 * The operator types the last day worked and the separation date; the step's
 * one pure fold (`dates`) is rebuilt from them over the plan the Kuali read
 * produced. The two browser reads (`timecard-search`, `timecard`) are simply
 * not run — nothing downstream reads them except this fold — and the
 * rebuilt dates say so in their own leaves (no leave, no pay codes, a comment
 * that cites operator entry, never a timesheet).
 */
function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KronosTimecardFactsSchema = z.strictObject({
  lastDayWorked: z.string().min(1),
  separationDate: z.string().min(1),
});

export const KRONOS_TIMECARD_OMISSION: StepOmissionDeclaration = {
  form: {
    fields: [
      {
        key: "lastDayWorked", label: "Last day worked", kind: "us-date",
        help: "The employee's last physical day of work, MM/DD/YYYY. Kronos is not read; this stands in for the card's last punch.",
      },
      {
        key: "separationDate", label: "Separation date", kind: "us-date",
        help: "The last day on pay status, MM/DD/YYYY — the same day as the last day worked unless paid leave follows it. The termination is effective the next day.",
      },
    ],
  },
  produces: {
    [DATES_NODE]: ({ facts, scope }) => {
      const typed = KronosTimecardFactsSchema.parse(facts);
      const plan = ReadSeparationPlanOutputSchema.parse(scope.outputs[PLAN_NODE]);
      if (!isJsonObject(scope.input)) {
        throw new Error("kronos-timecard omission requires the run's canonical input object to read the timekeeper name");
      }
      const timekeeperName = scope.input.timekeeperName;
      if (typeof timekeeperName !== "string" || timekeeperName.length === 0) {
        throw new Error("kronos-timecard omission requires input.timekeeperName to be a non-empty string");
      }
      return assertSeparationDates({
        plan,
        timekeeperName,
        lastDayWorked: typed.lastDayWorked,
        separationDate: typed.separationDate,
      });
    },
  },
};

/* ── step `ucpath-transaction` — group, node ids, entry identities, omission ── */

export const UCPATH_TRANSACTION_STEP = defineWorkflowStep({
  key: "ucpath-transaction",
  label: "UCPath transaction",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them (D307). */
export const PENDING_SET_NODE = "pending-set";
export const SWEEP_NODE = "clear-pending";
export const TERMINATION_NODE = "file-termination";
export const RECEIPT_NODE = "receipt";

/**
 * D265 §1.2.2 rule 2 — the *UCPath transaction* step's entry identities, in ref
 * write-safety's order: the pending-termination sweep (S30/S31 — legacy's first
 * mutation, unfenced and unverified), the termination filing itself, and the
 * receipt check that binds `(transactionNumber, approvalStatus)` as a PAIR
 * (D130 proved a **Denied** transaction carries a well-formed `T…`).
 *
 * An entry identity owns a node's IDENTITY — id, contracts, label and, for a
 * transaction, its whole write policy (dry-run shape, probe policy, the
 * probe-to-fence budget) — and takes its WIRING (references + binds) from the
 * workflow definition that uses it (`defineStepEntries`, D315). The
 * composition binds the filing from the reconciled folds; the harness in this
 * folder binds it from its own ingress (rule 3).
 */
const ucpathTransactionEntries = defineStepEntries(UCPATH_TRANSACTION_STEP);

export const pendingSetNode = ucpathTransactionEntries.task(PENDING_SET_NODE, UcpathReadPendingTerminationSet, {
  label: "Read Exact Pending Set",
  replay: "checkpoint",
});

/**
 * `probePolicy: "always"`: the sweep's probe is one page read that the
 * termination's probe needs anyway, and paying it on the first attempt too is
 * what closes the crash window before the first fence.
 *
 * Budget measured live 2026-08-13 (§9.7): probe search open 4.6 s + search run
 * 7.4 s + detail 4.9 s ≈ 17 s to read the grid, then the selection itself is
 * checkbox clicks. 90 s is ~5x that, and short enough that a stalled page
 * loses its selection rather than deleting on a stale probe.
 */
export const clearPendingNode = ucpathTransactionEntries.transaction(SWEEP_NODE, {
  label: "Clear Pending Terminations",
  prepare: UcpathStagePendingTerminationSweep,
  commit: UcpathDeletePendingTerminations,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 90_000,
});

/**
 * The real HR write. Budget measured live 2026-08-13 (§9.7): ≈32.4 s of live
 * wizard staging on top of ≈17 s of probe, and 120 s is ~3.7x that.
 */
export const fileTerminationNode = ucpathTransactionEntries.transaction(TERMINATION_NODE, {
  label: "File Termination",
  prepare: UcpathStageTermination,
  commit: UcpathCreateTermination,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 120_000,
});

/**
 * `always-rerun`, for `approval`'s reason: this node's job is to CHECK a proof,
 * and a replayed checkpoint would be the previous check's answer standing in
 * for the check. It is a pure fold over a durable proof, so re-running it costs
 * nothing and reaches no browser.
 */
export const receiptNode = ucpathTransactionEntries.task(RECEIPT_NODE, SeparationsVerifyTerminationReceipt, {
  label: "Termination Receipt",
  replay: "always-rerun",
});

/**
 * D307 — omitting the UCPath transaction step.
 *
 * Neither transaction runs and neither mints an outcome (D144: only the write
 * sequencer's row may say a write happened). The operator types the
 * transaction number and its approval status, and the step's pure receipt
 * fold is rebuilt from them over the identity approval and the reconciled
 * dates this run still holds — the same two facts a live receipt is checked
 * against. The receipt's `disposition` names the assertion.
 */
const UcpathTransactionFactsSchema = z.strictObject({
  transactionNumber: z.string().min(1),
  approvalStatus: z.string().min(1),
});

export const UCPATH_TRANSACTION_OMISSION: StepOmissionDeclaration = {
  form: {
    fields: [
      {
        key: "transactionNumber", label: "UCPath transaction number", kind: "text",
        help: "The T-number of the termination already filed in UCPath (T followed by 6–12 digits). This run files nothing in UCPath.",
      },
      {
        key: "approvalStatus", label: "Approval status", kind: "enum",
        values: [...TERMINATION_RECEIPT_ACCEPTED_STATUSES],
        help: "The transaction's approval status as UCPath shows it now. Only a status that means the termination took effect can be asserted.",
      },
    ],
  },
  produces: {
    [RECEIPT_NODE]: ({ facts, scope }) => {
      const typed = UcpathTransactionFactsSchema.parse(facts);
      const approval = VerifyIdentityApprovalOutputSchema.parse(scope.outputs[APPROVAL_NODE]);
      const dates = ReadSeparationDatesOutputSchema.parse(scope.outputs[DATES_NODE]);
      return assertTerminationReceipt({
        transactionNumber: typed.transactionNumber,
        approvalStatus: typed.approvalStatus,
        approvedEmplId: approval.approved.emplId,
        approvedName: approval.approved.ucpathName,
        expectedEffectiveDate: dates.terminationEffectiveDate,
      });
    },
  },
};

/* ── step `kuali-finalization` — group, node ids, entry identities, omission ── */

export const KUALI_FINALIZATION_STEP = defineWorkflowStep({
  key: "kuali-finalization",
  label: "Kuali finalization",
});

/** The step's node ids, declared apart from the entries so an omission declaration and every bind can name them (D307). */
export const FILING_PRESENCE_NODE = "filing-presence";
export const FINALIZE_NODE = "finalize-kuali";

/**
 * D265 §1.2.2 rule 2 — the *Kuali finalization* step's one entry identity: §4e's
 * one save over twelve staged fields, proved by a reload read-back (D128/S59).
 *
 * An entry identity owns a node's IDENTITY — id, contracts, label and the whole
 * write policy — and takes its WIRING (references + binds) from the workflow
 * definition that uses it (`defineStepEntries`, D315). The composition binds
 * the variables from the reconciled folds and the receipt; the harness in this
 * folder binds them from its own ingress (rule 3). `existingComments` is the
 * one pure fold only this step's binds consume, so it lives here.
 */
const kualiFinalizationEntries = defineStepEntries(KUALI_FINALIZATION_STEP);

/**
 * Always re-read the durable UCPath filing immediately before finalization.
 * Replaying a checkpoint would make an old observation authorize a new Kuali
 * write after the filing had moved, disappeared, or become denied.
 */
export const filingPresenceNode = kualiFinalizationEntries.task(
  FILING_PRESENCE_NODE,
  UcpathVerifyTerminationFilingPresent,
  { label: "Verify Current UCPath Filing", replay: "always-rerun" },
);

/** `""` when the control was empty — S56's baseline, which is a real value. */
export function existingComments(comments: { state: "present"; value: string } | { state: "absent" }): string {
  return comments.state === "present" ? comments.value : "";
}

/**
 * `probePolicy: "always"` (§5 item 3's recorded answer): separations files a
 * real, hard-to-reverse termination and this write is what records its
 * transaction number on the source document; a probe is one document read
 * against a page the run is already on.
 *
 * Budget CONFIRMED live 2026-08-14 (§9.12 item 6): probe 3.30 s + prepare
 * 8.06 s = 11.4 s worst legs against 45 000 ms, ~4x headroom.
 */
export const finalizeKualiNode = kualiFinalizationEntries.transaction(FINALIZE_NODE, {
  label: "Finalize Kuali Document",
  prepare: KualiStageSeparationFinalization,
  commit: KualiSaveSeparationFinalization,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 45_000,
});

/**
 * D307 — omitting the Kuali finalization step.
 *
 * Nothing downstream reads the finalization but the terminal result, so the
 * step needs no typed fact: the transaction is simply not run, and the result
 * carries an `omitted` arm where the saved-state proof would be. The operator
 * finalizes the document by hand.
 */
export const KUALI_FINALIZATION_OMISSION: StepOmissionDeclaration = {
  form: { fields: [] },
  produces: {},
};

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
      timekeeperName: "Synthetic Timekeeper",
    },
    {
      documentNumber: "4524",
      timekeeperName: "Synthetic Timekeeper",
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

export const separationsWorkflow = defineWorkflow({
  id: "separations",
  version: 1,
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
  rerunValues: [
    { nodeId: DATES_NODE, fieldPath: "lastDayWorked", label: "Last day worked", targetStepKey: "kronos-timecard", targetFieldPath: "lastDayWorked" },
    { nodeId: DATES_NODE, fieldPath: "separationDate", label: "Separation date", targetStepKey: "kronos-timecard", targetFieldPath: "separationDate" },
    { nodeId: RECEIPT_NODE, fieldPath: "transactionNumber", label: "UCPath transaction number", targetStepKey: "ucpath-transaction", targetFieldPath: "transactionNumber" },
    { nodeId: RECEIPT_NODE, fieldPath: "approvalStatus", label: "Approval status", targetStepKey: "ucpath-transaction", targetFieldPath: "approvalStatus" },
  ],
  protectedInputs: [{ inputPath: "timekeeperName", name: "timekeeperName" }],
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
   * D331: the server binds `timekeeperName` from protected settings at admission.
   * This browser-safe descriptor carries only the setting name and input path.
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
    subtitle: (input) => (input.reRead === undefined
      ? undefined
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
  input: SeparationsInput,
  // The composed graph the five separations chunk harnesses each prove a step
  // of — the `of` target every one of them names (D219).
  role: defineWorkflowRole({ kind: "composition" }),
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
  steps: ({ group, task, transaction, gate, result }) => {
    const action = task(actionNode, [], ({ input }) => ({
      documentNumber: input.documentNumber,
    }));
    const document = task(documentNode, [action], ({ input, outputs }) => ({
      actionId: outputs[ACTION_NODE].actionId,
      documentNumber: input.documentNumber,
    }));
    const plan = task(planNode, [document], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[DOCUMENT_NODE].employee.name,
      lastDayWorked: outputs[DOCUMENT_NODE].separation.lastDayWorked,
      separationDate: outputs[DOCUMENT_NODE].separation.separationDate,
      // S7's reference is the READ's own instant, not a clock: the refusal then
      // says what is true — *as of the moment this run read the document*.
      observedAt: outputs[DOCUMENT_NODE].observedAt,
    }));
    const terminationType = task(
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
    const nameSearch = task(nameSearchNode, [plan], ({ outputs }) => ({
    // `keepNonHdh: true`, always, and UNCONDITIONALLY run — the identity's own
    // doc says why; the composition feeds it the plan's employee name.
      kind: "by-name" as const,
      name: outputs[PLAN_NODE].employeeName,
      keepNonHdh: true,
    }));
    const subject = task(subjectNode, [document, plan, nameSearch], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      employeeName: outputs[PLAN_NODE].employeeName,
      documentEid: outputs[DOCUMENT_NODE].employee.eid,
      nameSelection: outputs[NAME_SEARCH_NODE].selection,
    }));
    const jobSummary = task(jobSummaryNode, [subject], ({ outputs }) => ({
      emplId: outputs[SUBJECT_NODE].emplId,
    }));
    const employment = task(employmentNode, [document, jobSummary], ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
      jobSummary: outputs[JOB_SUMMARY_NODE],
    }));
    const departmentOption = task(
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
    const timecardSearch = task(timecardSearchNode, [subject], ({ input, outputs }) => ({
      emplId: outputs[SUBJECT_NODE].emplId,
      searchTimeoutMs: input.searchTimeoutMs,
    }));
    const timecard = task(timecardNode, [subject, plan, timecardSearch], ({ outputs }) => {
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
    const dates = task(datesNode, [plan, timecard], ({ input, outputs }) => ({
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
    const comparison = task(
      comparisonNode,
      [document, plan, subject, jobSummary, nameSearch, terminationType, departmentOption, employment, dates],
      ({ input, outputs, protectedInputBindings }) => ({
      ...(protectedInputBindings === undefined ? {} : { protectedBindings: [...protectedInputBindings] }),
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
          timekeeperName: protectedInputBindings?.find(({ name }) => name === "timekeeperName")
            ?? { kind: "legacy-protected-input" as const, name: "timekeeperName" as const, inputPath: "timekeeperName" as const },
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
    const identityGate = gate(identityApprovalGate, [comparison]);
    const approval = task(approvalNode, [comparison, identityGate], ({ outputs }) => ({
      packet: outputs[COMPARISON_NODE].packet,
      evidenceDigest: outputs[COMPARISON_NODE].evidenceDigest,
      approval: outputs[GATE_NODE],
    }));
    const pendingSet = task(pendingSetNode, [approval], ({ outputs }) => ({
      emplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedName: outputs[APPROVAL_NODE].approved.ucpathName,
    }));
    const clearPending = transaction(clearPendingNode, [approval, pendingSet], {
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
    const fileTermination = transaction(
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
    const receipt = task(receiptNode, [approval, dates, fileTermination], ({ outputs }) => ({
      // A transaction node's scope value is the typed outcome envelope (D144);
      // `output` is the COMMIT contract's own bare output.
      proof: outputs[TERMINATION_NODE].output.receipt,
      disposition: outputs[TERMINATION_NODE].disposition,
      approvedEmplId: outputs[APPROVAL_NODE].approved.emplId,
      expectedEffectiveDate: outputs[DATES_NODE].terminationEffectiveDate,
    }));
    const filingPresence = task(filingPresenceNode, [receipt], ({ outputs }) =>
      outputs[RECEIPT_NODE]);
    const finalizeKuali = transaction(
      finalizeKualiNode,
      [approval, action, document, plan, employment, departmentOption, dates, receipt, filingPresence],
      {
    prepareBind: ({ input, outputs, protectedInputBindings }) => ({
      ...(protectedInputBindings === undefined ? {} : { protectedBindings: [...protectedInputBindings] }),
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
    commitBind: ({ input, outputs, protectedInputBindings }) => ({
      ...(protectedInputBindings === undefined ? {} : { protectedBindings: [...protectedInputBindings] }),
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
        ({ input, outputs }) => ({
      documentNumber: input.documentNumber,
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
});
