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
 *   → decisions → actions → verification → output → reuse → warnings, and it
 *   ends on the fingerprint footer the run itself ran under (D199);
 * - a fact names its SOURCE in full — the task and the instant it was observed
 *   at, or the hash of the input it came from — never the source's tag alone;
 * - empty sections are omitted (D24 restraint) — a receipt does not explain
 *   itself, and "no warnings" is best said by no warnings section.
 */
import { Check, CircleAlert, Download, Fingerprint, Package, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import {
  Badge,
  Chip,
  Banner,
  Button,
  ButtonLink,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  IconButton,
  MetaLine,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SectionLabel,
  dsIcon,
  dsText,
} from "../ds/ui.js";
import type { FailureDetailWireSchema } from "../../domain/dashboard/run-detail.js";
import type { RunEvidenceReceiptSchema } from "../../domain/trust/evidence.js";
import { fmtClock, shortHash } from "./format.js";
import {
  acceptDiagnosticBundleReadback,
  evidenceSourceMeta,
  inputHashFooter,
  uncertaintySentence,
  verificationMark,
  writeActionBadgeTone,
} from "./trust-model.js";
import { useDashboardClient } from "../state/client-context.js";
import { DashboardClientError } from "../client/index.js";
import type { DiagnosticBundleWire } from "../../domain/dashboard/diagnostic-bundle.js";

export type RunEvidenceReceiptWire = z.infer<typeof RunEvidenceReceiptSchema>;
export type FailureDetailWire = z.infer<typeof FailureDetailWireSchema>;
type EvidenceFactWire = RunEvidenceReceiptWire["input"][number];
type VerificationVerdictWire = RunEvidenceReceiptWire["verification"][number]["verdict"];
type FactValue = Extract<EvidenceFactWire, { state: "satisfied" }>["value"];

type BundleDialogState =
  | Readonly<{ state: "closed" }>
  | Readonly<{ state: "loading"; bundleId: string }>
  | Readonly<{ state: "ready"; bundle: DiagnosticBundleWire }>
  | Readonly<{ state: "error"; bundleId: string; message: string }>;

/* ── shared little pieces ────────────────────────────────────────────────── */

function redactedText(value: FactValue): string {
  if (value.state === "redacted") return `redacted — ${value.classification}`;
  if (value.transform === "count") return `${String(value.value)} (count)`;
  return typeof value.value === "string" ? value.value : JSON.stringify(value.value);
}

/**
 * `mark` and `badge` are the demo's two ways of putting a cue AHEAD of a fact
 * so the eye catches it before it reads (ledger 2 D17/D24/D29); `note` is its
 * way of putting a full sentence UNDER one, where it can wrap. All three are
 * optional and additive — a row that passes none renders exactly as before.
 */
function FactRow({ label, value, tone, meta, mark, badge, note }: {
  label: string;
  value: string;
  tone?: "danger" | "warning";
  meta?: string;
  mark?: ReactNode;
  badge?: ReactNode;
  note?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-tight)]">
      <span className={cn(dsText.meta, "min-w-0 truncate text-[color:var(--ds-fg-muted)]")}>{label}</span>
      <span className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
        <span className="flex min-w-0 items-baseline gap-[var(--ds-space-snug)]">
          {mark}
          {badge}
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
        </span>
        {note !== undefined && (
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{note}</span>
        )}
      </span>
    </div>
  );
}

/**
 * D24's criterion glyph — the demo's `Check` / `X` / `CircleAlert` over the
 * served verdict, in the demo's three tones. `aria-hidden`: the verdict WORD
 * renders beside it, so this is a second channel for the sighted read and
 * never the only one.
 */
function VerificationMarkGlyph({ verdict }: { verdict: VerificationVerdictWire }) {
  const mark = verificationMark(verdict);
  const Glyph = mark === "met" ? Check : mark === "unmet" ? X : CircleAlert;
  return (
    <Glyph
      aria-hidden
      className={cn(
        dsIcon.md,
        // F8d finding 4 — `self-center` centred the glyph against the WHOLE
        // row, including a value that wraps to several lines, so a long
        // wrapped value dragged the ✓/✕/ⓘ down to the row's vertical middle
        // instead of sitting beside the fact it marks. `self-start` (+ `mt-px`
        // to land on the first line's cap-height, same offset as the
        // diagnostic bundle's own icon-to-text alignment above) pins it to
        // the FIRST line, which is the only line the mark is actually about.
        "mt-px shrink-0 self-start",
        mark === "met"
          ? "text-[color:var(--ds-success-fg)]"
          : mark === "unmet"
            ? "text-[color:var(--ds-danger)]"
            : "text-[color:var(--ds-status-waiting-fg)]",
      )}
    />
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
  const client = useDashboardClient();
  const [bundleDialog, setBundleDialog] = useState<BundleDialogState>({ state: "closed" });
  const bundleTriggerRef = useRef<HTMLButtonElement>(null);
  const bundleRequestRevision = useRef(0);
  const openBundle = (): void => {
    if (detail.diagnosticBundle.state !== "present") return;
    const bundleId = detail.diagnosticBundle.bundleId;
    const requestRevision = ++bundleRequestRevision.current;
    setBundleDialog({ state: "loading", bundleId });
    client.diagnosticBundle(bundleId).then(
      (bundle) => {
        if (bundleRequestRevision.current === requestRevision) {
          const acceptance = acceptDiagnosticBundleReadback(bundleId, bundle);
          setBundleDialog(acceptance.state === "ready"
            ? acceptance
            : {
                state: "error",
                bundleId: acceptance.bundleId,
                message: acceptance.message,
              });
        }
      },
      (error: unknown) => {
        if (bundleRequestRevision.current === requestRevision) {
          setBundleDialog({
            state: "error",
            bundleId,
            message: error instanceof DashboardClientError || error instanceof Error
              ? error.message
              : "the diagnostic bundle readback failed",
          });
        }
      },
    );
  };
  const closeBundle = (): void => {
    bundleRequestRevision.current += 1;
    setBundleDialog({ state: "closed" });
    requestAnimationFrame(() => bundleTriggerRef.current?.focus());
  };
  return (
    <div className="flex flex-col gap-[var(--ds-space-base)]">
      <span className={cn(dsText.body, "break-words text-[color:var(--ds-danger)]")}>{detail.summary}</span>
      {/* Unconditional and never behind a disclosure (ref dashboard-surfaces D18). */}
      <span className={cn(dsText.body, "font-semibold text-[color:var(--ds-fg)]")}>
        {WRITE_STATE_SENTENCE[detail.writeState]}
      </span>
      {/*
        The demo's `Classification` KeyValueList, in this tree's MetaLine idiom
        and in the demo's order (legacy hr-automation@c9e6aaf3aa8978a776f72205b71a96a988773b43,
        DemoFailure.tsx:313-338): code · occurred · run · node · task.

        `occurred` and `run`/`attempt` are the failure record's OWN facts and
        were drawn nowhere. The instant matters most: the panel prints the
        RUN's terminal instant above this body, which is a different moment —
        a run can fail on one node and terminalize after the executor has
        finished unwinding, so "failed 2:41 PM" and "occurred 2:39 PM" are
        both true and only one of them says when the thing went wrong.
      */}
      <MetaLine
        items={[
          detail.code,
          detail.transient && "transient",
          `occurred ${fmtClock(detail.occurredAt)}`,
          `run ${detail.traceId}`,
          `attempt ${String(detail.attempt)}`,
          detail.nodeId !== undefined && `node ${detail.nodeId}`,
          detail.taskId !== undefined && `task ${detail.taskId}`,
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
            // Both halves of the served `page` block. The parenthetical is the
            // demo's own word (DemoFailure.tsx:328) and it is load-bearing:
            // these two strings were redacted AT CAPTURE, so what prints is
            // the whole of what the record holds, not a render-time cut.
            //
            // ORDER (B fix): the demo's Classification list has no title row
            // at all — only `URL (redacted)` (DemoFailure.tsx:328) — so url
            // leads and title trails it here, kept because this wire genuinely
            // serves `page.titleRedacted` and dropping a served fact is its
            // own defect.
            detail.page?.urlRedacted !== undefined && `url (redacted) ${detail.page.urlRedacted}`,
            detail.page?.titleRedacted !== undefined && `title (redacted) ${detail.page.titleRedacted}`,
            detail.action?.operation !== undefined && `during ${detail.action.operation}`,
            // `on {elementId}` — the demo's `Failed action: {operation} on
            // {elementId} · step {N}` (:329-338). No `"action"` stand-in for an
            // absent operation: an unserved half drops out of the line rather
            // than being spoken for.
            detail.action?.elementId !== undefined && `on ${detail.action.elementId}`,
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
        <MetaLine items={[`fingerprint ${detail.fingerprint.slice(0, 12)}…`]} />
        {detail.diagnosticBundle.state === "present" ? (
          <Button
            ref={bundleTriggerRef}
            variant="secondary"
            icon={<Package aria-hidden className={dsIcon.md} />}
            className="min-h-11 self-start"
            onClick={openBundle}
          >
            Diagnostic bundle {detail.diagnosticBundle.bundleId}
          </Button>
        ) : (
          <MetaLine items={[`no diagnostic bundle — ${detail.diagnosticBundle.reason}`]} />
        )}
      </TrustSection>
      {bundleDialog.state !== "closed" && (
        <DiagnosticBundleDialog
          state={bundleDialog}
          manifestUrl={bundleDialog.state === "ready"
            ? client.diagnosticBundleManifestUrl(bundleDialog.bundle.bundleId)
            : undefined}
          onClose={closeBundle}
        />
      )}
    </div>
  );
}

function byteSizeLabel(byteSize: number): string {
  if (byteSize < 1024) return `${String(byteSize)} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function redactionList(bundle: DiagnosticBundleWire): string {
  const facts = bundle.redaction.fields.map((field) => `${field.key} · ${field.classification} · ${field.transform}`);
  const warnings = bundle.redaction.warnings.map((warning) => `warning: ${warning}`);
  const list = [...facts, ...warnings];
  return list.length === 0 ? "No classified fields required a redaction transform" : list.join(" · ");
}

function DiagnosticBundleDialog({
  state,
  manifestUrl,
  onClose,
}: {
  state: Exclude<BundleDialogState, { state: "closed" }>;
  manifestUrl?: string;
  onClose: () => void;
}) {
  const bundleId = state.state === "ready" ? state.bundle.bundleId : state.bundleId;
  const description = state.state === "ready"
    ? `Captured ${fmtClock(state.bundle.capturedAt)} · ${byteSizeLabel(state.bundle.byteSize)} · content-addressed, redacted at capture time`
    : "Reading the durable diagnostic bundle before it is shown.";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" hideClose title={`Diagnostic bundle ${bundleId}`} description={description}>
        <DialogBody className="flex flex-col gap-[var(--ds-space-cozy)]">
          {state.state === "loading" && (
            <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
              Verifying the stored bundle, its attachment index and every content-addressed artifact.
            </p>
          )}
          {state.state === "error" && (
            <Banner tone="danger" title="Diagnostic bundle readback failed">
              {state.message}
            </Banner>
          )}
          {state.state === "ready" && (
            <>
              <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
                One bounded package, taken automatically the moment this failed. It is what <code>explain run --bundle</code> writes,
                and it is what a bug report should carry instead of a pasted screenshot.
              </p>
              <div className="flex flex-col gap-[var(--ds-space-snug)]">
                {state.bundle.contents.map((content) => (
                  <div
                    key={content.artifactId}
                    className={cn(
                      "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)]",
                      "sm:grid-cols-[auto_minmax(0,16rem)_minmax(0,1fr)] sm:items-baseline",
                    )}
                  >
                    <Check aria-hidden className={cn(dsIcon.sm, "mt-px shrink-0 text-[color:var(--ds-success-fg)]")} />
                    <span className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-fg)]")}>
                      {content.key}
                    </span>
                    <span className={cn(dsText.meta, "col-start-2 min-w-0 break-words text-[color:var(--ds-fg-muted)] sm:col-start-3")}>
                      {content.detail} · {content.digest}
                    </span>
                  </div>
                ))}
              </div>
              <Banner tone="info" title="Redacted at capture, never at render">
                {redactionList(state.bundle)} — removed when the bundle was written, so there is no copy to leak later.
              </Banner>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" className="min-h-11" onClick={onClose}>Close</Button>
          {state.state === "ready" && manifestUrl !== undefined && (
            <ButtonLink
              variant="primary"
              className="min-h-11"
              icon={<Download aria-hidden className={dsIcon.md} />}
              href={manifestUrl}
              download={`${bundleId}.json`}
            >
              Download the manifest
            </ButtonLink>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── the receipt body (ref operator-trust §2.3, D140/D141) ───────────────────────────── */

function FactsSection({
  label,
  facts,
  footer,
}: {
  label: string;
  facts: RunEvidenceReceiptWire["input"];
  /** A section-wide fact drawn once below every row (the input-hash footer). */
  footer?: ReactNode;
}) {
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
              // An `input` source's `inputFingerprint` is ONE value per RUN,
              // not per field — `inputHashFooter` draws it once for the
              // whole section instead of repeating it on every row (A1+A2).
              meta={fact.source.kind === "input" ? undefined : evidenceSourceMeta(fact.source)}
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
      {footer}
    </TrustSection>
  );
}

/**
 * The input fingerprint is one fact of this run, despite riding each
 * input-sourced entry. Its compact footer keeps the Input section dense; the
 * Popover is the keyboard- and touch-reachable route to all 64 characters,
 * rather than a title-only hover affordance.
 */
function InputHashFooter({ inputHash }: { inputHash: string }) {
  const shortInputHash = shortHash(inputHash);
  return (
    <div className="flex items-center gap-[var(--ds-space-tight)]">
      <MetaLine items={[`input hash ${shortInputHash}`]} />
      <Popover>
        <PopoverTrigger asChild>
          <IconButton
            size="xs"
            label={`Show full input hash ${shortInputHash}`}
            icon={<Fingerprint aria-hidden className={dsIcon.sm} />}
          />
        </PopoverTrigger>
        <PopoverContent title="Input hash" description={shortInputHash} width="lg" side="bottom" align="start">
          <span className={cn(dsText.meta, dsText.nums, "break-all text-[color:var(--ds-fg)]")}>{inputHash}</span>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ReceiptEvidenceBody({
  receipt,
  bandCarriesIdentity = false,
}: {
  receipt: RunEvidenceReceiptWire;
  /**
   * The Receipt TAB draws a verdict band above this body, and that band now
   * carries the receipt's one identity line and its confidence chip (03a
   * fidelity ledger 2 rows D8/D9). Setting this drops those facts from the
   * trailing line so they are said once, not twice.
   *
   * It never drops `result`: the band's verdict word is read from the RUN's
   * terminal outcome, and this is the RECEIPT's own recorded verdict. They are
   * two facts from two records that happen to agree, so the receipt keeps
   * printing its own.
   *
   * The archive mounts this same body with no band and leaves this false.
   */
  bandCarriesIdentity?: boolean;
}) {
  const inputHash = inputHashFooter(receipt.input);
  return (
    <div className="flex flex-col gap-[var(--ds-space-loose)]">
      <FactsSection
        label="Input"
        facts={receipt.input}
        footer={inputHash !== undefined && <InputHashFooter inputHash={inputHash} />}
      />
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
            /* D17 — the write kind is a BADGE, not a word folded into the
               sentence. `commit` is the arm that changed a record of a real
               system and is the only one that reads as news. */
            <FactRow
              key={action.id}
              label={action.taskId}
              badge={<Badge tone={writeActionBadgeTone(action.kind)}>{action.kind}</Badge>}
              value={WRITE_STATE_SENTENCE[action.writeState]}
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
              mark={<VerificationMarkGlyph verdict={entry.verdict} />}
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
            /* D29 — the section whose whole job is saying what is still
               uncertain said it with one word, and said nothing at all when a
               warning was declared harmless. The glyph and both full sentences
               are the demo's (`DemoReceipt.tsx:455-473`). */
            <FactRow
              key={warning.id}
              label={warning.code}
              mark={(
                <CircleAlert
                  aria-hidden
                  className={cn(
                    dsIcon.md,
                    // F8d finding 4 — see `VerificationMarkGlyph`'s comment
                    // above: `self-center` against a wrapped multi-line
                    // `warning.summary` drags the glyph to the row's middle
                    // instead of its first line.
                    "mt-px shrink-0 self-start",
                    warning.loadBearing
                      ? "text-[color:var(--ds-danger)]"
                      : "text-[color:var(--ds-status-waiting-fg)]",
                  )}
                />
              )}
              value={warning.summary}
              tone={warning.loadBearing ? "danger" : "warning"}
              note={uncertaintySentence(warning.loadBearing)}
            />
          ))}
        </TrustSection>
      )}

      <MetaLine
        items={[
          !bandCarriesIdentity && `confidence ${receipt.confidence}`,
          `result ${receipt.result}`,
          !bandCarriesIdentity && `attempt ${String(receipt.attempt)}`,
          !bandCarriesIdentity && receipt.retryOf.state === "present" && `retry of ${receipt.retryOf.value}`,
          !bandCarriesIdentity && `generated ${fmtClock(receipt.generatedAt)}`,
        ]}
      />

      <ReceiptFingerprints receipt={receipt} />
    </div>
  );
}

/**
 * The receipt's fingerprint footer, ported from legacy
 * hr-automation@c9e6aaf3aa8978a776f72205b71a96a988773b43,
 * src/dashboard/components/dev/rebuild-demo/DemoReceipt.tsx:479-484 — same
 * position (last, under a subtle rule), same glyph, same three chips, same
 * labels.
 *
 * All three values are on `RunEvidenceReceiptSchema` and none of them was
 * drawn. `descriptorFingerprint` is the one that most needed to be: D199's
 * whole argument is that a durable record must be stamped with a fact about
 * ITSELF, so this is the shape THIS run ran under — not the shape the process
 * rendering the page was built from. The provenance bar prints two of the
 * three about the LIVE row; the receipt is the artifact read months later.
 *
 * The two fingerprints are cut to `shortHash` — the one place this product
 * decides how long an opaque id renders, so the receipt and the provenance bar
 * cannot show the same fingerprint at two lengths — with the whole value on
 * the chip's `title`. The trace id is a legible identifier and prints whole.
 */
function ReceiptFingerprints({ receipt }: { receipt: RunEvidenceReceiptWire }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-[var(--ds-space-snug)]",
        "border-t border-[color:var(--ds-border-subtle)] pt-[var(--ds-space-base)]",
      )}
    >
      <Fingerprint aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-faint)]")} />
      <Chip label="trace">{receipt.traceId}</Chip>
      <Chip label="descriptor" title={receipt.descriptorFingerprint}>
        {shortHash(receipt.descriptorFingerprint)}
      </Chip>
      <Chip label="config" title={receipt.configFingerprint}>
        {shortHash(receipt.configFingerprint)}
      </Chip>
    </div>
  );
}
