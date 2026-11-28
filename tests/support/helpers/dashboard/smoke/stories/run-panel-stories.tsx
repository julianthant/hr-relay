/** Run panel stories: header, timeline, Logs, decision and failure cards, write states, captures, OCR review and the dry-run plan. */
import type { Page } from "@playwright/test";
import { ArrowLeft, Pause, Square } from "lucide-react";
import type { ReactNode } from "react";
import type { z } from "zod";
import { WriteStateSchema } from "../../../../../../src/models/trust/failure.js";
import { projectFailureDisplay } from "../../../../../../src/models/dashboard/failure-display.js";
import type { RunDecisionType } from "../../../../../../src/models/dashboard/run-decision.js";
import { QueueMemberTargetSchema, type QueueStatusSchema } from "../../../../../../src/models/dashboard/projection.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../../../src/models/failures/error-catalog.js";
import { ErrorCodeSchema, IsoInstantSchema, StableRecordIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { Badge, Banner, FailureNotice } from "../../../../../../src/dashboard/ds/ui.js";
import { LogPanel } from "../../../../../../src/dashboard/surfaces/run-detail/log-panel.js";
import { LogActionButton, LogHeaderButton } from "../../../../../../src/dashboard/surfaces/run-detail/logs/log-action-button.js";
import type { LinkedRunEntry } from "../../../../../../src/dashboard/surfaces/run-detail/linked-runs-model.js";
import { OperatorLabelContext } from "../../../../../../src/dashboard/state/operator-label.js";
import { RunStateChips, StartedByLine } from "../../../../../../src/dashboard/surfaces/run-detail/run-state-chips.js";
import { LogFeedPadding, LogSkeleton } from "../../../../../../src/dashboard/surfaces/shared/loading/loading.js";
import { FullDryRunPreview } from "../../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import type { DryRunPreviewStage } from "../../../../../../src/dashboard/surfaces/run-detail/logs/dry-run-preview-model.js";
import type { AnsweredKind, LogDecision } from "../../../../../../src/dashboard/surfaces/run-detail/logs/log-decision-model.js";
import type { LogEntry, LogScreenshot, LogStep } from "../../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { pauseTimeline, type LogTimelineStage } from "../../../../../../src/dashboard/surfaces/run-detail/logs/log-timeline-model.js";
import { RecordReview } from "../../../../../../src/dashboard/surfaces/run-detail/review/review.js";
import type { RecordReviewProps } from "../../../../../../src/dashboard/surfaces/run-detail/review/review-record-model.js";
import { createDashboardClient } from "../../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../../src/dashboard/state/client-context.js";
import { RunReview } from "../../../../../../src/dashboard/surfaces/run-detail/review/review.js";
import { ReviewDialog } from "../../../../../../src/dashboard/surfaces/run-detail/review/review-dialog.js";
import { logTimelineSample, separationLogs } from "../../../../fixtures/dashboard/log-preview/log-fixture.js";
import { ocrReviewPageFixture } from "../../../../fixtures/dashboard/ocr-review.js";
import { RunDetailWireSchema } from "../../../../../../src/models/dashboard/run-detail.js";
import { queueStoryRow } from "../../../../fixtures/dashboard/queue-row-story-surfaces.js";
import {
  REVIEW_CARDS, RUN_DECISIONS, withInlineCaptures, captureImage, captureOf, captureStep, decisionSteps, exampleDecision, exampleScenario,
} from "../../../../fixtures/dashboard/run-panel-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

type QueueStatus = z.infer<typeof QueueStatusSchema>;
type WriteState = z.infer<typeof WriteStateSchema>;
type NoteTone = NonNullable<Extract<LogEntry, { kind: "note" }>["tone"]> | "plain";
type CaptureKind = NonNullable<LogScreenshot["kind"]> | "plain";
type PauseState = "paused" | "pause-pending";
/** The cases `projectFailureDisplay` titles by error code, and every other code. */
type FailureCase = "SUBJECT_MISMATCH" | "EMPLOYMENT_RECORD_MISMATCH" | "PROTECTED_SUBJECT_DISPLAY_REFUSED" | "DOCUMENT_READ_TIMEOUT" | "other";
type CaptureProblem = "load-error" | "dimension-mismatch" | "unavailable";
type LogsResource = "loading" | "refreshing" | "refresh-failed" | "load-failed" | "unavailable" | "empty" | "needs-duo";
type ReviewCase = keyof typeof REVIEW_CARDS;
type DryRunState = DryRunPreviewStage["state"];

const noop = () => undefined;
const READY = "section[aria-label='Selected run logs']";
const DECISION_READY = "[data-decision-state]";

interface PanelProps {
  steps: readonly LogStep[];
  timeline: readonly LogTimelineStage[];
  status?: ReactNode;
  subtitle?: ReactNode;
  operator?: string;
  toolbar?: ReactNode;
  headerActions?: ReactNode;
  linkedRuns?: readonly LinkedRunEntry[];
  navigation?: ReactNode;
  content?: ReactNode;
  trailingContent?: ReactNode;
  initialStepId?: string;
  rerun?: { label: string; run: () => void };
}

/** The Logs column as the dashboard lays it out, beside an empty queue column. */
function PanelStory({ steps, timeline, operator, ...rest }: PanelProps) {
  return <StoryFrame><main className="flex min-h-0 flex-1 flex-col"><div className="dashboard-panel-columns">
    <div className="dashboard-queue-column" />
    <div className="dashboard-log-column">
      {operator === undefined ? <LogPanel title="Alex Morgan" steps={withInlineCaptures(steps)} timeline={timeline} onDecision={noop} onCancelRun={noop} {...rest} />
        : <OperatorLabelContext.Provider value={operator}><LogPanel title="Alex Morgan" steps={withInlineCaptures(steps)} timeline={timeline} onDecision={noop} onCancelRun={noop} {...rest} /></OperatorLabelContext.Provider>}
    </div>
  </div></main></StoryFrame>;
}

const panel = (title: string, props: PanelProps, ready = READY): Story => ({ title, ready, render: () => <PanelStory {...props} /> });

const reading = logTimelineSample("reading");
const readingSteps = separationLogs.slice(0, 6);

/** The state of the run's own decision, in the steps and timeline a log fixture scenario pairs with it. */
const exampleStory = (title: string, id: string): Story => {
  const { steps, timeline } = exampleScenario(id);
  return panel(title, { steps, timeline, initialStepId: steps.at(-1)?.id }, DECISION_READY);
};
const decisionStory = (title: string, value: LogDecision, timeline = logTimelineSample("waiting")): Story =>
  panel(title, { steps: decisionSteps("run-decision-entry", value), timeline, initialStepId: "run-decision" }, DECISION_READY);

const header = (status: QueueStatus, n: number): Story => panel(`Header of a ${status} run`, { steps: readingSteps, timeline: reading,
  status: <RunStateChips row={queueStoryRow(status, 30 + n, status === "cancelled" ? { cancelledBy: "operator" } : {})} /> });
const HEADER = {
  queued: header("queued", 0), running: header("running", 1), cancelling: header("cancelling", 2), blocked: header("blocked", 3),
  "awaiting-approval": header("awaiting-approval", 4), done: header("done", 5), failed: header("failed", 6), cancelled: header("cancelled", 7), partial: header("partial", 8),
} satisfies Record<QueueStatus, Story>;

const headerRun = (title: string, play: (page: Page) => Promise<void>, ready: string): Story => ({
  ...panel(title, { steps: readingSteps, timeline: reading, status: <RunStateChips row={queueStoryRow("done", 40)} />, rerun: { label: "Rerun", run: noop } }), play, ready });
const search = (text?: string) => async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Search logs" }).click();
  if (text !== undefined) await page.getByRole("searchbox", { name: "Search logs" }).fill(text);
};
const LOG_HEADER = {
  default: panel("The run header: status, search and the menu", { steps: readingSteps, timeline: reading, status: <RunStateChips row={queueStoryRow("done", 40)} />, rerun: { label: "Rerun", run: noop } }),
  "search-matches": headerRun("Search with matches", search("employment"), "text=/\\d+ of \\d+/"),
  "search-none": headerRun("Search with no matches", search("badge"), "text=\"No matches\""),
  "search-child": { ...panel("Search on a running dry-run child run", { steps: readingSteps, timeline: reading, status: <RunStateChips row={queueStoryRow("running", 41, { dryRun: true })} />,
    toolbar: <LogActionButton variant="ghost" label="Back to Emergency Contact batch" aria-label="Back to Emergency Contact batch" className="max-w-48" icon={<ArrowLeft aria-hidden className="size-4 shrink-0" />} text={<span className="min-w-0 truncate">Emergency Contact batch</span>} />,
    headerActions: <><LogHeaderButton label="Pause Alex Morgan" icon={<Pause aria-hidden className="size-4" />} onClick={noop} /><LogHeaderButton label="Stop Alex Morgan" icon={<Square aria-hidden className="size-4" />} onClick={noop} /></>,
    linkedRuns: [{ relation: "Parent", name: "Emergency Contact batch", workflow: "Emergency Contact", status: "Running", target: QueueMemberTargetSchema.parse({ section: "logs", runId: "00000000-0000-4000-8000-000000000001", partitionDay: "2026-08-03", workflowId: "emergency-contact", label: "Emergency Contact", panelKind: "run", status: "running" }) }] }),
    play: search("employment"), ready: "text=/\\d+ of \\d+/" },
  "assistant-started": panel("The run header of a run the assistant started", { steps: readingSteps, timeline: reading,
    status: <RunStateChips row={queueStoryRow("done", 42, { startedBy: { kind: "assistant", readOnly: true } })} />,
    subtitle: <StartedByLine surface={{ startedBy: { kind: "assistant", readOnly: true } }} wrap className="mt-0.5" />, rerun: { label: "Rerun", run: noop } }),
  "assistant-started-long": { ...panel("The run header of an assistant-started dry run for an operator with a long name", { steps: readingSteps, timeline: reading,
    status: <RunStateChips row={queueStoryRow("running", 43, { dryRun: true, resolvedInstances: [{ system: "ucpath", instance: "test" }], startedBy: { kind: "assistant", readOnly: true } })} />,
    subtitle: <StartedByLine surface={{ startedBy: { kind: "assistant", readOnly: true } }} wrap className="mt-0.5" />,
    toolbar: <LogActionButton variant="ghost" label="Back to Emergency Contact batch" aria-label="Back to Emergency Contact batch" className="max-w-48" icon={<ArrowLeft aria-hidden className="size-4 shrink-0" />} text={<span className="min-w-0 truncate">Emergency Contact batch</span>} />,
    headerActions: <><LogHeaderButton label="Pause Alex Morgan" icon={<Pause aria-hidden className="size-4" />} onClick={noop} /><LogHeaderButton label="Stop Alex Morgan" icon={<Square aria-hidden className="size-4" />} onClick={noop} /></>,
    rerun: { label: "Rerun", run: noop }, operator: "Alexandria Montgomery-Rivera of the Office of Academic Personnel Operations" }) },
  "menu-open": headerRun("The ⋯ menu open", async page => { await page.getByRole("button", { name: "More actions" }).press("Enter"); }, "[role='menu']"),
} satisfies Record<string, Story>;

const PAUSE = {
  "pause-pending": panel("A run asked to pause at the next step", { steps: readingSteps, timeline: pauseTimeline(reading, "pause-pending") }),
  paused: panel("A paused run", { steps: readingSteps, timeline: pauseTimeline(reading, "paused") }),
} satisfies Record<PauseState, Story>;

const DECISION: Record<RunDecisionType, Story> = {
  "identity-mismatch": exampleStory("One matching person, awaiting approval", "review-identity"),
  "pick-person": exampleStory("Several candidates to pick from", "review-candidates"),
  "pick-row": decisionStory("Pick a workbook row", RUN_DECISIONS["pick-row"]),
  "review-before-write": decisionStory("Review before the write", RUN_DECISIONS["review-before-write"]),
  "write-parked": exampleStory("A write that may not have saved", "parked"),
  "write-unknown": exampleStory("A Kuali save that did not confirm", "parked-kuali"),
  "read-back-failed": exampleStory("A saved write that could not be read back", "parked-read-back"),
  "failed-retryable": exampleStory("A step failed before any write", "failure-no-write"),
  "failed-after-write": exampleStory("A step failed after a write", "failure-committed"),
  "member-failed": decisionStory("A group member failed", RUN_DECISIONS["member-failed"]),
  "correct-value": exampleStory("A value to correct and retry", "employee-not-found"),
  "workbook-row": decisionStory("Pick the row to write", RUN_DECISIONS["workbook-row"]),
  "sign-in": decisionStory("The worker browser signed out", RUN_DECISIONS["sign-in"]),
  paused: decisionStory("A paused run offers Resume", RUN_DECISIONS.paused),
  stalled: decisionStory("A run that stopped responding", RUN_DECISIONS.stalled),
  refused: decisionStory("A command the server refused", RUN_DECISIONS.refused),
  cancelling: decisionStory("A run being cancelled", RUN_DECISIONS.cancelling),
};

/** The eight card states, each with the fixture that shows it. */
const CARD: Record<LogDecision["state"], Story> = {
  parked: exampleStory("A write waiting on the operator", "parked"),
  failed: exampleStory("A failed step", "failure-no-write"),
  review: exampleStory("A match to review", "review-identity"),
  held: exampleStory("A decision currently unavailable", "review-held"),
  unconfirmed: exampleStory("A continuation whose answer is uncertain", "transport-unknown"),
  loading: { ...exampleStory("A card still loading", "loading"), slowFetch: { region: READY } },
  recorded: exampleStory("A recorded capture", "screenshot-fields"),
  resolved: exampleStory("A resolved card", "write-absent"),
};

const answered = (optionId: string, label: string): LogDecision => ({ ...exampleDecision("review-identity"),
  answered: { optionId, label, at: IsoInstantSchema.parse("2026-08-03T16:41:05.000Z"), actor: { kind: "person", name: "Alex Rivera" } } });
const ANSWERED = {
  done: decisionStory("An approved match", answered("approve", "Approve match")),
  retry: decisionStory("A step sent to retry", answered("retry", "Retry step")),
  rejected: decisionStory("A rejected match", answered("reject", "Reject match")),
  cancelled: decisionStory("A cancelled run", answered("cancel-run", "Cancel run")),
} satisfies Record<AnsweredKind, Story>;

const writeStory = (state: WriteState, id: string): Story => exampleStory(`A failure while the write is ${state}`, id);
const WRITE = {
  "not-attempted": writeStory("not-attempted", "failure-no-write"), prepared: writeStory("prepared", "failure-prepared"),
  attempting: writeStory("attempting", "failure-attempting"), committed: writeStory("committed", "failure-committed"),
  verified: writeStory("verified", "failure-verified"), unknown: writeStory("unknown", "failure-unknown"),
} satisfies Record<WriteState, Story>;

const failureCard = (code: string): LogDecision => {
  const display = projectFailureDisplay({ code: ErrorCodeSchema.parse(code) });
  return { title: display.title, state: "failed", message: display.observation, footer: "Alex Morgan · DEMO-1042", served: RUN_DECISIONS["member-failed"].served };
};
const FAILURE = {
  SUBJECT_MISMATCH: decisionStory("Employee identity mismatch", failureCard("SUBJECT_MISMATCH"), logTimelineSample("failed")),
  EMPLOYMENT_RECORD_MISMATCH: decisionStory("Employment record mismatch", failureCard("EMPLOYMENT_RECORD_MISMATCH"), logTimelineSample("failed")),
  PROTECTED_SUBJECT_DISPLAY_REFUSED: decisionStory("Protected subject display refused", failureCard("PROTECTED_SUBJECT_DISPLAY_REFUSED"), logTimelineSample("failed")),
  DOCUMENT_READ_TIMEOUT: decisionStory("Document read interrupted", failureCard("DOCUMENT_READ_TIMEOUT"), logTimelineSample("failed")),
  other: decisionStory("A step stopped unexpectedly", failureCard("UNEXPECTED_PAGE_STATE"), logTimelineSample("failed")),
} satisfies Record<FailureCase, Story>;

const shot = (kind: CaptureKind) => captureOf(kind === "plain" ? undefined : kind, `${kind} capture`, kind === "form" ? 700 : 300);
const captureStory = (kind: CaptureKind): Story => panel(`A ${kind} capture`, { steps: [captureStep(shot(kind))], timeline: reading }, "figure.log-capture");
const CAPTURE = {
  fields: captureStory("fields"), form: captureStory("form"), browser: captureStory("browser"), person: captureStory("person"), plain: captureStory("plain"),
} satisfies Record<CaptureKind, Story>;

const CAPTURE_PROBLEM = {
  "load-error": panel("A screenshot that fails to load", { steps: [captureStep(captureOf("browser", "Broken capture", 300, "data:image/png;base64,AAAA"))], timeline: reading }, "[role='alert']"),
  "dimension-mismatch": panel("A screenshot whose size differs from the record", { steps: [captureStep(captureOf("browser", "Wrong size", 300, captureImage(850, 420, "Wrong size")))], timeline: reading }, "[role='alert']"),
  unavailable: exampleStory("A capture the run could not take", "screenshot-unavailable"),
} satisfies Record<CaptureProblem, Story>;

const entryStep = (entry: LogEntry): LogStep => ({ id: "entry", time: "09:31:00", title: "Find the Kuali action", system: "Kuali", entries: [entry] });
const noteStory = (tone: NoteTone): Story => panel(`A ${tone} note`, { steps: [entryStep({ id: "note", kind: "note", time: "09:31:03", message: "Matching action found.", ...(tone === "plain" ? {} : { tone }) })], timeline: reading });
const NOTE = { info: noteStory("info"), danger: noteStory("danger"), positive: noteStory("positive"), plain: noteStory("plain") } satisfies Record<NoteTone, Story>;

const ENTRY = {
  fields: panel("Fields the run read and filled", { steps: separationLogs.slice(0, 1), timeline: reading }),
  click: panel("A click the run made", { steps: [entryStep({ id: "click", kind: "click", time: "09:31:03", label: "Go" })], timeline: reading }),
  note: NOTE.info,
  decision: DECISION["failed-retryable"],
} satisfies Record<LogEntry["kind"], Story>;

const LOGS_READ_FAILED = formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_READ_FAILED_TITLE", {})).text;
const LOGS_UNAVAILABLE = formatErrorCatalogFailure(createErrorCatalogFailure("LOGS_UNAVAILABLE_TITLE", {})).text;
const LOGS = {
  loading: { ...panel("Logs still loading", { steps: [], timeline: [], content: <LogFeedPadding><LogSkeleton /></LogFeedPadding> }), slowFetch: { region: READY } },
  refreshing: panel("Logs refreshing", { steps: readingSteps, timeline: reading, toolbar: <Badge tone="neutral">Refreshing</Badge> }),
  "refresh-failed": panel("Logs that could not refresh", { steps: readingSteps, timeline: reading,
    toolbar: <FailureNotice sentence={`${LOGS_READ_FAILED}: Relay could not refresh these logs.`} /> }),
  "load-failed": panel("Logs that could not load", { steps: [], timeline: [], content: <div className="p-[var(--ds-space-section)]"><FailureNotice sentence="Couldn't load logs." action={{ label: "Retry", onClick: noop }} /></div> }),
  unavailable: panel("Logs for a step that is gone", { steps: [], timeline: [], content: <div className="p-[var(--ds-space-section)]"><FailureNotice sentence={`${LOGS_UNAVAILABLE}: this run or step no longer exists.`} /></div> }),
  empty: panel("A run that has logged nothing yet", { steps: [], timeline: logTimelineSample("empty") }),
  "needs-duo": panel("A run waiting for the Duo sign-in", { steps: [], timeline: logTimelineSample("empty"),
    navigation: <div className="px-3 py-2"><Banner tone="info" title="Approving Duo for UCPath"><span className="tabular-nums">Waiting 2m 10s</span></Banner></div> }),
} satisfies Record<LogsResource, Story>;

const preview = (state: DryRunState): Story => {
  const stages: DryRunPreviewStage[] = [
    { id: "read", label: "Read the request", state: "exercised", detail: "Request read" },
    { id: "write", label: "File the termination", state, detail: state === "not-clicked" ? "Submit not clicked" : state === "skipped" ? "Not needed" : state === "unavailable" ? "Not exercised" : "Filled" },
  ];
  const content = <div className="mt-4 min-w-0 p-4"><FullDryRunPreview stages={stages} facts={[{ label: "Read the request", value: "Morgan, Alex", sample: true }]} /></div>;
  return panel(`A dry-run plan with a ${state} step`, { steps: [], timeline: [], content }, "section[aria-label='Full dry-run preview'], [role='region'][aria-label='Full dry-run preview']");
};
const DRY_RUN = { exercised: preview("exercised"), "not-clicked": preview("not-clicked"), unavailable: preview("unavailable"), skipped: preview("skipped") } satisfies Record<DryRunState, Story>;

const reviewStory = (title: string, cards: RecordReviewProps["cards"], extra: Partial<Parameters<typeof RecordReview>[0]> = {}): Story => ({
  title, ready: "section[aria-label='OCR records']",
  render: () => <StoryFrame><ReviewDialog open onOpenChange={noop} subject="Emergency Contact scan">
    <RecordReview runId="run-1" subject="Alex Morgan" cards={cards} readOnly={false} discarded={false} selectedCount={cards.length}
      onApprove={noop} onDiscard={noop} onEditField={noop} onCommit={noop} onChange={noop} {...extra} />
  </ReviewDialog></StoryFrame>,
});
const REVIEW = {
  ready: reviewStory("Records ready to approve", REVIEW_CARDS.ready),
  unconfirmed: reviewStory("A record whose person is not confirmed", REVIEW_CARDS.unconfirmed, { approvalError: "Resolve the selected records before approval." }),
  "needs-review": reviewStory("A record with a field that needs review", REVIEW_CARDS["needs-review"], { approvalError: "Resolve the selected records before approval." }),
  approved: reviewStory("Records already approved", REVIEW_CARDS.approved, { readOnly: true, onApprove: undefined, onDiscard: undefined }),
  empty: reviewStory("A review with no records", REVIEW_CARDS.empty),
} satisfies Record<ReviewCase, Story>;

/** The real Review panel on a client whose reads fail, so its notice is the shipped one. */
const REVIEW_NOTICE = {
  unavailable: {
    title: "Review records that could not be read", ready: '[role="alert"]',
    render: () => <StoryFrame><DashboardClientProvider client={createDashboardClient({ baseUrl: "http://relay.story.test", fetchImpl: () => Promise.reject(new Error("offline")) })}>
      <ReviewDialog open onOpenChange={noop} subject="Emergency Contact scan"><RunReview selection={{ row: queueStoryRow("done", 50), workflowLabel: "Emergency Contact" }} /></ReviewDialog>
    </DashboardClientProvider></StoryFrame>,
    expects: [{ pattern: /offline|Failed to fetch|relay\.story\.test/u, reason: "the story's client fails every read on purpose" }],
  },
  "record-unavailable": {
    title: "A review that no longer holds the opened record", ready: 'text="Record unavailable: not part of this review."',
    render: () => {
      const selection = { row: queueStoryRow("running", 50, { workflowId: "ocr", parent: null, panelKind: "review", availableSections: ["logs", "review"] }), workflowLabel: "OCR" };
      const detail = RunDetailWireSchema.parse({ runId: selection.row.runId, rowRevision: selection.row.rowRevision, panelKind: "review",
        header: { runId: selection.row.runId, workflowId: "ocr", traceId: selection.row.traceId, title: selection.row.title, status: selection.row.status, attempt: selection.row.attempt },
        timeline: { steps: [], events: [] }, gate: { state: "absent", reason: "No gate" }, outcome: { state: "absent", reason: "Running" },
        context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, availableSections: ["logs", "review"] });
      const client = createDashboardClient({ baseUrl: "http://relay.story.test", fetchImpl: async input => Response.json(
        String(input).endsWith("/review") ? { section: "review", payload: ocrReviewPageFixture(selection.row.runId) } : detail) });
      return <StoryFrame><DashboardClientProvider client={client}>
        <ReviewDialog open onOpenChange={noop} subject="Emergency Contact scan"><RunReview selection={selection} focus={{ runId: selection.row.runId, recordId: StableRecordIdSchema.parse(`${"a".repeat(64)}#emergency-contact#9`) }} /></ReviewDialog>
      </DashboardClientProvider></StoryFrame>;
    },
  },
} satisfies Record<"unavailable" | "record-unavailable", Story>;

export const RUN_PANEL_STORIES = defineSurface("run-panel", {
  header: HEADER, "log-header": LOG_HEADER, pause: PAUSE, logs: LOGS, decision: DECISION, card: CARD, answered: ANSWERED,
  write: WRITE, failure: FAILURE, capture: CAPTURE, "capture-problem": CAPTURE_PROBLEM, entry: ENTRY, note: NOTE, "dry-run": DRY_RUN, review: REVIEW, "review-notice": REVIEW_NOTICE,
});
