/**
 * The pure half of `trust.tsx` (the surface/model pairing rule, ref
 * frontend-backend-integration §8.14 — a `.tsx` module exports components only).
 *
 * Ported from legacy hr-automation@c9e6aaf3aa8978a776f72205b71a96a988773b43,
 * src/dashboard/components/dev/rebuild-demo/DemoReceipt.tsx:370-411 (the
 * `What was read` table's `System` and `Observed` columns) and :431-439 (the
 * `input hash {…}` MetaLine under `The input this run was given`).
 */
import type { z } from "zod";
import type { RunEvidenceReceiptSchema } from "../../domain/trust/evidence.js";
import { fmtClock, plural, shortHash } from "./format.js";

type RunEvidenceReceiptWire = z.infer<typeof RunEvidenceReceiptSchema>;

/** `EvidenceSourceSchema`'s six arms, reached through the receipt's own type. */
export type EvidenceSourceWire = RunEvidenceReceiptWire["input"][number]["source"];

/**
 * WHERE a receipt fact came from, and WHEN — the one line beside every fact on
 * the receipt (input, observations, output alike).
 *
 * This used to print `source.kind` alone, which threw away bytes the wire had
 * already carried: the `system` and `checkpoint` arms hold a `taskId` AND an
 * `observedAt` (`src/domain/trust/evidence.ts:25-26`) and the `input` arm holds
 * an `inputFingerprint` (`:24`). The demo draws both as columns of its reads
 * table and the fingerprint as the Input section's own MetaLine. This tree's
 * facts are per-entry, but their input fingerprint is a run fact repeated on
 * every input-sourced entry, so the surface draws that one value in one Input
 * footer rather than on each field row.
 *
 * The fold is TOTAL on purpose. An arm that renders only its discriminant is
 * D253's unhandled-arm shape: it reads as a deliberate omission and is actually
 * a fact nobody drew, so every arm names what identifies it.
 */
export function evidenceSourceMeta(source: EvidenceSourceWire): string {
  switch (source.kind) {
    case "input":
      return `input · hash ${shortHash(source.inputFingerprint)}`;
    case "system":
      return `system · ${source.taskId} · ${fmtClock(source.observedAt)}`;
    case "checkpoint":
      return `checkpoint · ${source.taskId} · ${fmtClock(source.observedAt)}`;
    // D202/D204: the approver and the instant are authority's own values off
    // the `gate_results` row, not a claim in the gate's payload.
    case "gate-result":
      return `gate ${source.gateId} · by ${source.resolvedBy} · ${fmtClock(source.resolvedAt)}`;
    case "operator-correction":
      return `operator correction · supersedes ${source.supersedes}`;
    case "derived":
      return `derived · from ${plural(source.evidence.length, "entry", "entries")}`;
  }
}

type ReceiptFact = RunEvidenceReceiptWire["input"][number];

/**
 * The Input section's ONE input-fingerprint footer.
 *
 * `inputFingerprint` is a fact about the RUN (`canonicalInputFingerprint`,
 * `src/core/evidence-receipt.ts`), not about any one field — every fact in
 * `receipt.input` whose source is `kind: "input"` carries the identical
 * value. `trust.tsx` used to draw it as `evidenceSourceMeta`'s per-row meta,
 * which printed the same hash on every row (cut to `shortHash`'s 8 chars,
 * with no reachable full value — `shortHash`'s own contract in `format.ts`
 * requires one). Ported from legacy
 * hr-automation@c9e6aaf3aa8978a776f72205b71a96a988773b43,
 * DemoReceipt.tsx:437's `input hash {…}` `MetaLine`: the value is drawn ONCE,
 * whole, at the section's foot instead of once per row.
 *
 * Returns `undefined` when no fact in the given set carries an `input`
 * source, so a receipt with an empty or purely-observed Input section prints
 * no dangling footer.
 */
export function inputHashFooter(facts: readonly ReceiptFact[]): string | undefined {
  let inputFingerprint: string | undefined;
  for (const fact of facts) {
    if (fact.source.kind !== "input") continue;
    if (inputFingerprint !== undefined && inputFingerprint !== fact.source.inputFingerprint) {
      throw new Error("inputHashFooter: Input section has conflicting input fingerprints");
    }
    inputFingerprint = fact.source.inputFingerprint;
  }
  return inputFingerprint;
}
