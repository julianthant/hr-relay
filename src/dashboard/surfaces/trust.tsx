/**
 * The trust surfaces (ref operator-trust §2.1–§2.3, D140/D142 — UI half, 2i-A): the full
 * evidence receipt and the full failure record, rendered from the wire
 * content the sections have served since D140/D142.
 *
 * Rendering rules these components pin (ref dashboard-surfaces D18/D24, ref operator-trust D141/D142):
 * - the WRITE-STATE sentence and the remediation ladder render unconditionally,
 *   never behind the `Show the diagnostic record` disclosure — "what this run
 *   left behind" and "what is safe to retry" are the record's first two jobs,
 *   and ONLY diagnosis (classification, cause chain, bundle, the fingerprint's
 *   history) may sit behind one (D273 item 8);
 * - the write-state sentence carries a TONE, and only `not-attempted` gets the
 *   settled one — `trust-model.ts` owns the mapping and says why;
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
import { Check, ChevronDown, CircleAlert, Download, Fingerprint, Package, TriangleAlert, X } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import {
  BareButton,
  Field,
  Textarea,
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
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsText,
} from "../ds/ui.js";
import type { FailureDetailWireSchema } from "../../domain/dashboard/run-detail.js";
import type { RunEvidenceReceiptSchema } from "../../domain/trust/evidence.js";
import { fmtClock, shortHash } from "./format.js";
import {
  acceptFailureResolutionReadback,
  useFailureResolution,
  type LiveFailureContext,
  FAILURE_WRITE_STATE,
  acceptDiagnosticBundleReadback,
  evidenceSourceMeta,
  failureFingerprintHistory,
  failurePermanence,
  inputHashFooter,
  uncertaintySentence,
  verificationMark,
  writeActionBadgeTone,
  writeProofAbsence,
  writeProofConfirmation,
  writeProofReadBack,
  type FailureWriteStateTone,
} from "./trust-model.js";
import { SystemTag } from "./system-chip.js";
import { DiagnosticScreenshotGallery, RestrictedScreenshotWarning } from "./diagnostic-screenshot.js";
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
  if (value.rawValue !== undefined) return typeof value.rawValue === "string" ? value.rawValue : JSON.stringify(value.rawValue);
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

/**
 * THE WRITE-STATE SENTENCE'S COLOUR — two of them, for three ruled arms.
 *
 * D273 item 8 rules the MAPPING, ported from legacy
 * hr-automation@c9e6aaf3aa8978a776f72205b71a96a988773b43, DemoFailure.tsx:156-161
 * (ledger 2 E9): `none` → success, `unknown` → parked, everything else →
 * waiting. Three token families, and the palette paints two colours with them:
 * `--ds-status-parked-fg` and `--ds-status-waiting-fg` are the SAME amber in
 * both themes — in this tree and in the demo it is ported from, where the
 * `parked` family's own violet was re-derived to amber years ago (see the
 * palette note at the top of `ds/tokens.css`).
 *
 * So the fold is deliberate rather than accidental (unit F8c finding 2). The
 * `unknown` arm takes `--ds-status-waiting-fg` outright: naming a second token
 * for the identical colour is the `--log-violet` rot that same note warns
 * about — a name that outlives the colour it was chosen for and then lies to
 * the next reader about what the screen distinguishes.
 *
 * What is NOT done, and why: `unknown` is not given a hue of its own. D232's
 * budget is one accent and FIVE semantic hues, the fifth was bought outright
 * for `dry run`, and no remaining token is honest here — `info` is not a
 * warning, `danger` re-says the failure the whole card already carries, the
 * muted ramp says "less important", and the rehearsal violet means "wrote
 * nothing", which is the exact opposite of an unknown write outcome.
 *
 * Nothing is lost, because the colour was never the carrier: the three arms'
 * SENTENCES differ, and `FAILURE_WRITE_STATE` states each in full — "The write
 * outcome is unknown — the intent is parked for operator resolution." cannot be
 * mistaken for "A write was committed; its read-back verification did not
 * complete." The `FailureWriteStateTone` vocabulary keeps all three arms: it is
 * the ruled mapping, and a palette that later buys `parked` a hue changes one
 * line here rather than re-deriving which arm deserved it.
 *
 * `failure-record-render.test.ts` reads `ds/tokens.css` and fails if any two
 * tones drawn here resolve to one colour in either theme.
 */
const WRITE_STATE_TONE: Record<FailureWriteStateTone, string> = {
  "nothing-written": "text-[color:var(--ds-success-fg)]",
  unknown: "text-[color:var(--ds-status-waiting-fg)]",
  "left-behind": "text-[color:var(--ds-status-waiting-fg)]",
};

/**
 * ONE expression for the write-state block's visible label and its accessible
 * name, so the two cannot drift (the WCAG 2.5.3 rule this bundle ratified at
 * `intake.tsx`'s review checkbox).
 */
const WRITE_STATE_LABEL = "What this run left behind";

/**
 * THE RECORD'S HEAD — the run's own sentence, its code, its identity and its
 * permanence (D273 item 8, ledger 2 E2/E4/E5/E6).
 *
 * It lives HERE, beside the body it heads, because the record has two
 * consumers: the log panel's `InlineFailureRecord` and the archive's own
 * failure card. The head was composed in the panel's JSX at unit F8b and the
 * archive card — which draws the body and nothing above it — silently lost all
 * three facts: an archived failed run printed its write state, its remediation
 * and its diagnosis under a bare `Failure record` label, with the sentence the
 * run wrote about itself nowhere on the surface. Nothing failed, because a card
 * without a head is perfectly grammatical (the 2026-08-26 duplicate lesson,
 * `src/dashboard/CLAUDE.md`: two copies are two things that happen to agree
 * today, and one of them stops).
 *
 * The `available`/unserved fork stays with the log panel: only the live stream
 * can hold a record the projection refused, and "this run failed" is the whole
 * of what is known there.
 */
export function FailureRecordHead({ detail }: { detail: FailureDetailWire }) {
  const permanence = failurePermanence(detail.transient);
  return (
    <div className="flex flex-col gap-[var(--ds-space-tight)]">
      <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
        {/*
          The glyph and the sentence are ONE wrapping item, not two. Loose in
          the row they wrap independently, and in a narrow column — the
          archive's detail rail is ~400px — the triangle took a line of its own
          above the summary, which reads as debris rather than as a mark on the
          sentence. Nesting costs nothing at full width: the pair still shrinks
          (`min-w-0`) so the chips keep their place beside it.
        */}
        <span className="flex min-w-0 items-baseline gap-[var(--ds-space-snug)]">
          <TriangleAlert
            aria-hidden
            className={cn(dsIcon.md, "shrink-0 translate-y-px text-[color:var(--ds-danger)]")}
          />
          <span className={cn(dsText.ui, "min-w-0 break-words font-semibold text-[color:var(--ds-danger)]")}>
            {detail.summary}
          </span>
        </span>
        <Chip label="code" tone="danger">
          {detail.code}
        </Chip>
      </div>
      {/*
        PERMANENCE IS A SENTENCE, so it is not a chip (unit F8c finding 5).
        `Chip`'s own docstring rules it: "if a fact cannot survive truncation it
        is not a chip — put it on the row's `MetaLine`, on its own line, where
        it can wrap." Inside a `w-fit` clipped token this read
        `permanent — the same inp…` and recovered the cut on `title` alone,
        which is a fact reachable by pointer and by nobody else — the same
        defect this directory has now fixed twice (D272 items 8–9, unit F5b).
        It stays in the HEAD, one line below the chips: it is the reading that
        tells the operator not to press retry, and a fact that decides that
        cannot wait for a disclosure.
      */}
      <MetaLine
        items={[
          <span
            key="permanence"
            className={permanence.tone === "warning" ? "text-[color:var(--ds-status-waiting-fg)]" : undefined}
          >
            {permanence.text}
          </span>,
          /*
            The record id joins it, for the reason the permanence sentence is
            here (unit F8c finding 5, landing again). It was a `Chip`, and a
            `Chip` is `w-fit` and clips — so in the archive's ~400px detail rail
            it read `record aa11bb22-0…` with NO `title` at all, which is worse
            than the pointer-only defect this directory has fixed three times:
            the id an operator has to quote in a bug report was reachable by
            nobody. The `code` chip stays; a rejection code survives truncation
            and a uuid does not.
          */
          `record ${detail.failureId}`,
        ]}
      />
    </div>
  );
}

function FailureResolutionControls({ initial, context }: {
  initial: NonNullable<FailureDetailWire["resolution"]>; context?: LiveFailureContext;
}) {
  const client = useDashboardClient();
  const state = useFailureResolution(client, initial, context);
  const resolution = state.current.capture.resolution;
  const editable = context !== undefined && state.current.capability.state === "available";
  return <TrustSection label="Problem follow-up">
    <p className={dsText.body} role="status">{resolution.status === "resolved" ? "Resolved" : "Unresolved"}</p>
    {resolution.status === "resolved" && <>
      <MetaLine items={[`by ${resolution.by}`, `at ${fmtClock(resolution.at)}`]} />
      {resolution.note !== undefined && <p className={cn(dsText.body, "min-w-0 whitespace-pre-wrap break-words")}>{resolution.note}</p>}
    </>}
    {state.readError !== undefined && <Banner tone="danger" title="Resolution could not be refreshed">{state.readError}</Banner>}
    {state.commandError !== undefined && <Banner tone="danger" title="Resolution was not confirmed">{state.commandError}</Banner>}
    {editable && <>
      {resolution.status === "unresolved" && <Field label="Resolution note (optional)" hint={`${String(state.note.length)}/1000`} disabled={state.pending}>
        <Textarea rows={2} maxLength={1000} value={state.note} onChange={event => state.setNote(event.target.value)} />
      </Field>}
      <Button variant="secondary" disabled={state.pending || state.readError !== undefined} onClick={() => { void state.submit(); }}>
        {state.pending ? "Saving…" : resolution.status === "resolved" ? "Reopen" : "Mark resolved"}
      </Button>
    </>}
  </TrustSection>;
}

export function FailureDetailBody({ detail, liveContext }: { detail: FailureDetailWire; liveContext?: LiveFailureContext }) {
  const subject = detail.subject;
  const writeState = FAILURE_WRITE_STATE[detail.writeState];
  const history = failureFingerprintHistory(detail.sameFingerprintSeen);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
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
  const readScreenshotBundle = useCallback((bundleId: string, signal?: AbortSignal) => client.diagnosticBundle(bundleId, signal), [client]);
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
      {/*
        THE SENTENCE (D273 item 8, ledger 2 E8/E9 — DemoFailure.tsx:190-205).
        Unconditional and never behind the disclosure below (ref dashboard-surfaces
        D18): it is the difference between a safe retry and a duplicate
        termination. It gets its own labelled, bordered block rather than a line
        of body copy because a run that wrote half a termination reads exactly
        like one that wrote none until this is read, and one weight for all six
        arms made the six read the same at a glance.

        It is a NAMED `<section>`, exactly like `What is safe to retry` below
        (unit F8c finding 4). It was a bare `<div>` with a caps label inside it,
        which gives a screen reader no landmark and no name for the block this
        surface calls its most important — weaker semantics than its own
        sibling, on the louder of the two facts.
      */}
      <section
        aria-label={WRITE_STATE_LABEL}
        className={cn(
          "border p-[var(--ds-space-base)]",
          dsRadius.md,
          "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]",
        )}
      >
        <SectionLabel>{WRITE_STATE_LABEL}</SectionLabel>
        <p
          className={cn(
            "mt-[var(--ds-space-hair)] leading-relaxed",
            dsText.body,
            WRITE_STATE_TONE[writeState.tone],
          )}
        >
          {writeState.sentence}
        </p>
      </section>

      {/*
        WHAT IS SAFE TO RETRY (E11/E14) — the question the operator arrives
        with, not an instruction list, and unconditional for the same reason:
        "why can I not just retry this" is a question a hidden button never
        answers, so every served remediation renders, including the ones whose
        kind is `no-safe-action`.

        NOT SERVED, and therefore not drawn: the demo's per-remediation SAFETY
        verdict (`safe` / `needs a fix first` / `blocked`) and its label/detail
        pair. `RemediationActionSchema` carries `{kind, message}` — one axis and
        one sentence (`src/domain/trust/failure.ts`) — and the two axes overlap
        only at `no-safe-action` ↔ `blocked`, so deriving one from the other
        would put a safety word on this surface that no producer stands behind.
      */}
      <TrustSection label="What is safe to retry">
        {detail.remediation.map((action, index) => (
          <span key={index} className="flex items-baseline gap-[var(--ds-space-snug)]">
            {/*
              `shrink-0` is load-bearing, and a screenshot is what found it: a
              `Chip` is `w-fit` and clips, so in a flex row beside a sentence
              that wants the width it drew `remediation Operat…` at 1440 and
              recovered the cut on `title` alone — a fact reachable by pointer
              and by nobody else, which DESIGN.md bans outright. The kind is
              five short words from a closed vocabulary; it never needs to give
              width up to the message.
            */}
            <Chip
              label="remediation"
              tone={action.kind === "no-safe-action" ? "danger" : "neutral"}
              className="shrink-0"
            >
              {remediationLabel[action.kind]}
            </Chip>
            <span className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-fg)]")}>{action.message}</span>
          </span>
        ))}
      </TrustSection>

      {detail.resolution !== undefined && <FailureResolutionControls
        key={`${detail.runId}:${detail.failureId}:${liveContext === undefined ? "read-only" : liveContext.actorId}`}
        initial={acceptFailureResolutionReadback(detail.runId, detail.failureId, { section: "failure", payload: { state: "available", value: detail } })} context={liveContext}
      />}

      {/*
        THE DISCLOSURE (E15 — DemoFailure.tsx:266-284). Everything below it
        answers "why", which matters, but not before the operator knows what is
        half-done and what is safe to do next; and always-expanding a 400px
        diagnostic dump into a log stream buries the lines after it, which on a
        failed run is the stream that is the evidence for the summary.

        It is a real `<button>` with `aria-expanded`, not a span with a class —
        a disclosure trigger is a control (the timeline segment's own lesson,
        `src/dashboard/CLAUDE.md` 2026-08-26).
      */}
      <BareButton
        type="button"
        aria-expanded={diagnosticOpen}
        onClick={() => setDiagnosticOpen(!diagnosticOpen)}
        data-panel-failure-toggle=""
        className={cn(
          "inline-flex w-fit shrink-0 items-center gap-[var(--ds-space-tight)] border px-[var(--ds-space-base)]",
          "h-[var(--ds-h-sm)] min-h-11 border-[color:var(--ds-danger-border)]",
          dsRadius.md,
          dsText.meta,
          dsFocus,
          dsMotion.fast,
          "font-semibold text-[color:var(--ds-danger)]",
        )}
      >
        {diagnosticOpen ? "Hide the diagnostic record" : "Show the diagnostic record"}
        <ChevronDown aria-hidden className={cn(dsIcon.sm, dsMotion.fast, diagnosticOpen && "rotate-180")} />
      </BareButton>

      {diagnosticOpen && (
      <div className="flex flex-col gap-[var(--ds-space-base)]">
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

        `code` and `transient` have LEFT this line for the head (E5/E6): the
        demo states both where the summary is, because permanence decides
        whether the operator presses retry at all and a fact behind a
        disclosure cannot decide anything.
      */}
      <MetaLine
        items={[
          `occurred ${fmtClock(detail.occurredAt)}`,
          `run ${detail.traceId}`,
          `attempt ${String(detail.attempt)}`,
          detail.nodeId !== undefined && `node ${detail.nodeId}`,
          detail.taskId !== undefined && `task ${detail.taskId}`,
        ]}
      />

      {subject.state === "present" && (
        <MetaLine
          items={[
            subject.expected !== undefined
              && `expected ${subject.expected.kind} ${subject.expected.displayRedacted ?? subject.expected.digest}`,
            // The OBSERVED row in danger tone (E22 — DemoFailure.tsx:322-325).
            // The pair exists to be compared, and the one that is wrong is the
            // one the eye has to find; same-weight rows made the reader do the
            // diff. Redaction is unchanged: the served `displayRedacted` wins
            // and nothing is re-derived here.
            subject.observed !== undefined && (
              <span className="text-[color:var(--ds-danger)]">
                observed {subject.observed.kind} {subject.observed.displayRedacted ?? subject.observed.digest}
              </span>
            ),
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
      </TrustSection>

      {/*
        The bundle and the fingerprint's history, on one row, at the record's
        foot — the demo's own placement (DemoFailure.tsx:360-376). The absent
        bundle arm keeps its reason: a missing package names why, never a blank.
      */}
      <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
        {detail.diagnosticBundle.state === "present" ? (
          <Button
            ref={bundleTriggerRef}
            variant="secondary"
            icon={<Package aria-hidden className={dsIcon.md} />}
            className="h-auto min-h-11 min-w-0 max-w-full self-start py-[var(--ds-space-tight)]"
            onClick={openBundle}
          >
            <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">
              Diagnostic bundle {detail.diagnosticBundle.bundleId}
            </span>
          </Button>
        ) : (
          <MetaLine items={[`no diagnostic bundle — ${detail.diagnosticBundle.reason}`]} />
        )}
        <span
          className={cn(
            dsText.meta,
            "min-w-0 flex-1 break-words",
            history.tone === "seen-before"
              ? "font-semibold text-[color:var(--ds-status-waiting-fg)]"
              : "text-[color:var(--ds-fg-muted)]",
          )}
        >
          {history.text}
        </span>
      </div>
      </div>
      )}
      {bundleDialog.state !== "closed" && (
        <DiagnosticBundleDialog
          state={bundleDialog}
          manifestUrl={bundleDialog.state === "ready"
            ? client.diagnosticBundleManifestUrl(bundleDialog.bundle.bundleId)
            : undefined}
          attachmentUrl={bundleDialog.state === "ready"
            ? (artifactId) => client.diagnosticBundleAttachmentUrl(bundleDialog.bundle.bundleId, artifactId)
            : undefined}
          readBundle={bundleDialog.state === "ready" ? readScreenshotBundle : undefined}
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
  const facts = bundle.redaction.fields.map((field) => `${field.key}: ${field.rawValue === undefined
    ? field.state === "redacted" ? "unavailable" : typeof field.value === "string" ? field.value : JSON.stringify(field.value)
    : typeof field.rawValue === "string" ? field.rawValue : JSON.stringify(field.rawValue)}`);
  const warnings = bundle.redaction.warnings.map((warning) => `warning: ${warning}`);
  const list = [...facts, ...warnings];
  return list.length === 0 ? "No diagnostic fields recorded" : list.join(" · ");
}

function DiagnosticBundleDialog({
  state,
  manifestUrl,
  attachmentUrl,
  readBundle,
  onClose,
}: {
  state: Exclude<BundleDialogState, { state: "closed" }>;
  manifestUrl?: string;
  attachmentUrl?: (artifactId: string) => string;
  readBundle?: (bundleId: string, signal?: AbortSignal) => Promise<DiagnosticBundleWire>;
  onClose: () => void;
}) {
  const bundleId = state.state === "ready" ? state.bundle.bundleId : state.bundleId;
  if (state.state === "ready" && (attachmentUrl === undefined || readBundle === undefined)) {
    throw new Error(`Diagnostic bundle ${bundleId} requires exact attachmentUrl and readBundle capabilities`);
  }
  const description = state.state === "ready"
    ? `Captured ${fmtClock(state.bundle.capturedAt)} · ${byteSizeLabel(state.bundle.byteSize)} · content-addressed, capture-time redaction recorded`
    : "Reading the durable diagnostic bundle before it is shown.";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" hideClose className="[&_h2]:break-words" title={`Diagnostic bundle ${bundleId}`} description={description}>
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
                      "grid min-w-0 items-baseline gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)]",
                      "grid-cols-[auto_minmax(0,16rem)_minmax(0,1fr)]",
                    )}
                  >
                    <Check aria-hidden className={cn(dsIcon.sm, "mt-px shrink-0 text-[color:var(--ds-success-fg)]")} />
                    <span className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-fg)]")}>
                      {content.key}
                    </span>
                    <span className={cn(dsText.meta, "col-start-3 min-w-0 break-words text-[color:var(--ds-fg-muted)]")}>
                      {content.detail} · {content.digest}
                    </span>
                  </div>
                ))}
              </div>
              {attachmentUrl !== undefined && readBundle !== undefined && (
                <DiagnosticScreenshotGallery bundle={state.bundle} attachmentUrl={attachmentUrl} readBundle={readBundle} />
              )}
              <Banner tone="info" title="Captured diagnostic values">
                {redactionList(state.bundle)}. The dashboard never rewrites stored attachment bytes.
              </Banner>
              {state.bundle.contents.some((content) => content.kind === "screenshot" && content.sensitivity === "restricted") && (
                <RestrictedScreenshotWarning />
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter className="[&>span]:min-w-0 [&>span]:shrink [&>span]:flex-wrap [&>span]:justify-end">
          <Button variant="secondary" className="min-h-11" onClick={onClose}><span data-slot="diagnostic-close-label">Close</span></Button>
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
               system and is the only one that reads as news.

               D16/D18–D21 — a commit row carries what PROVED the write
               beside it (`WriteProofBlock`), and a commit with no proof
               NAMES the absence: a composition-1 receipt predates the
               capture, a composition-2 one holds no settled proof. Silence
               and "not recorded" may never draw the same. */
            <div key={action.id} className="flex flex-col gap-[var(--ds-space-tight)]">
              <FactRow
                label={action.taskId}
                badge={<Badge tone={writeActionBadgeTone(action.kind)}>{action.kind}</Badge>}
                value={FAILURE_WRITE_STATE[action.writeState].sentence}
                meta={fmtClock(action.occurredAt)}
                note={action.kind === "commit" && action.proved === undefined
                  ? writeProofAbsence(receipt.composition)
                  : undefined}
              />
              {action.kind === "commit" && action.proved !== undefined && (
                <WriteProofBlock proved={action.proved} />
              )}
            </div>
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

type ActionWriteProofWire = NonNullable<RunEvidenceReceiptWire["actions"][number]["proved"]>;

/**
 * What proved the write, beside the write it proves (ledger 2 D16–D22; the
 * demo's `WriteAction` Well, `DemoReceipt.tsx:104-180`, drawn over the facts
 * this wire actually serves):
 *
 * - the FENCE line — the system written and the digest of the exact fenced
 *   business key. The digest, because the raw key embeds the person's EID and
 *   stays in authority; it takes the D31 treatment (shortHash, whole value on
 *   the chip's title) so the product shows one id at one length everywhere.
 * - the proof's redacted values — D19's field/value table. The staged form
 *   values themselves are NOT durably recorded (a prepare is
 *   `checkpoint: "in-memory-only"`, D252/ledger 2 D3), so what draws here is
 *   the completion proof: the values the system showed back for this write.
 * - the D20 confirmation verdict and the D21 read-back verdict, as full
 *   sentences from `trust-model.ts`'s total folds — never a bare word, and
 *   never silence.
 */
function WriteProofBlock({ proved }: { proved: ActionWriteProofWire }) {
  const confirmation = writeProofConfirmation(proved.completion, proved.system, proved.proofSource);
  const readBack = writeProofReadBack(proved.completion, proved.proofSource);
  return (
    <div className="flex flex-col gap-[var(--ds-space-tight)] pl-[var(--ds-space-loose)]">
      <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
        <SystemTag system={proved.system} />
        {proved.idempotencyKeyDigest === "withheld-protected-input" ? null : (
          <Chip label="key" title={proved.idempotencyKeyDigest}>{shortHash(proved.idempotencyKeyDigest)}</Chip>
        )}
      </div>
      {proved.values.map((value) => (
        <FactRow key={value.key} label={value.key} value={redactedText(value)} />
      ))}
      <FactRow
        label="confirmation"
        mark={<WriteProofMark met={confirmation.state === "confirmed"} />}
        value={confirmation.sentence}
        meta={confirmation.state === "confirmed" ? fmtClock(proved.recordedAt) : undefined}
      />
      <FactRow
        label="read-back"
        mark={<WriteProofMark met={readBack.state === "read-back"} />}
        value={readBack.sentence}
        meta={readBack.state === "read-back" ? fmtClock(proved.recordedAt) : undefined}
      />
    </div>
  );
}

/**
 * The write-proof verdicts' glyph — ✓ for "this half holds" (a recorded
 * confirmation, a performed read-back), ⓘ for the stated other arm. Neither
 * is a failure tone: every arm here is an honest recorded state, and the
 * SENTENCE is the carrier. Alignment follows `VerificationMarkGlyph`'s F8d
 * lesson — `self-start` + `mt-px`, pinned to the first line the mark is about.
 */
function WriteProofMark({ met }: { met: boolean }) {
  const Glyph = met ? Check : CircleAlert;
  return (
    <Glyph
      aria-hidden
      className={cn(
        dsIcon.md,
        "mt-px shrink-0 self-start",
        met ? "text-[color:var(--ds-success-fg)]" : "text-[color:var(--ds-fg-muted)]",
      )}
    />
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
