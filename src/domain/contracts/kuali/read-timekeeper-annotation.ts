/**
 * `kuali/read-timekeeper-annotation` — ref write-safety §5's IDEMPOTENCY PROBE for the
 * Kuali timekeeper-annotation transaction, and (through the same contract
 * shape) the model for its `save-verify` read-back sibling.
 *
 * It answers exactly one question: does THIS document already carry THIS exact
 * timekeeper value? The answer is a four-state `ProbeVerdict`, never a boolean:
 *
 *  - `present`  — the reloaded document displays the exact value ⇒ typed proof.
 *  - `absent`   — the reloaded document deterministically displays a DIFFERENT
 *                 value ⇒ typed `AbsentEvidence` bound to this key digest.
 *  - `ambiguous`— the anchor matched more than once (a Kuali form change) ⇒ park.
 *  - `unknown`  — the read itself failed, or the page was not the expected
 *                 document ⇒ park. A failed check is never "found nothing".
 *
 * Freshness is zero-age: a probe answer is only ever the live page, never a
 * checkpoint (ref write-safety §2.1's `Idempotency.probe` requirement, enforced by the
 * `write-safety-contract` guard).
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiSavedTimekeeperProofSchema,
  KualiTimekeeperNameSchema,
} from "../../ui/kuali-rrss-document.js";
import { probeVerdictSchema } from "../../write-safety-primitives.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

export const KualiTimekeeperTargetSchema = z.strictObject({
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
  emplId: EidSchema,
  timekeeperName: KualiTimekeeperNameSchema,
});
export type KualiTimekeeperTarget = z.infer<typeof KualiTimekeeperTargetSchema>;

export const KualiTimekeeperVerdictSchema = probeVerdictSchema(KualiSavedTimekeeperProofSchema);
export type KualiTimekeeperVerdict = z.infer<typeof KualiTimekeeperVerdictSchema>;

export const KualiReadTimekeeperAnnotation = defineTaskContract({
  id: taskId("kuali/read-timekeeper-annotation"),
  title: "Read Kuali Timekeeper Annotation",
  effect: "read",
  input: KualiTimekeeperTargetSchema,
  output: KualiTimekeeperVerdictSchema,
  errorCodes: ["kuali-unavailable", "unexpected-page-state", "subject-mismatch"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse("kuali.rrss-document.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["kuali-timekeeper-annotation/dry-run-preview"],
  example: {
    state: "absent",
    evidence: {
      idempotencyKeyDigest: "0".repeat(64),
      source: "kuali.rrss-document.displayed-timekeeper",
      sourceState: "kuali.rrss-document.ready",
      observedAt: "2026-08-04T10:18:00.000Z",
      queryDigest: "1".repeat(64),
      evidenceRef: "observation:00000000-0000-4000-8000-000000000000",
    },
  },
});
