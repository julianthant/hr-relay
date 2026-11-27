/** Queue row stories: one per run status and per outcome tone the row can render, plus group and member rows. */
import type { z } from "zod";
import type { QueueBusinessOutcome, QueueStatusSchema, QueueSurfaceWireSchema } from "../../../../../../src/models/dashboard/projection.js";
import { QueuePanel } from "../../../../../../src/dashboard/surfaces/queue/queue.js";
import {
  QUEUE_STORY_DAY, QUEUE_STORY_GROUP, QUEUE_STORY_MEMBERS, QUEUE_STORY_NOW, QUEUE_STORY_WORKFLOW_LABEL, queueStoryRow,
} from "../../../../fixtures/dashboard/queue-row-story-surfaces.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

type QueueStatus = z.infer<typeof QueueStatusSchema>;
type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;
type OutcomeTone = QueueBusinessOutcome["tone"];

const NO_WELLS: ReadonlySet<string> = new Set();
const select = () => undefined;

/** The queue column as the dashboard lays it out, beside an empty logs column. */
function QueueStory({ surfaces, selectedRunId }: { surfaces: readonly QueueSurfaceWire[]; selectedRunId?: string }) {
  const outcomes = new Map(surfaces.flatMap(surface => surface.outcome === undefined ? [] : [[String(surface.runId), surface.outcome] as const]));
  return <StoryFrame><main className="flex min-h-0 flex-1 flex-col"><div className="dashboard-panel-columns">
    <div className="dashboard-queue-column">
      <h1 className="sr-only">{QUEUE_STORY_WORKFLOW_LABEL} queue</h1>
      <QueuePanel surfaces={surfaces} outcomes={outcomes} day={QUEUE_STORY_DAY} isToday panelLabel={QUEUE_STORY_WORKFLOW_LABEL}
        state={{ openWells: NO_WELLS, nowIso: QUEUE_STORY_NOW, panelWorkflowId: "person-lookup", ...(selectedRunId === undefined ? {} : { selectedRunId }) }}
        handlers={{ onSelect: select }} actionsOf={surface => surface.actions} workflowLabelOf={() => QUEUE_STORY_WORKFLOW_LABEL} />
    </div>
    <div className="dashboard-log-column" />
  </div></main></StoryFrame>;
}

const row = (title: string, surface: QueueSurfaceWire): Story => ({ title, render: () => <QueueStory surfaces={[surface]} /> });

const STATUS = {
  queued: row("A run waiting for a worker", queueStoryRow("queued", 1)),
  running: row("A run in progress", queueStoryRow("running", 2)),
  cancelling: row("A run stopping", queueStoryRow("cancelling", 3)),
  blocked: row("A run with a parked write", queueStoryRow("blocked", 4)),
  "awaiting-approval": row("A run waiting on review", queueStoryRow("awaiting-approval", 5)),
  done: row("A finished run", queueStoryRow("done", 6)),
  failed: row("A failed run", queueStoryRow("failed", 7)),
  cancelled: row("A cancelled run", queueStoryRow("cancelled", 8, { cancelledBy: "operator" })),
  partial: row("A run finished with warnings", queueStoryRow("partial", 9)),
} satisfies Record<QueueStatus, Story>;

const OUTCOME = {
  success: row("A finished run that names its result", queueStoryRow("done", 11, { outcome: { label: "Active", tone: "success" } })),
  warning: row("A finished run whose result needs a look", queueStoryRow("partial", 12, { outcome: { label: "Dates differ", tone: "warning" } })),
  neutral: row("A finished run with nothing to file", queueStoryRow("done", 13, { outcome: { label: "Not found", tone: "neutral" } })),
} satisfies Record<OutcomeTone, Story>;

const ROW = {
  group: { title: "A group whose people have not loaded", render: () => <QueueStory surfaces={[QUEUE_STORY_GROUP]} /> },
  member: {
    title: "A group listing its people, one open",
    render: () => <QueueStory surfaces={[QUEUE_STORY_GROUP, ...QUEUE_STORY_MEMBERS]} selectedRunId={QUEUE_STORY_MEMBERS[2]?.runId} />,
  },
  "long-title-dry-run": row("A long-titled dry run finished with warnings", queueStoryRow("partial", 14, {
    title: "Alexandria Montgomery-Rivera — rehire eligibility and prior employment verification",
    dryRun: true,
  })),
  "assistant-started": row("A run the assistant started, read only", queueStoryRow("done", 16, { startedBy: { kind: "assistant", readOnly: true } })),
  "assistant-started-live": row("A run the assistant started that writes", queueStoryRow("running", 17, { startedBy: { kind: "assistant", readOnly: false } })),
  paused: row("A paused run, its current step still", queueStoryRow("running", 15, { pauseControl: { state: "paused", expectedVersion: 1 } })),
} satisfies Record<"group" | "member" | "long-title-dry-run" | "paused" | "assistant-started" | "assistant-started-live", Story>;

export const QUEUE_ROW_STORIES = defineSurface("queue", { status: STATUS, outcome: OUTCOME, row: ROW });
