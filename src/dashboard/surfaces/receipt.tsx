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
import { ArrowLeft, ArrowRight, EyeOff, RefreshCw, ShieldCheck } from "lucide-react";
import type { z } from "zod";
import type { RunReceiptComparisonWire } from "../../domain/dashboard/run-comparison.js";
import { cn } from "../lib/utils.js";
import { Banner, Button, DS_STATUS, EmptyState, MetaLine, Skeleton, dsIcon, dsRadius, dsText } from "../ds/ui.js";
import { ReceiptEvidenceBody } from "./trust.js";
import type { RunDetailSectionResponseSchema } from "../../domain/dashboard/run-detail.js";
import {
  receiptComparisonValue,
  receiptConfidenceChip,
  receiptIdentityItems,
  type ReceiptComparisonRequest,
} from "./receipt-model.js";
import { testInstanceSystems } from "./test-instance-hazard.js";
import type { OutcomeWire, TerminalOutcomeResult } from "./status-model.js";

type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
export type ReceiptSectionPayload = Extract<RunDetailSectionResponse, { section: "receipt" }>["payload"];

/**
 * Row D9's identity line breaks between FACTS, never mid-fact (F8d finding 3).
 * `MetaLine` renders each item as plain text inside its own span, and a fact
 * like `receipt aaaaaaaa-…` has a space in it the browser is free to wrap on,
 * orphaning the uuid onto its own line. Each segment is `whitespace-nowrap`
 * so the browser's only legal break point is the `·` separator MetaLine
 * already draws between facts. Both of the line's homes (the band, and the
 * absence it renders under when there is no band) share this fold so they
 * cannot drift into two different wrap behaviors for one identity line.
 */
function identityLineItems(items: readonly string[]) {
  return items.map((item, index) => <span key={index} className="whitespace-nowrap">{item}</span>);
}

const RESULT_COPY: Record<TerminalOutcomeResult, { word: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  "verified-done": { word: DS_STATUS.verifiedDone.label, tone: "success" },
  "done-with-warnings": { word: DS_STATUS.doneWarnings.label, tone: "warning" },
  partial: { word: "Partial outcome", tone: "warning" },
  failed: { word: DS_STATUS.failed.label, tone: "danger" },
  cancelled: { word: DS_STATUS.cancelled.label, tone: "neutral" },
};

/**
 * The confidence sentence's tint — the same two tones `receiptConfidenceChip`
 * returns, reproduced locally rather than reused from `Chip`'s own
 * `CHIP_TONE` (private to `ds/primitives-core.tsx`).
 *
 * This is NOT a `Chip`. `Chip`'s own docstring is the rule (F5b): "if a fact
 * cannot survive truncation it is not a chip — put it on the row's `MetaLine`,
 * where it can wrap." The confidence sentence is a full clause ("verified —
 * read back from the system of record"), and `Chip` clips its paint to one
 * line inside its own border — exactly the load-bearing sentence D8 exists to
 * surface would be cut. A tinted, wrapping span keeps the same visual cue
 * (the eye must still catch a non-`verified` confidence) without clipping the
 * sentence that says what it means (F8d finding 2).
 */
const CONFIDENCE_TONE_CLASS: Record<"neutral" | "warning", string> = {
  neutral: "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] text-[color:var(--ds-recess-fg)]",
  warning:
    "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)] text-[color:var(--ds-status-waiting-fg)]",
};

/**
 * The Receipt tab's whole 1i surface. `resolvedInstances` is the row's served
 * instance resolution — the TEST banner draws from it exactly as the demo
 * draws from the receipt's own.
 *
 * `dryRun` is REQUIRED, not an optional flag defaulting to `false` (ledger 2
 * row D13, ruled in under D273 item 7). It is the run's own served rehearsal
 * bit, but this component's callers do not all have it: `log-panel.tsx`'s
 * queue `surface` is genuinely absent when a panel is opened for a run
 * outside the currently loaded day, which is a real reachable state and not
 * defensive typing. Making the prop optional-with-default would let a caller
 * that does not know the answer silently render "not a rehearsal" about a run
 * nobody asked — the exact silent-fallback shape CLAUDE.md's fail-loud rule
 * forbids. So the caller must say explicitly `true`, `false`, or `undefined`
 * ("I do not know"), and only `true` draws the banner; `false` and `undefined`
 * both draw nothing, because neither is the same fact as "this really is a
 * rehearsal".
 */
export function ReceiptView({
  outcome,
  receipt,
  resolvedInstances = [],
  dryRun,
  comparison,
}: {
  outcome: OutcomeWire;
  receipt: ReceiptSectionPayload;
  resolvedInstances?: readonly { system: string; instance: "prod" | "test" }[];
  dryRun: boolean | undefined;
  /** The panel owns the request so static receipt rendering remains a pure read. */
  comparison?: ReceiptComparisonRequest;
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
          <MetaLine items={identityLineItems(identityItems)} />
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

      {/* Ledger 2 row D13 — the demo's dry-run Banner, ruled in whole under
          D273 item 7. `dryRun === true` only: `false` and `undefined` both
          draw nothing, per this component's own doc comment above. */}
      {dryRun === true && (
        <Banner tone="info" title="Dry run — this run was a rehearsal">
          A dry run reads everything and writes nothing. Any value below is an observation, never a change.
        </Banner>
      )}

      {/* `bandCarriesIdentity` — WHEN a band renders (a terminal outcome), it
          already prints this receipt's id, instant, attempt, retry-of and
          confidence, so the body must not print them a second time. When the
          run has not terminalized there IS no band (see the branch above), so
          `bandCarriesIdentity` must be false there or confidence and the rest
          render nowhere at all — the exact defect the surface's own "facts are
          never dropped" comment forbids (F8d finding 1). The archive mounts
          the same body with no band and keeps its full trailing line, which is
          this same `false` case, just for a different reason. */}
      {value !== undefined && (
        <ReceiptEvidenceBody receipt={value} bandCarriesIdentity={outcome.state === "terminal"} />
      )}
      {value !== undefined && comparison !== undefined && <ReceiptComparisonPanel comparison={comparison} />}
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

/** D289's current-versus-exact-prior receipt comparison, within the Receipt tab. */
export function ReceiptComparisonPanel({ comparison }: { comparison: ReceiptComparisonRequest }) {
  return (
    <section
      aria-label="Earlier run comparison"
      className="@container flex min-w-0 flex-col gap-[var(--ds-space-base)] border-t border-[color:var(--ds-border-subtle)] pt-[var(--ds-space-loose)]"
    >
      <div className="flex flex-col gap-[var(--ds-space-hair)]">
        <h3 className={cn(dsText.section, "font-semibold text-[color:var(--ds-fg)]")}>Earlier run comparison</h3>
        <p className={cn(dsText.body, "max-w-[70ch] text-[color:var(--ds-fg-muted)]")}>
          Reviewed details from this run and its earlier attempt. Protected details remain withheld.
        </p>
      </div>
      {comparison.state.state === "not-comparable" && (
        <EmptyState
          title="No earlier run to compare"
          description="This run does not name an earlier attempt, so no comparison is available."
          className="border border-dashed border-[color:var(--ds-border-subtle)] bg-[var(--ds-surface-2)] p-[var(--ds-space-loose)]"
        />
      )}
      {comparison.state.state === "loading" && <ComparisonLoading />}
      {comparison.state.state === "ready" && <ComparisonFacts facts={comparison.state.value.facts} />}
      {comparison.state.state === "unavailable" && (
        <Banner tone="warning" title="Earlier run comparison is unavailable">
          The comparison authority is not available for this run. The receipt above remains the current authority.
        </Banner>
      )}
      {comparison.state.state === "refused" && (
        <Banner tone="danger" title="Earlier run comparison was refused">
          Authority could not establish a valid comparison for these two runs. The receipt above remains unchanged.
        </Banner>
      )}
      {comparison.state.state === "error" && (
        <Banner
          tone="danger"
          title="Earlier run comparison could not be loaded"
          action={<Button variant="secondary" icon={<RefreshCw aria-hidden className={dsIcon.sm} />} onClick={comparison.retry}>Retry comparison</Button>}
        >
          The comparison could not be read. Retry the same comparison before relying on it.
        </Banner>
      )}
    </section>
  );
}

function ComparisonLoading() {
  return (
    <div role="status" aria-label="Loading earlier run comparison" className="flex flex-col gap-[var(--ds-space-base)]">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-14" />
      <Skeleton className="h-14" />
    </div>
  );
}

function ComparisonFacts({ facts }: { facts: readonly RunReceiptComparisonWire["facts"][number][] }) {
  if (facts.length === 0) {
    return (
      <EmptyState
        title="No reviewed differences"
        description="No reviewed detail changed between this run and its earlier attempt."
        className="border border-dashed border-[color:var(--ds-border-subtle)] bg-[var(--ds-surface-2)] p-[var(--ds-space-loose)]"
      />
    );
  }
  return (
    <ul className="flex min-w-0 flex-col gap-[var(--ds-space-base)]" aria-label="Reviewed receipt differences">
      {facts.map((fact) => (
        <li key={fact.factId} className="min-w-0 border-b border-[color:var(--ds-border-subtle)] pb-[var(--ds-space-base)] last:border-b-0 last:pb-0">
          <ComparisonFact fact={fact} />
        </li>
      ))}
    </ul>
  );
}

function ComparisonFact({ fact }: { fact: RunReceiptComparisonWire["facts"][number] }) {
  if (fact.state === "withheld") {
    return (
      <div className="flex min-h-[44px] items-start gap-[var(--ds-space-base)]">
        <EyeOff aria-hidden className={cn(dsIcon.sm, "mt-0.5 shrink-0 text-[color:var(--ds-fg-muted)]")} />
        <div className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
          <span className={cn(dsText.ui, "font-medium text-[color:var(--ds-fg)]")}>{fact.label}</span>
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>Withheld to protect this detail.</span>
        </div>
      </div>
    );
  }
  const values = fact.state === "added"
    ? [{ label: "This run", value: receiptComparisonValue(fact.after), icon: <ArrowRight aria-hidden className={dsIcon.sm} /> }]
    : fact.state === "removed"
      ? [{ label: "Earlier run", value: receiptComparisonValue(fact.before), icon: <ArrowLeft aria-hidden className={dsIcon.sm} /> }]
      : [
          { label: "Earlier run", value: receiptComparisonValue(fact.before), icon: <ArrowLeft aria-hidden className={dsIcon.sm} /> },
          { label: "This run", value: receiptComparisonValue(fact.after), icon: <ArrowRight aria-hidden className={dsIcon.sm} /> },
        ];
  const stateLabel = fact.state === "added" ? "Added" : fact.state === "removed" ? "Removed" : "Changed";
  return (
    <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
      <div className="flex min-h-[44px] flex-wrap items-center gap-[var(--ds-space-base)]">
        <span className={cn(dsText.ui, "font-medium text-[color:var(--ds-fg)]")}>{fact.label}</span>
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{stateLabel}</span>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-[var(--ds-space-snug)] @min-[560px]:grid-cols-2">
        {values.map((entry) => (
          <div key={entry.label} className="flex min-w-0 gap-[var(--ds-space-snug)] bg-[var(--ds-surface-2)] p-[var(--ds-space-base)]">
            <span className="mt-0.5 shrink-0 text-[color:var(--ds-fg-muted)]">{entry.icon}</span>
            <div className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
              <dt className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{entry.label}</dt>
              <dd className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-fg)]")}>{entry.value}</dd>
            </div>
          </div>
        ))}
      </dl>
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
        {/* Row D8: a verdict is qualified WHERE it is said — the served word
            AND the sentence that says what the word means, "verified" alone
            never told the operator that "read back from the system of
            record" is what earned it. It is absent, not guessed, when no
            receipt was served. A tinted SPAN, not a `Chip` (F8d finding 2) —
            see `CONFIDENCE_TONE_CLASS`'s comment for why. */}
        {confidenceChip !== undefined && (
          <span
            className={cn(
              "inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-[var(--ds-space-tight)] border px-[var(--ds-space-snug)] py-[var(--ds-space-hair)]",
              dsRadius.sm,
              dsText.meta,
              CONFIDENCE_TONE_CLASS[confidenceChip.tone],
            )}
          >
            <span className="shrink-0 text-[color:var(--ds-fg-muted)]">confidence</span>
            <span className={cn(dsText.nums, "min-w-0 whitespace-normal break-words")}>{confidenceChip.text}</span>
          </span>
        )}
      </div>
      <MetaLine items={identityLineItems(identityItems)} />
    </div>
  );
}
