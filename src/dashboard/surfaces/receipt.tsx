/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoReceipt.tsx
 *
 * The 1i Receipt PLACEHOLDER (doc 01 §Integration amendment — Phase 1's share): the demo receipt's frame, verdict
 * band and absence treatments, fed only by what the 1g wire serves — the
 * terminal outcome and the receipt section resource (a pointer, or an explicit
 * missing / purged / error state). The full `RunEvidenceReceipt` body the demo
 * renders (writes with read-backs, per-member confirmations, completion
 * criteria, observations, decisions, reuse lanes, warnings) is fixture-fed and
 * lands with the trust surfaces in 2g; nothing here fabricates a line of it.
 *
 * The verdict word is read from `DS_STATUS`, never restated — a chip saying
 * `Done` beside a receipt saying `Verified done` was two names for one
 * verdict. `partial` keeps its own word: it is the one verdict with no status
 * of its own.
 */
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import { Banner, DS_STATUS, EmptyState, MetaLine, SectionLabel, dsIcon, dsText } from "../ds/ui.js";
import { ReceiptEvidenceBody } from "./trust.js";
import type { RunDetailSectionResponseSchema } from "../../domain/dashboard/run-detail.js";
import { fmtClock } from "./format.js";
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

function ReceiptSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </section>
  );
}

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

  return (
    <div className="flex flex-col gap-[var(--ds-space-loose)] p-[var(--ds-space-cozy)]">
      {outcome.state === "terminal" ? (
        <VerdictBand result={outcome.result} completedAt={outcome.completedAt} />
      ) : (
        <EmptyState
          title="No receipt yet"
          description={`${outcome.reason}. A receipt is written at the run's terminal outcome.`}
        />
      )}

      {testSystems.length > 0 && (
        <Banner tone="warning" title={`Written to the TEST instance of ${testSystems.join(", ")} — this is not a filing`}>
          Everything below really happened, on a test system. Nothing on this receipt changed a production record, and the
          confirmation numbers are test-instance numbers.
        </Banner>
      )}

      {receipt.state === "available" && (
        <ReceiptSection label="Receipt">
          <MetaLine items={[`receipt ${receipt.value.receiptId}`, `run ${receipt.value.runId}`]} />
          <ReceiptEvidenceBody receipt={receipt.value} />
        </ReceiptSection>
      )}
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

/** the verdict, and the instant that qualifies it */
function VerdictBand({ result, completedAt }: { result: TerminalOutcomeResult; completedAt: string }) {
  const verdict = RESULT_COPY[result];
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
      </div>
      <MetaLine items={[`completed ${fmtClock(completedAt)}`]} />
    </div>
  );
}
