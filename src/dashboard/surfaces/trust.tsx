/**
 * The trust surfaces (ref operator-trust §2.1–§2.3, D140/D142 — UI half, 2i-A): the full
 * evidence receipt and the full failure record, rendered from the wire
 * content the sections have served since D140/D142.
 *
 * Rendering rules these components pin (ref dashboard-surfaces D18/D24, ref operator-trust D141/D142):
 * - the WRITE-STATE sentence renders unconditionally, never behind a
 *   disclosure — "what this run left behind" is the record's first job;
 * - `sameFingerprintSeen` renders as a COUNT, never a list of other runs;
 * - an absent diagnostic bundle names its reason, never a blank;
 * - redaction is already final: a `drop` arm renders as an explicit redacted
 *   state, a transformed value renders verbatim, and subject identity
 *   prefers the served `displayRedacted` — nothing is re-derived here;
 * - the receipt's schema order IS the narrative order: input → observations
 *   → decisions → actions → verification → output → reuse → warnings;
 * - empty sections are omitted (D24 restraint) — a receipt does not explain
 *   itself, and "no warnings" is best said by no warnings section.
 */
import type { ReactNode } from "react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import { Chip, MetaLine, SectionLabel, dsText } from "../ds/ui.js";
import type { FailureDetailWireSchema } from "../../domain/dashboard/run-detail.js";
import type { RunEvidenceReceiptSchema } from "../../domain/trust/evidence.js";
import { fmtClock } from "./format.js";

export type RunEvidenceReceiptWire = z.infer<typeof RunEvidenceReceiptSchema>;
export type FailureDetailWire = z.infer<typeof FailureDetailWireSchema>;
type EvidenceFactWire = RunEvidenceReceiptWire["input"][number];
type FactValue = Extract<EvidenceFactWire, { state: "satisfied" }>["value"];

/* ── shared little pieces ────────────────────────────────────────────────── */

function redactedText(value: FactValue): string {
  if (value.state === "redacted") return `redacted — ${value.classification}`;
  if (value.transform === "count") return `${String(value.value)} (count)`;
  return typeof value.value === "string" ? value.value : JSON.stringify(value.value);
}

function FactRow({ label, value, tone, meta }: {
  label: string;
  value: string;
  tone?: "danger" | "warning";
  meta?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-tight)]">
      <span className={cn(dsText.meta, "min-w-0 truncate text-[color:var(--ds-fg-muted)]")}>{label}</span>
      <span
        className={cn(
          dsText.body,
          dsText.nums,
          "min-w-0 break-words",
          tone === "danger"
            ? "text-[color:var(--ds-danger)]"
            : tone === "warning"
              ? "text-[color:var(--ds-status-waiting-fg)]"
              : "text-[color:var(--ds-fg)]",
        )}
      >
        {value}
        {meta !== undefined && (
          <span className={cn(dsText.meta, "ml-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]")}>{meta}</span>
        )}
      </span>
    </div>
  );
}

function TrustSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>{label}</SectionLabel>
      <div className="flex flex-col gap-[var(--ds-space-tight)]">{children}</div>
    </section>
  );
}

function fmtAge(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return `${String(totalMinutes)}m`;
  return `${String(Math.floor(totalMinutes / 60))}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

/* ── the failure record body (ref operator-trust §2.1, D142) ─────────────────────────── */

const WRITE_STATE_SENTENCE: Record<FailureDetailWire["writeState"], string> = {
  "not-attempted": "This run wrote nothing — no write was attempted.",
  prepared: "A write was staged but never committed.",
  attempting: "A write attempt was in flight; this run did not settle its outcome.",
  committed: "A write was committed; its read-back verification did not complete.",
  verified: "A write was committed and verified.",
  unknown: "The write outcome is unknown — the intent is parked for operator resolution.",
};

export function FailureDetailBody({ detail }: { detail: FailureDetailWire }) {
  const subject = detail.subject;
  const remediationLabel: Record<FailureDetailWire["remediation"][number]["kind"], string> = {
    "retry-when-served": "Retry",
    "operator-action": "Operator",
    configuration: "Configuration",
    "code-change": "Code change",
    "no-safe-action": "No safe action",
  };
  return (
    <div className="flex flex-col gap-[var(--ds-space-base)]">
      <span className={cn(dsText.body, "break-words text-[color:var(--ds-danger)]")}>{detail.summary}</span>
      {/* Unconditional and never behind a disclosure (ref dashboard-surfaces D18). */}
      <span className={cn(dsText.body, "font-semibold text-[color:var(--ds-fg)]")}>
        {WRITE_STATE_SENTENCE[detail.writeState]}
      </span>
      <MetaLine
        items={[
          detail.code,
          detail.transient && "transient",
          detail.taskId !== undefined && `task ${detail.taskId}`,
          detail.nodeId !== undefined && `node ${detail.nodeId}`,
          detail.sameFingerprintSeen > 1 && `same failure seen ${String(detail.sameFingerprintSeen)} times`,
        ]}
      />

      {subject.state === "present" && (
        <MetaLine
          items={[
            subject.expected !== undefined
              && `expected ${subject.expected.kind} ${subject.expected.displayRedacted ?? subject.expected.digest}`,
            subject.observed !== undefined
              && `observed ${subject.observed.kind} ${subject.observed.displayRedacted ?? subject.observed.digest}`,
          ]}
        />
      )}
      {(detail.page !== undefined || detail.action !== undefined) && (
        <MetaLine
          items={[
            detail.page?.screen !== undefined && `screen ${detail.page.screen}`,
            detail.page?.state !== undefined && `page state ${detail.page.state}`,
            detail.action?.operation !== undefined && `during ${detail.action.operation}`,
            detail.action?.sequence !== undefined && `step ${String(detail.action.sequence)}`,
          ]}
        />
      )}

      <TrustSection label="What to do">
        {detail.remediation.map((action, index) => (
          <span key={index} className="flex items-baseline gap-[var(--ds-space-snug)]">
            <Chip label="remediation" tone={action.kind === "no-safe-action" ? "danger" : "neutral"}>
              {remediationLabel[action.kind]}
            </Chip>
            <span className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-fg)]")}>{action.message}</span>
          </span>
        ))}
      </TrustSection>

      <TrustSection label="Cause chain">
        {detail.causeChain.map((cause, index) => (
          <FactRow
            key={index}
            label={cause.role === "primary" ? `primary — ${cause.code}` : `secondary — ${cause.code}`}
            value={cause.summary}
            tone={cause.role === "primary" ? "danger" : undefined}
            meta={cause.transient ? "transient" : undefined}
          />
        ))}
        <MetaLine
          items={[
            `fingerprint ${detail.fingerprint.slice(0, 12)}…`,
            detail.diagnosticBundle.state === "present"
              ? `diagnostic bundle ${detail.diagnosticBundle.bundleId}`
              : `no diagnostic bundle — ${detail.diagnosticBundle.reason}`,
          ]}
        />
      </TrustSection>
    </div>
  );
}

/* ── the receipt body (ref operator-trust §2.3, D140/D141) ───────────────────────────── */

function FactsSection({ label, facts }: { label: string; facts: RunEvidenceReceiptWire["input"] }) {
  if (facts.length === 0) return null;
  return (
    <TrustSection label={label}>
      {facts.map((fact) => (
        fact.state === "satisfied"
          ? (
            <FactRow
              key={fact.id}
              label={fact.field}
              value={redactedText(fact.value)}
              meta={fact.source.kind}
            />
          )
          : (
            <FactRow
              key={fact.id}
              label={fact.field}
              value={`unresolved — ${fact.reason}`}
              tone={fact.mandatory ? "danger" : "warning"}
              meta={fact.mandatory ? "required" : undefined}
            />
          )
      ))}
    </TrustSection>
  );
}

export function ReceiptEvidenceBody({ receipt }: { receipt: RunEvidenceReceiptWire }) {
  return (
    <div className="flex flex-col gap-[var(--ds-space-loose)]">
      <FactsSection label="Input" facts={receipt.input} />
      <FactsSection label="Observations" facts={receipt.observations} />

      {receipt.decisions.length > 0 && (
        <TrustSection label="Decisions">
          {receipt.decisions.map((decision) => (
            <FactRow
              key={decision.id}
              label={`${decision.kind} — ${decision.outcome}`}
              value={decision.reason}
              tone={decision.outcome === "blocked" || decision.outcome === "rejected" ? "warning" : undefined}
            />
          ))}
        </TrustSection>
      )}

      {receipt.actions.length > 0 && (
        <TrustSection label="Actions">
          {receipt.actions.map((action) => (
            <FactRow
              key={action.id}
              label={action.taskId}
              value={`${action.kind} — ${WRITE_STATE_SENTENCE[action.writeState]}`}
              meta={fmtClock(action.occurredAt)}
            />
          ))}
        </TrustSection>
      )}

      {receipt.verification.length > 0 && (
        <TrustSection label="Verification">
          {receipt.verification.map((entry) => (
            <FactRow
              key={entry.id}
              label={entry.obligation}
              value={entry.verdict}
              tone={entry.verdict === "verified" || entry.verdict === "present"
                ? undefined
                : entry.mandatory ? "danger" : "warning"}
              meta={entry.mandatory ? "required" : undefined}
            />
          ))}
        </TrustSection>
      )}

      <FactsSection label="Output" facts={receipt.output} />

      {receipt.reuse.length > 0 && (
        <TrustSection label="Reused evidence">
          {receipt.reuse.map((entry) => (
            <FactRow
              key={entry.id}
              label={entry.kind}
              value={`${fmtAge(entry.ageMs)} old`}
              meta={`limit ${fmtAge(entry.freshnessLimitMs)}`}
            />
          ))}
        </TrustSection>
      )}

      {receipt.warnings.length > 0 && (
        <TrustSection label="Warnings">
          {receipt.warnings.map((warning) => (
            <FactRow
              key={warning.id}
              label={warning.code}
              value={warning.summary}
              tone={warning.loadBearing ? "danger" : "warning"}
              meta={warning.loadBearing ? "load-bearing" : undefined}
            />
          ))}
        </TrustSection>
      )}

      <MetaLine
        items={[
          `confidence ${receipt.confidence}`,
          `result ${receipt.result}`,
          `attempt ${String(receipt.attempt)}`,
          receipt.retryOf.state === "present" && `retry of ${receipt.retryOf.value}`,
          `generated ${fmtClock(receipt.generatedAt)}`,
        ]}
      />
    </div>
  );
}
