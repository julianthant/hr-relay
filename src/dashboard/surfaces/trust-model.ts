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
import type { DiagnosticBundleWire } from "../../domain/dashboard/diagnostic-bundle.js";
import type { FailureDetailWireSchema } from "../../domain/dashboard/run-detail.js";
import type { RunEvidenceReceiptSchema } from "../../domain/trust/evidence.js";
import { fmtClock, plural, shortHash } from "./format.js";

type RunEvidenceReceiptWire = z.infer<typeof RunEvidenceReceiptSchema>;
type FailureDetailWire = z.infer<typeof FailureDetailWireSchema>;

export type DiagnosticBundleReadbackAcceptance =
  | Readonly<{ state: "ready"; bundle: DiagnosticBundleWire }>
  | Readonly<{ state: "identity-mismatch"; bundleId: string; message: string }>;

/** A component-injected client is still outside the trust boundary until its exact id is checked. */
export function acceptDiagnosticBundleReadback(
  requestedBundleId: string,
  bundle: DiagnosticBundleWire,
): DiagnosticBundleReadbackAcceptance {
  if (bundle.bundleId === requestedBundleId) return Object.freeze({ state: "ready", bundle });
  return Object.freeze({
    state: "identity-mismatch",
    bundleId: requestedBundleId,
    message: `DIAGNOSTIC_BUNDLE_IDENTITY_MISMATCH: requested diagnostic bundle ${requestedBundleId} returned a different bundle identity`,
  });
}

/* ── the failure record's vocabulary (D273 item 8, ledger 2 §R-E) ─────────── */

/**
 * Ported from legacy hr-automation@c9e6aaf3aa8978a776f72205b71a96a988773b43,
 * src/dashboard/components/dev/rebuild-demo/DemoFailure.tsx:156-161,190-205
 * (the write-state block's three tones and its labelled frame).
 *
 * WHAT THIS RUN LEFT BEHIND, and how loudly to say it.
 *
 * The demo keys its tone off a served `writeState.tone` of `none | unknown |
 * other`. This wire serves no tone at all — `writeState` is a six-arm enum — so
 * the mapping is made HERE, once, and it is total: a seventh arm is a
 * typecheck failure rather than a silent `?? "left-behind"`.
 *
 * Only `not-attempted` takes the settled tone. `prepared` does NOT, even though
 * nothing reached the target system: a staged intent is a durable row and a
 * fence the operator may still have to clear, and this sentence's whole job is
 * to separate "safe to retry" from "may duplicate a termination". A tone that
 * is wrong in the reassuring direction is the only one that can hurt somebody.
 */
export type FailureWriteStateTone = "nothing-written" | "unknown" | "left-behind";

export const FAILURE_WRITE_STATE: Readonly<
  Record<FailureDetailWire["writeState"], Readonly<{ sentence: string; tone: FailureWriteStateTone }>>
> = Object.freeze({
  "not-attempted": Object.freeze({
    sentence: "This run wrote nothing — no write was attempted.",
    tone: "nothing-written",
  }),
  prepared: Object.freeze({
    sentence: "A write was staged but never committed.",
    tone: "left-behind",
  }),
  attempting: Object.freeze({
    sentence: "A write attempt was in flight; this run did not settle its outcome.",
    tone: "left-behind",
  }),
  committed: Object.freeze({
    sentence: "A write was committed; its read-back verification did not complete.",
    tone: "left-behind",
  }),
  verified: Object.freeze({
    sentence: "A write was committed and verified.",
    tone: "left-behind",
  }),
  unknown: Object.freeze({
    sentence: "The write outcome is unknown — the intent is parked for operator resolution.",
    tone: "unknown",
  }),
});

/**
 * Ported from the same file, :185-187 — the head's permanence Chip.
 *
 * `transient` is a REQUIRED boolean on the wire and the record used to print
 * the bare word `transient` for the true arm and nothing at all for the false
 * one, so the reading that actually changes what the operator does — *do not
 * press retry, the same input will fail again* — was the one that never
 * appeared. Both arms are stated, because silence is not the opposite of a
 * warning; it reads as "nobody classified this".
 */
export function failurePermanence(transient: boolean): Readonly<{ text: string; tone: "warning" | "neutral" }> {
  return transient
    ? Object.freeze({ text: "transient — a later attempt may differ", tone: "warning" as const })
    : Object.freeze({ text: "permanent — the same input will fail again", tone: "neutral" as const });
}

/**
 * Ported from the same file, :365-376 — the fingerprint's history, in the two
 * arms the demo draws, beside the diagnostic bundle.
 *
 * `sameFingerprintSeen` counts THIS occurrence too (`FailureDetailWireSchema`'s
 * own `superRefine`), so `1` is genuinely a first sighting. It used to render
 * only when `> 1`, which made "this has never happened before" and "nobody
 * counted" the same blank — the defect D141 is not about, and the one an
 * operator reads as reassurance.
 *
 * What is NOT ported, and is not an absence to name on screen: the demo's
 * `window`, `lastTrace`, `lastAt` and `note`. `ref operator-trust` D141 rules the
 * count out as a LIST of other runs; the wire carries none of the four, and a
 * window invented here would be exactly the banned constant.
 */
export function failureFingerprintHistory(
  sameFingerprintSeen: number,
): Readonly<{ text: string; tone: "seen-before" | "first" }> {
  if (!Number.isInteger(sameFingerprintSeen) || sameFingerprintSeen < 1) {
    throw new Error(
      `failureFingerprintHistory: sameFingerprintSeen must be a positive integer (the projected failure is itself one occurrence); received ${String(sameFingerprintSeen)}`,
    );
  }
  return sameFingerprintSeen === 1
    ? Object.freeze({ text: "First time this fingerprint has been seen.", tone: "first" as const })
    : Object.freeze({
        text: `Seen ${String(sameFingerprintSeen)} times, this one included.`,
        tone: "seen-before" as const,
      });
}

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

/* ── the receipt body's three ported cues (ledger 2 D17 / D24 / D29) ────────
 *
 * All three are served facts this tree already had and drew as bare words. The
 * demo draws each one with a MARK the eye catches before it reads — a badge, an
 * icon, a full sentence — and D273 item 7 rules that every served receipt cue
 * is ported. Each fold is total over its served enum: a new arm is a type
 * error, never a silent default.
 *
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoReceipt.tsx:110 (D17),
 * :332-368 (D24) and :455-473 (D29).
 */

type ActionKind = RunEvidenceReceiptWire["actions"][number]["kind"];
type VerificationVerdict = RunEvidenceReceiptWire["verification"][number]["verdict"];

/**
 * D17 — the write KIND as a badge rather than a word folded into a sentence.
 *
 * `commit` is the one arm that changed a record of a real system, so it is the
 * one arm that reads as news (`info`, the demo's own tone at :110). `prepare`
 * is the demo's `neutral`; `external-read` and `local-projection` are arms the
 * demo has no counterpart for and are neutral for the same reason `prepare` is
 * — nothing was filed.
 */
export function writeActionBadgeTone(kind: ActionKind): "info" | "neutral" {
  return kind === "commit" ? "info" : "neutral";
}

/** D24 — the completion criterion's mark: met, unmet, or neither known. */
export type VerificationMark = "met" | "unmet" | "uncertain";

/**
 * `verified` and `present` are the two verdicts that MET the obligation;
 * `absent` is the one that answered it and found nothing, which is the demo's
 * `unmet`; `unknown` and `ambiguous` did not answer it at all, which is the
 * demo's third arm. The verdict WORD still renders beside the mark — the mark
 * is a second channel, not a replacement.
 */
export function verificationMark(verdict: VerificationVerdict): VerificationMark {
  switch (verdict) {
    case "verified":
    case "present":
      return "met";
    case "absent":
      return "unmet";
    case "unknown":
    case "ambiguous":
      return "uncertain";
  }
}

/**
 * D29 — what `loadBearing` MEANS, in the demo's two full sentences
 * (`DemoReceipt.tsx:466-468`). This tree collapsed both to the single word
 * "load-bearing" on the section whose entire job is saying what is still
 * uncertain — and said nothing at all in the false case, so an operator could
 * not tell a declared-harmless warning from an unclassified one.
 */
export function uncertaintySentence(loadBearing: boolean): string {
  return loadBearing
    ? "load-bearing — this is why the run cannot read as done"
    : "declared non-load-bearing — it cannot change the transaction or the core result";
}
