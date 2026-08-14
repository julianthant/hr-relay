/**
 * `kuali/stage-separation-finalization` — the PREPARE arm of chunk 5's Kuali
 * finalization transaction (doc 09 §3 beat ②).
 *
 * ## It stages EVERY field in one pass, and that is §4e's answer, not a shortcut
 *
 * The staged-variables model is normative: all reads land first as typed
 * checkpoints, this task stages every Kuali field from those variables in ONE
 * pass, there is ONE save, and ONE reload read-back verifies every written
 * field against the exact staged variables. Nothing here re-reads a value to
 * COMPUTE with it and nothing recomputes at fill time — the two page reads it
 * does perform (the department option list, the existing comments) each decide
 * a REFUSAL and never a value.
 *
 * It saves nothing. A Kuali Build document holds staged edits in its own
 * in-page form model until an explicit `Save`, so closing the page here leaves
 * the document as it was — which is what makes `dryRun:"stop-after-prepare"` a
 * genuine no-effect preview. (Legacy makes the same claim about its drafts and
 * S61 records that the claim is *stated, never verified*; chunk 5c's dry-run
 * re-opens the document afterwards and checks, which is the verification legacy
 * never did.)
 *
 * ## What it proves before it returns
 *
 *  - **The document and the subject.** The deep link is opened and the level-1
 *    heading must be the expected document number — an `actionId` names a
 *    workflow STEP, not a document (D129) — and the displayed EID must be the
 *    person the run named.
 *  - **S55, the department option.** The control's COMPLETE option list is
 *    returned (§3.2 MAP EVERYTHING) and an option the live control does not
 *    offer refuses BY NAME. Legacy throws here too and that refusal is sound;
 *    what is new is that the run records what the control actually offered.
 *  - **S56, the comments.** The staged comments text was composed upstream from
 *    chunk 2's read of this control. If the control has moved since, the staged
 *    text would blank somebody's edit, so this refuses. Legacy only refuses
 *    when the READ throws.
 *  - **Every field read back.** Kuali controls silently drop a `fill()` (legacy
 *    `fillWithVerify`, `navigate.ts:16-39`), so each staged value is read back
 *    out of the live control and a disagreement refuses, naming the field.
 *
 * ## What it deliberately does NOT do
 *
 * **S57 does not port.** Legacy, finding the transaction number empty at
 * finalization, fills everything EXCEPT the number and saves the document
 * "blank for manual entry", and only then fails the run — a half-finished
 * document written on the way to an error. Here the transaction number is a
 * required staged variable of schema `T` + 6-12 digits, so an empty one cannot
 * reach this task at all: the run refuses before any control is touched. That
 * is legacy's own `verifyTxnNumberFilled` intent (`navigate.ts:602-624`) moved
 * from a pre-save re-read to the type system.
 */
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import { KUALI_RRSS_DISPLAYED_EID } from "../../ui/kuali-rrss-document.js";
import {
  KUALI_RRSS_FINALIZATION_STAGED,
  KualiFinalizationStagingSchema,
  KualiFinalizationTargetSchema,
} from "../../ui/kuali-separation-finalization.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";
import { EXAMPLE_KUALI_FINALIZATION_FIELDS } from "./match-separation-finalization.js";

export const KualiStageSeparationFinalization = defineTaskContract({
  id: taskId("kuali/stage-separation-finalization"),
  title: "Stage Kuali Separation Finalization",
  effect: "prepare",
  input: KualiFinalizationTargetSchema,
  output: KualiFinalizationStagingSchema,
  // Every code below has exactly one producer in
  // `src/stores/kuali/tasks/stage-separation-finalization.ts`; a declared code
  // with no producer is a dead union member.
  errorCodes: [
    "unexpected-page-state",
    "subject-mismatch",
    "department-option-not-offered",
    "comments-changed-since-read",
    "stage-not-persisted",
  ],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse(KUALI_RRSS_DISPLAYED_EID),
    match: "normalized-exact-eid",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["separations-kuali-finalization/stage-refusals"],
  checkpoint: "in-memory-only",
  example: {
    stagedPageState: KUALI_RRSS_FINALIZATION_STAGED,
    actionId: "0123456789abcdef01234567",
    documentNumber: "4444",
    observedEid: EidSchema.parse("10800000"),
    previousFields: {
      department: "- - -",
      payrollTitleCode: "",
      payrollTitle: "",
      requestAcknowledged: false,
      timekeeperName: "",
      lastDayWorked: "",
      separationDate: "",
      terminationEffectiveDate: "",
      submittedTerminationTemplate: false,
      transactionNumber: "",
      finalPay: null,
      timekeeperComments: "",
    },
    stagedFields: EXAMPLE_KUALI_FINALIZATION_FIELDS,
    observedDepartmentOptions: ["- - -", "000412 - Housing/Dining/Hospitality"],
    observedAt: "2026-08-14T10:18:00.000Z",
  },
});
