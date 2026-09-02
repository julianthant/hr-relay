/**
 * `ucpath/match-pending-terminations` — ref write-safety §5's **second probe kind**: the
 * DATE-AGNOSTIC one.
 *
 * Ref write-safety §5 requires both, and they are genuinely different questions asked of
 * the same page:
 *
 * | Probe | Question | Keyed by |
 * |---|---|---|
 * | `ucpath/match-existing-termination` | is this person already being terminated **effective this date**? | EID + effdt + `Terminat*` |
 * | this one | does this person have **any** in-progress termination at all? | EID + `Terminat*` + in-progress status |
 *
 * Legacy's `deletePendingTransaction` asks the second one and deletes every
 * matching in-progress row before filing — which the behavior review rates
 * `sound` in intent (**S30/S31**) while noting it is *the first mutation the
 * run performs*. That is exactly why it is its own transaction here rather than
 * a step inside the termination's prepare: a delete is an external write, and
 * an external write gets a fence, a permanent key and a read-back like every
 * other one.
 *
 * ## The verdict's polarity, which is the part worth reading twice
 *
 * The "transaction" this probe guards is **"this person has no in-progress
 * termination rows"**. So:
 *
 *  - `present`   — there are none ⇒ the sweep is `already-present`, nothing is
 *                  clicked, and the run moves on. This is the common case.
 *  - `absent`    — in-progress rows exist ⇒ the sweep proceeds.
 *  - `ambiguous` / `unknown` — park. A scan that could not be read is never
 *                  "there was nothing to delete": that reading would let the
 *                  termination file on top of a pending duplicate.
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathPendingSweepSettlementProofSchema,
  UcpathPendingSweepTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { probeVerdictSchema } from "../../write-safety-primitives.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

export const UcpathPendingSweepVerdictSchema = probeVerdictSchema(
  UcpathPendingSweepSettlementProofSchema,
);
export type UcpathPendingSweepVerdict = z.infer<typeof UcpathPendingSweepVerdictSchema>;

export const UcpathMatchPendingTerminations = defineTaskContract({
  id: taskId("ucpath/match-pending-terminations"),
  title: "Probe Pending UCPath Terminations",
  effect: "read",
  input: UcpathPendingSweepTargetSchema,
  output: UcpathPendingSweepVerdictSchema,
  errorCodes: ["ucpath-unavailable", "unexpected-page-state", "subject-mismatch"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SS_SMART_HR_DISPLAYED_NAME),
    match: "normalized-exact-name",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: [
    "separations-ucpath-termination/pending-sweep-nothing-to-do",
    "separations-ucpath-termination/pending-sweep-refuses-unreadable-scan",
  ],
  example: {
    state: "present",
    proof: {
      kind: "ucpath-pending-terminations-clear",
      emplId: EidSchema.parse("10800000"),
      scannedRowCount: 3,
      observedAt: "2026-08-13T10:18:00.000Z",
      source: "ss-smart-hr-detail-read",
      version: 2,
      selectedTransactionIds: "none",
      protectedTransactionIds: "T002204014",
      setDigest: "0".repeat(64),
    },
  },
});
