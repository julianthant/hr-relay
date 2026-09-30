import { OperationEvidenceFrame } from "../operation-evidence-frame.js";
import { TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import type { z } from "zod";
import { cn } from "../../lib/utils.js";
import {
  FailureDetailBody,
  FailureRecordHead,
} from "../trust.js";
import { FailureAdvisoryPanel } from "../advisory.js";
import { fmtClock, fmtActionClock } from "../format.js";
import { dsFocus, dsIcon, dsText, MetaLine, SectionLabel } from "../../ds/ui.js";
import type { RunDetailSectionResponseSchema, NotePageSchema } from "../../../domain/dashboard/run-detail.js";
import type { CapabilityAvailabilitySchema } from "../../../domain/absence.js";
import type { LiveFailureContext } from "../trust-model.js";
import { projectFailureDisplay } from "../../../domain/dashboard/failure-display.js";
import { FAILURE_OUTCOME, failureNextSteps } from "../failure-outcome-model.js";
import { exactBundleCaptures, type RunCaptureItem } from "../run-captures-model.js";
import { OperationCapture } from "../run-captures.js";
import { ReceiptView } from "../receipt.js";

type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
type NotePage = z.infer<typeof NotePageSchema>;
export type FailurePayload = Extract<RunDetailSectionResponse, { section: "failure" }>['payload'];
type CapabilityAvailability = z.infer<typeof CapabilityAvailabilitySchema>;

export function ReceiptTab(props: ComponentProps<typeof ReceiptView>) {
  return <ReceiptView {...props} />;
}

/** F2 keeps write outcome and recovery visible; full recorded diagnostics remain in Details. */
export function InlineFailureRecord({
  failure,
  errorNotes,
  completedAt,
  anchorRef,
  runId,
  aiAdvisory,
  liveContext,
  captures,
}: {
  captures?: readonly RunCaptureItem[];
  liveContext?: LiveFailureContext;
  failure: FailurePayload;
  errorNotes: readonly NotePage["notes"][number][];
  completedAt?: string;
  anchorRef?: (node: HTMLElement | null) => void;
  runId: string;
  /** Ref operator-trust §4.4's advisory availability, off the bootstrap wire (D178). */
  aiAdvisory: CapabilityAvailability;
}) {
  const detail = failure.state === "available" ? failure.value : undefined;
  const display = detail === undefined ? undefined : detail.display ?? projectFailureDisplay(detail);
  const outcome = detail === undefined ? undefined : FAILURE_OUTCOME[detail.writeState];
  const relatedCaptures = detail?.diagnosticBundle.state === "present"
    ? exactBundleCaptures(captures ?? [], detail.diagnosticBundle.bundleId) : [];
  return (
    <OperationEvidenceFrame ref={anchorRef} tabIndex={-1} data-panel-failure-record=""
      role="group" aria-label={`Failure record — ${display?.title ?? "Failure details unavailable"}`}
      className={cn("mx-[var(--ds-space-cozy)] my-[var(--ds-space-base)] operation-outcome-frame", dsFocus)}
      heading={<div className="operation-decision-heading">
        <TriangleAlert aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-danger)]")} />
        <span className={cn(dsText.ui, "operation-decision-label font-semibold")}>{display?.title ?? "Failure details unavailable"}</span>
        {(detail?.occurredAt ?? completedAt) !== undefined && <time className={cn(dsText.meta, dsText.nums)}>{fmtActionClock((detail?.occurredAt ?? completedAt)!)}</time>}
      </div>}
    >
      <div className="operation-outcome-grid">
        <section aria-label="What this run left behind" className="operation-outcome-evidence">
          <span className={dsText.meta}>Write outcome</span>
          <p className="operation-outcome-result" data-outcome-tone={outcome?.tone ?? "warning"}>{outcome?.label ?? "Write state unavailable"}</p>
          <dl className="operation-outcome-facts">
            <div><dt>Observed</dt><dd>{display?.observation ?? "The failure record could not be read."}</dd></div>
            {detail?.action?.operation !== undefined && <div><dt>Action</dt><dd>{detail.action.operation}</dd></div>}
            {detail?.page?.titleRedacted !== undefined && <div><dt>Page</dt><dd>{detail.page.titleRedacted}</dd></div>}
            {detail?.subject.state === "present" && <>
              {detail.subject.expected !== undefined && <div><dt>Expected identity</dt><dd>{detail.subject.expected.displayRedacted ?? "Protected identity"}</dd></div>}
              {detail.subject.observed !== undefined && <div><dt>Observed identity</dt><dd className="text-[color:var(--ds-danger)]">{detail.subject.observed.displayRedacted ?? "Protected identity"}</dd></div>}
            </>}
          </dl>
          {relatedCaptures.map(({ item, capturedAt }) => <div className="operation-outcome-capture" key={item.capture.artifact.artifactId}>
            <OperationCapture item={item} capturedAt={capturedAt} />
          </div>)}
        </section>
        <section aria-label="What is safe to retry" className="operation-outcome-recovery">
          <span className={dsText.meta}>Next step</span>
          {detail === undefined ? <p>Refresh the run details before choosing a recovery action.</p> : failureNextSteps(detail).map(message => <p key={message}>{message}</p>)}
          {outcome?.caution !== undefined && <p className="operation-outcome-caution">{outcome.caution}</p>}
        </section>
      </div>
      <details className="operation-evidence-disclosure operation-outcome-details">
        <summary>Details</summary>
        <div className="operation-secondary-tools">
          {detail !== undefined ? <>
            <FailureRecordHead detail={detail} />
            <MetaLine items={[completedAt !== undefined && `failed ${fmtClock(completedAt)}`, `attempt ${String(detail.attempt)}`, detail.taskId]} />
            <FailureDetailBody detail={detail} liveContext={liveContext} />
            <FailureAdvisoryPanel runId={runId} availability={aiAdvisory} />
          </> : failure.state === "error" ? <MetaLine items={[failure.code, failure.message]} /> : failure.state !== "available" ? <MetaLine items={[failure.reason]} /> : null}
          {errorNotes.length > 0 && <section className="flex flex-col gap-[var(--ds-space-snug)]">
            <SectionLabel>Recorded errors</SectionLabel>
            {errorNotes.map(note => <p key={note.noteId} className={cn(dsText.body, "break-words")}><time className={dsText.meta}>{fmtClock(note.at)} </time>{note.message}</p>)}
          </section>}
        </div>
      </details>
    </OperationEvidenceFrame>
  );
}

// ---------------------------------------------------------------------------
// the stream
// ---------------------------------------------------------------------------
