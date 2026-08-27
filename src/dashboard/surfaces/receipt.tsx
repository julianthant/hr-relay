/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoReceipt.tsx
 *
 * The receipt's FRAME — the verdict band, the banners, the absence treatments — fed by what the
 * wire serves: the terminal outcome and the receipt section resource (a receipt, or an explicit
 * missing / purged / error state). The BODY is `trust.tsx`'s `ReceiptEvidenceBody` (input /
 * observations / decisions / actions / verification / output / reuse / warnings / fingerprints),
 * which this surface mounts once the resource resolves to a real receipt and which the archive
 * surface mounts too, so a live receipt and an archived one cannot describe one run two ways.
 *
 * This file's header used to call itself "the 1i Receipt PLACEHOLDER" and defer the body to 2g.
 * 2g landed; the sentence did not (ledger 2 row D39 — the same false-deferral shape D251 found on
 * the picker). Corrected 2026-08-26.
 *
 * The verdict word is read from `DS_STATUS`, never restated — a chip saying
 * `Done` beside a receipt saying `Verified done` was two names for one
 * verdict. `partial` keeps its own word: it is the one verdict with no status
 * of its own. What DOES sit beside the word is the confidence that qualifies
 * it (ledger 2 row D8) and the one identity line (row D9); both are folded in
 * `receipt-model.ts`.
 */
import { ShieldCheck } from "lucide-react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import { Banner, Chip, DS_STATUS, EmptyState, MetaLine, dsIcon, dsText } from "../ds/ui.js";
import { ReceiptEvidenceBody } from "./trust.js";
import type { RunDetailSectionResponseSchema } from "../../domain/dashboard/run-detail.js";
import { receiptConfidenceChip, receiptIdentityItems } from "./receipt-model.js";
import { testInstanceSystems } from "./test-instance-hazard.js";
import type { OutcomeWire, TerminalOutcomeResult } from "./status-model.js";

type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
export type ReceiptSectionPayload = Extract<RunDetailSectionResponse, { section: "receipt" }>["payload"];

const RESULT_COPY: Record<TerminalOutcomeResult, { word: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  "verified-done": { word: DS_STATUS.verifiedDone.label, tone: "success" },
  "done-with-warnings": { word: DS_STATUS.doneWarnings.label, tone: "warning" },
  partial: { word: "Partial outcome", tone: "warning" },
  failed: { word: DS_STATUS.failed.label, tone: "danger" },
  cancelled: { word: DS_STATUS.cancelled.label, tone: "neutral" },
};

/**
 * The Receipt tab's whole 1i surface. `resolvedInstances` is the row's served
 * instance resolution — the TEST banner draws from it exactly as the demo
 * draws from the receipt's own.
 */
export function ReceiptView({
  outcome,
  receipt,
  resolvedInstances = [],
}: {
  outcome: OutcomeWire;
  receipt: ReceiptSectionPayload;
  resolvedInstances?: readonly { system: string; instance: "prod" | "test" }[];
}) {
  const testSystems = testInstanceSystems(resolvedInstances);
  const value = receipt.state === "available" ? receipt.value : undefined;
  // The receipt's ONE identity line (row D9). It rides the band when there is
  // a band; when the run has not terminalized there is no band to ride, so it
  // is drawn under the absence instead — the facts are never dropped, they
  // only ever have one home at a time.
  const identityItems = receiptIdentityItems({
    receipt: value,
    completedAt: outcome.state === "terminal" ? outcome.completedAt : undefined,
  });

  return (
    <div className="flex flex-col gap-[var(--ds-space-loose)] p-[var(--ds-space-cozy)]">
      {outcome.state === "terminal" ? (
        <VerdictBand result={outcome.result} confidence={value?.confidence} identityItems={identityItems} />
      ) : (
        <>
          <EmptyState
            title="No receipt yet"
            description={`${outcome.reason}. A receipt is written at the run's terminal outcome.`}
          />
          <MetaLine items={identityItems} />
        </>
      )}

      {/*
        Ledger 2 row D11 — the demo's `receiptInvariant` Banner ("This receipt
        fails its own invariant — the verdict is not printed as fact") is
        DELIBERATELY not ported. D273 item 7 rules it out and names the reason
        the other two options are worse: drawing it (B) fabricates a state, and
        the audit's complaint was never that the check is missing — it was that
        nothing in the tree WROTE DOWN why it cannot fire. Written down here.

        The demo checks at RENDER what this tree makes unrepresentable at the
        WIRE. `ReceiptSectionSchema` IS `RunEvidenceReceiptSchema`
        (`domain/dashboard/run-detail.ts:654`), whose refinement refuses a
        `verified-done` receipt that carries anything but verified confidence,
        an unresolved mandatory fact or obligation, a warning, or a failure id —
        every clause the demo's banner exists to catch. A receipt that fails the
        invariant therefore never reaches this component at all: it throws at
        parse, loudly, with the offending path named, which is strictly better
        than a red box the operator has to notice. `receipt-invariant-unrepresentable.test.ts`
        pins each clause, so the day one is relaxed a test fails rather than
        this comment quietly becoming false.
      */}

      {testSystems.length > 0 && (
        <Banner tone="warning" title={`Written to the TEST instance of ${testSystems.join(", ")} — this is not a filing`}>
          Everything below really happened, on a test system. Nothing on this receipt changed a production record, and the
          confirmation numbers are test-instance numbers.
        </Banner>
      )}

      {/* `bandCarriesIdentity` — the band above already prints this receipt's
          id, instant, attempt, retry-of and confidence, so the body must not
          print them a second time. The archive mounts the same body with no
          band and keeps its full trailing line.

          There is no `Receipt` SectionLabel around this any more. It existed to
          head the identity MetaLine that row D9 moved onto the band, and once
          that left it was a caps label sitting directly on top of the body's
          own first caps label with nothing between them — chrome naming chrome.
          The band above says `receipt {id}`, which is what the heading was for. */}
      {value !== undefined && <ReceiptEvidenceBody receipt={value} bandCarriesIdentity />}
      {receipt.state === "missing" && <EmptyState title="No receipt" description={receipt.reason} />}
      {receipt.state === "purged" && <EmptyState title="Receipt purged" description={receipt.reason} />}
      {receipt.state === "error" && (
        <Banner tone="danger" title="Receipt could not be loaded">
          {receipt.message} <span className={cn(dsText.meta, dsText.nums)}>code {receipt.code}</span>
        </Banner>
      )}
    </div>
  );
}

/** the verdict, the confidence that qualifies it, and the receipt's identity line */
function VerdictBand({
  result,
  confidence,
  identityItems,
}: {
  result: TerminalOutcomeResult;
  confidence?: "verified" | "partial" | "unknown";
  identityItems: readonly string[];
}) {
  const verdict = RESULT_COPY[result];
  const confidenceChip = confidence === undefined ? undefined : receiptConfidenceChip(confidence);
  return (
    <div
      className={cn(
        "flex flex-col gap-[var(--ds-space-snug)] border px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
        "rounded-[var(--ds-radius-lg)]",
        verdict.tone === "success"
          ? "border-[color:var(--ds-success-border)] bg-[var(--ds-success-bg)]"
          : verdict.tone === "warning"
            ? "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)]"
            : verdict.tone === "danger"
              ? "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]"
              : "border-[color:var(--ds-border)] bg-[var(--ds-surface-2)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
        <ShieldCheck
          aria-hidden
          className={cn(
            dsIcon.lg,
            verdict.tone === "success"
              ? "text-[color:var(--ds-success-fg)]"
              : verdict.tone === "danger"
                ? "text-[color:var(--ds-danger)]"
                : "text-[color:var(--ds-status-waiting-fg)]",
          )}
        />
        <span className={cn(dsText.section, "font-semibold text-[color:var(--ds-fg)]")}>{verdict.word}</span>
        {/* Row D8: a verdict is qualified WHERE it is said. The chip carries
            the served word AND the sentence that says what the word means —
            `verified` alone never told the operator that "read back from the
            system of record" is what earned it. It is absent, not guessed,
            when no receipt was served. */}
        {confidenceChip !== undefined && (
          <Chip label="confidence" tone={confidenceChip.tone}>{confidenceChip.text}</Chip>
        )}
      </div>
      <MetaLine items={[...identityItems]} />
    </div>
  );
}
