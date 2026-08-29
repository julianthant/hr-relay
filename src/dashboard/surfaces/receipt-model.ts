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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type {
  RunReceiptComparisonTarget,
  RunReceiptComparisonWire,
} from "../../domain/dashboard/run-comparison.js";
import type { RunEvidenceReceiptSchema } from "../../domain/trust/evidence.js";
import { DashboardClientError } from "../client/index.js";
import { useDashboardClient } from "../state/client-context.js";
import { fmtClock } from "./format.js";

type RunEvidenceReceiptWire = z.infer<typeof RunEvidenceReceiptSchema>;
type ReceiptConfidence = RunEvidenceReceiptWire["confidence"];

/**
 * The receipt-comparison panel's state is deliberately more precise than a
 * generic async resource. A run with no prior retry is a real empty state;
 * an authority refusal or unavailable comparison must never be painted as one.
 */
export type ReceiptComparisonState =
  | Readonly<{ state: "not-comparable" }>
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "ready"; value: RunReceiptComparisonWire }>
  | Readonly<{ state: "unavailable"; code: string }>
  | Readonly<{ state: "refused"; code: string }>
  | Readonly<{ state: "error"; code?: string }>;

export interface ReceiptComparisonRequest {
  readonly state: ReceiptComparisonState;
  readonly retry: () => void;
}

const NOT_COMPARABLE: ReceiptComparisonState = Object.freeze({ state: "not-comparable" });
const COMPARISON_LOADING: ReceiptComparisonState = Object.freeze({ state: "loading" });

function sameReceiptComparisonTarget(
  left: RunReceiptComparisonTarget | undefined,
  right: RunReceiptComparisonTarget | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.runId === right.runId
    && left.retryOf === right.retryOf
    && left.workflowId === right.workflowId
    && left.currentReceiptId === right.currentReceiptId;
}

/**
 * Suppress stored comparison state synchronously when it belongs to another
 * receipt selection. Effects start reads; they are never the paint boundary.
 */
export function visibleReceiptComparisonState(
  target: RunReceiptComparisonTarget | undefined,
  owner: RunReceiptComparisonTarget | undefined,
  state: ReceiptComparisonState,
): ReceiptComparisonState {
  if (target === undefined) return NOT_COMPARABLE;
  return sameReceiptComparisonTarget(target, owner) ? state : COMPARISON_LOADING;
}

/** Maps only typed client failures to the operator-safe comparison vocabulary. */
export function receiptComparisonFailure(error: DashboardClientError): ReceiptComparisonState {
  if (error.code === "SECTION_UNAVAILABLE") {
    return { state: "unavailable", code: error.code };
  }
  if (error.code === "TARGET_NOT_FOUND" || error.code === "COMPARISON_IDENTITY_REFUSED") {
    return { state: "refused", code: error.code };
  }
  return error.code === undefined ? { state: "error" } : { state: "error", code: error.code };
}

/**
 * Read D289's comparison only while the Receipt tab owns a current receipt
 * with its exact `retryOf`. The request generation and effect cleanup mean a
 * reply for a previously selected run cannot bind to the new selection.
 */
export function useReceiptComparison(
  target: RunReceiptComparisonTarget | undefined,
): ReceiptComparisonRequest {
  const client = useDashboardClient();
  const [stored, setStored] = useState<Readonly<{
    owner: RunReceiptComparisonTarget | undefined;
    state: ReceiptComparisonState;
  }>>({ owner: undefined, state: NOT_COMPARABLE });
  const [reloadNonce, setReloadNonce] = useState(0);
  const activeTarget = useRef<RunReceiptComparisonTarget | undefined>(undefined);
  const requestGeneration = useRef(0);
  const runId = target?.runId;
  const retryOf = target?.retryOf;
  const workflowId = target?.workflowId;
  const currentReceiptId = target?.currentReceiptId;

  useLayoutEffect(() => {
    activeTarget.current = runId === undefined
      || retryOf === undefined
      || workflowId === undefined
      || currentReceiptId === undefined
      ? undefined
      : { runId, retryOf, workflowId, currentReceiptId };
    requestGeneration.current += 1;
  }, [currentReceiptId, retryOf, runId, workflowId]);

  useEffect(() => {
    if (
      runId === undefined
      || retryOf === undefined
      || workflowId === undefined
      || currentReceiptId === undefined
    ) {
      setStored({ owner: undefined, state: NOT_COMPARABLE });
      return;
    }
    let active = true;
    const requestedTarget: RunReceiptComparisonTarget = {
      runId,
      retryOf,
      workflowId,
      currentReceiptId,
    };
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setStored({ owner: requestedTarget, state: COMPARISON_LOADING });
    client.runReceiptComparison(requestedTarget).then(
      (value) => {
        if (
          !active
          || requestGeneration.current !== generation
          || !sameReceiptComparisonTarget(activeTarget.current, requestedTarget)
        ) return;
        setStored({ owner: requestedTarget, state: { state: "ready", value } });
      },
      (error: unknown) => {
        if (
          !active
          || requestGeneration.current !== generation
          || !sameReceiptComparisonTarget(activeTarget.current, requestedTarget)
        ) return;
        if (error instanceof DashboardClientError) {
          setStored({ owner: requestedTarget, state: receiptComparisonFailure(error) });
          return;
        }
        setStored({ owner: requestedTarget, state: { state: "error" } });
      },
    );
    return () => {
      active = false;
    };
  }, [client, currentReceiptId, reloadNonce, retryOf, runId, workflowId]);

  return {
    state: visibleReceiptComparisonState(target, stored.owner, stored.state),
    retry: () => {
      requestGeneration.current += 1;
      setStored(target === undefined
        ? { owner: undefined, state: NOT_COMPARABLE }
        : { owner: target, state: COMPARISON_LOADING });
      setReloadNonce((current) => current + 1);
    },
  };
}

/** The wire carries only reviewed safe values in non-withheld arms. */
export function receiptComparisonValue(value: unknown): string {
  return canonicalJsonStringify(value);
}

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
