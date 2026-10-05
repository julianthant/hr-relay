/**
 * The Receipt tab's folds and vocabularies (`receipt.tsx` renders them; a
 * surface module exports components only — `dashboard-refresh-boundary`).
 *
 * Both folds close 03a fidelity ledger 2 rows under D273 item 7 — "port every
 * served receipt cue":
 *
 * - `receiptConfidenceChip` (row D8) — the demo qualifies the verdict WHERE the
 *   verdict is said: the word and its confidence in one glance, with the
 *   sentence that says what confidence MEANS. This tree served `confidence` and
 *   printed it as a bare word at the far end of the body, which is the one
 *   place an operator reading the verdict is not looking.
 * - `receiptIdentityItems` (row D9) — the demo's ONE identity line had become
 *   three lines in three places here (`completed` on the band, `receipt`/`run`
 *   in a section header, `attempt`/`retry of`/`generated` at the body's foot).
 *   The demo's four facts lead, in the demo's order; the facts this tree serves
 *   and the demo has no counterpart for follow.
 *
 * `filed by {actor}` (row D10) is NOT here and is not faked: `RunEvidenceReceiptSchema`
 * carries no actor at all.
 *
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoReceipt.tsx:82-86,220-232.
 */
import type { z } from "zod";
import type { RunEvidenceReceiptSchema } from "../../../../domain/trust/evidence.js";
import { fmtClock } from "../../shared/status/format.js";

type RunEvidenceReceiptWire = z.infer<typeof RunEvidenceReceiptSchema>;
type ReceiptConfidence = RunEvidenceReceiptWire["confidence"];

/**
 * What each confidence WORD means, in the demo's own three sentences
 * (`DemoReceipt.tsx:82-86`). The word alone is a term of art — "partial" reads
 * as a hedge until it says which half of the transaction was read back.
 */
export const CONFIDENCE_COPY: Record<ReceiptConfidence, string> = {
  verified: "read back from the system of record",
  partial: "some of it read back",
  unknown: "nothing was read back",
};

/**
 * The confidence chip beside the verdict word. `verified` is the expected
 * case and reads as chrome (`neutral`); anything else is a qualification the
 * eye must catch (`warning`) — the demo's exact two arms.
 */
export function receiptConfidenceChip(confidence: ReceiptConfidence): {
  tone: "neutral" | "warning";
  text: string;
} {
  return {
    tone: confidence === "verified" ? "neutral" : "warning",
    text: `${confidence} — ${CONFIDENCE_COPY[confidence]}`,
  };
}

/** The receipt facts this line can carry — the whole receipt, or none of it. */
type ReceiptIdentity = Pick<
  RunEvidenceReceiptWire,
  "receiptId" | "runId" | "generatedAt" | "attempt" | "retryOf" | "failure"
>;

/**
 * The receipt's ONE identity line.
 *
 * Order: the demo's four facts first, in the demo's order (`receipt` ·
 * `generated` · `attempt` · `retry of`), then the two this tree serves and the
 * demo never had — the run's own id, and the `failure` id a failed run's
 * receipt names beside itself (row D32) — and last the run's terminal instant,
 * which is a DIFFERENT moment from `generated` and so cannot stand in for it.
 *
 * Every segment is conditional on its fact being present; an absent one drops
 * out rather than printing a placeholder.
 */
export function receiptIdentityItems(input: {
  receipt?: ReceiptIdentity;
  completedAt?: string;
}): string[] {
  const { receipt, completedAt } = input;
  const items: string[] = [];
  if (receipt !== undefined) {
    items.push(`receipt ${receipt.receiptId}`);
    items.push(`generated ${fmtClock(receipt.generatedAt)}`);
    items.push(`attempt ${String(receipt.attempt)}`);
    if (receipt.retryOf.state === "present") items.push(`retry of ${receipt.retryOf.value}`);
    items.push(`run ${receipt.runId}`);
    if (receipt.failure.state === "present") items.push(`failure ${receipt.failure.value}`);
  }
  if (completedAt !== undefined) items.push(`completed ${fmtClock(completedAt)}`);
  return items;
}
