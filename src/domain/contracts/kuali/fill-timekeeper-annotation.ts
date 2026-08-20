/**
 * `kuali/fill-timekeeper-annotation` — the PREPARE arm of Phase 2's Kuali
 * transaction proof (ref write-safety §3 beat ②).
 *
 * Prepare opens the document by its deep link, proves it is the expected
 * document, and stages the timekeeper value in the live input with a read-back
 * verify. It performs NO save: nothing it does survives a page close, which is
 * exactly what makes `dryRun:"stop-after-prepare"` a genuine no-effect preview.
 *
 * Its output is preview/span data only — the builder gives `commit.bind` the
 * same scope as `prepare.bind`, so nothing here can reach the durable
 * idempotency key (ref workflow-model §3.1, pinned by the `transaction-pairing` guard).
 *
 * `stagedPageState` is required by name: the write sequencer reads it to bind
 * the binding proof to the EXACT staged page, and refuses to fence a prepare
 * output that cannot name one.
 */
import { z } from "zod";
import { EidSchema, IsoInstantSchema, ObservationIdSchema, taskId } from "../../ids.js";
import {
  KUALI_RRSS_TIMEKEEPER_STAGED,
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiTimekeeperNameSchema,
} from "../../ui/kuali-rrss-document.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

export const KualiTimekeeperStagedOutputSchema = z.strictObject({
  stagedPageState: z.literal(KUALI_RRSS_TIMEKEEPER_STAGED),
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  observedEid: EidSchema,
  /** What the field held before staging — the operator's undo value. */
  previousTimekeeperName: z.string(),
  stagedTimekeeperName: KualiTimekeeperNameSchema,
  observedAt: IsoInstantSchema,
});
export type KualiTimekeeperStagedOutput = z.infer<typeof KualiTimekeeperStagedOutputSchema>;

export const KualiFillTimekeeperAnnotation = defineTaskContract({
  id: taskId("kuali/fill-timekeeper-annotation"),
  title: "Stage Kuali Timekeeper Annotation",
  effect: "prepare",
  input: z.strictObject({
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
    emplId: EidSchema,
    timekeeperName: KualiTimekeeperNameSchema,
  }),
  output: KualiTimekeeperStagedOutputSchema,
  errorCodes: ["kuali-unavailable", "unexpected-page-state", "subject-mismatch", "fill-not-persisted"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse("kuali.rrss-document.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["kuali-timekeeper-annotation/dry-run-preview"],
  checkpoint: "in-memory-only",
  example: {
    stagedPageState: KUALI_RRSS_TIMEKEEPER_STAGED,
    actionId: "0123456789abcdef01234567",
    documentNumber: "4444",
    observedEid: EidSchema.parse("10800000"),
    previousTimekeeperName: "",
    stagedTimekeeperName: "PROBE-DELETE-ME",
    observedAt: IsoInstantSchema.parse("2026-08-04T10:18:00.000Z"),
  },
});
