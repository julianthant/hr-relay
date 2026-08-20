/**
 * The failure advisory panel (ref operator-trust §4.4, D178).
 *
 * It sits INSIDE the failure record, below the record's own remediation
 * ladder, because that ordering is the claim: the record is the evidence and
 * the advisory is a reading of it. Three rules follow, and each is visible on
 * screen rather than only in this comment:
 *
 * 1. **Nothing happens until the operator asks.** The advisory spends a
 *    provider budget, so it is behind a button — never fetched when the panel
 *    opens. Until it is asked, the panel says what asking would do.
 * 2. **The uncertainty framing is not decoration.** Every produced advisory
 *    renders its provider, model, template version and the model's own
 *    confidence, plus the standing sentence that it is advisory and changes
 *    nothing. §4.4 forbids an advisory from setting retryability or issuing a
 *    command, and there is deliberately no affordance here that could.
 * 3. **An absence renders its REASON.** `unavailable` and `invalid-response`
 *    are answers, not blanks: they render as a `Refusal` carrying the closed
 *    code, so "the model was throttled" never reads as "there is nothing to
 *    say". A process with no provider composed disables the button and shows
 *    the server's own reason — the house rule the instance selector set.
 *
 * The composition is the established one for this surface: `SectionLabel` +
 * `MetaLine` + `Chip` from the design system, the failure record's own
 * geometry, and no new visual language.
 */
import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import { Button, MetaLine, Refusal, SectionLabel, Spinner, dsIcon, dsText } from "../ds/ui.js";
import type { CapabilityAvailabilitySchema } from "../../domain/absence.js";
import type { RunAdvisoryWireSchema } from "../../domain/dashboard/advisory.js";
import { useDashboardClient } from "../state/client-context.js";
import { DashboardClientError } from "../client/index.js";

export type RunAdvisoryWire = z.infer<typeof RunAdvisoryWireSchema>;
type CapabilityAvailability = z.infer<typeof CapabilityAvailabilitySchema>;

type PanelState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "asking" }>
  | Readonly<{ kind: "answered"; advisory: RunAdvisoryWire }>
  | Readonly<{ kind: "faulted"; message: string }>;

/** The standing sentence. It renders on every produced advisory, unconditionally. */
const ADVISORY_DISCLAIMER
  = "Advisory only — generated from the redacted facts above. It is not evidence, "
  + "it cannot retry, resolve or change this run, and the record beside it is what happened.";

export function FailureAdvisoryPanel({ runId, availability }: {
  runId: string;
  availability: CapabilityAvailability;
}) {
  const client = useDashboardClient();
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const composed = availability.state === "available";

  const ask = (): void => {
    setState({ kind: "asking" });
    client.requestFailureAdvisory(runId).then(
      (advisory: RunAdvisoryWire) => {
        setState({ kind: "answered", advisory });
      },
      (error: unknown) => {
        setState({
          kind: "faulted",
          message: error instanceof DashboardClientError || error instanceof Error
            ? error.message
            : "the advisory request failed",
        });
      },
    );
  };

  return (
    <div className="flex flex-col gap-[var(--ds-space-snug)]" data-panel-failure-advisory="">
      <SectionLabel>AI advisory</SectionLabel>
      <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
        <Button
          variant="secondary"
          size="sm"
          disabled={!composed || state.kind === "asking"}
          onClick={ask}
        >
          {state.kind === "asking"
            ? <Spinner aria-hidden />
            : <Sparkles aria-hidden className={dsIcon.sm} />}
          {state.kind === "answered" ? "Ask again" : "Explain this failure"}
        </Button>
        <span className={cn(dsText.meta, "min-w-0 text-[color:var(--ds-fg-muted)]")}>
          {composed
            ? "Sends the redacted facts above to a model. Nothing is written."
            : availability.reason}
        </span>
      </div>

      {state.kind === "faulted" && (
        <Refusal title="The advisory request did not complete" code="ADVISORY_REQUEST_FAILED">
          {state.message}
        </Refusal>
      )}
      {state.kind === "answered" && <AdvisoryOutcomeBody advisory={state.advisory} />}
    </div>
  );
}

function AdvisoryOutcomeBody({ advisory }: { advisory: RunAdvisoryWire }) {
  const { outcome } = advisory;
  const invocation = outcome.invocation;
  const provenance = (
    <MetaLine
      items={[
        invocation.provider !== undefined && invocation.model !== undefined
          && `${invocation.provider} ${invocation.model}`,
        `prompt v${String(invocation.promptTemplateVersion)}`,
        `input ${invocation.redactedInputDigest.slice(0, 12)}`,
        `schema ${invocation.resultSchemaFingerprint.slice(0, 12)}`,
        invocation.endedAt,
      ]}
    />
  );

  if (outcome.outcome === "unavailable") {
    return (
      <div className="flex flex-col gap-[var(--ds-space-snug)]">
        <Refusal title="No advisory was produced" code={outcome.code.toUpperCase().replaceAll("-", "_")}>
          {outcome.reason}
          {outcome.retryAt !== undefined && ` You can ask again after ${outcome.retryAt}.`}
        </Refusal>
        {provenance}
      </div>
    );
  }
  if (outcome.outcome === "invalid-response") {
    return (
      <div className="flex flex-col gap-[var(--ds-space-snug)]">
        <Refusal title="The model's answer was refused" code="ADVISORY_INVALID_RESPONSE">
          {outcome.reason}
        </Refusal>
        {provenance}
      </div>
    );
  }

  const advice = outcome.advice;
  return (
    <div className="flex flex-col gap-[var(--ds-space-snug)]">
      <span className={cn(dsText.body, "font-semibold text-[color:var(--ds-fg)]")}>{advice.headline}</span>
      <span className={cn(dsText.body, "break-words text-[color:var(--ds-fg)]")}>{advice.explanation}</span>
      <ul className="flex flex-col gap-[var(--ds-space-tight)]">
        {advice.checks.map((check, index) => (
          <li key={index} className={cn(dsText.body, "break-words text-[color:var(--ds-fg)]")}>
            <span className="font-medium">{check.what}</span>
            <span className="text-[color:var(--ds-fg-muted)]"> — {check.why}</span>
          </li>
        ))}
      </ul>
      <MetaLine items={[`model confidence ${advice.confidence}`]} />
      <span className={cn(dsText.meta, "break-words text-[color:var(--ds-fg-muted)]")}>
        {ADVISORY_DISCLAIMER}
      </span>
      {provenance}
    </div>
  );
}
