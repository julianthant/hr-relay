/** Command failure notices: a refused command in the feed and a batch that sent nothing, each with its in-place Dismiss. */
import type { Page } from "@playwright/test";
import type { BulkBatchOutcome } from "../../../../../../src/dashboard/app/commands/bulk-dispatch.js";
import { BulkCommandFeedback } from "../../../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { CommandResultFeed } from "../../../../../../src/dashboard/surfaces/shared/actions/actions.js";
import type { CommandResultFeedEntry } from "../../../../../../src/dashboard/surfaces/shared/actions/actions-model.js";
import { BulkRunCommandResponseSchema } from "../../../../../../src/rules/commands/commands.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;
const dismiss = async (page: Page): Promise<void> => { await page.getByRole("button", { name: "Dismiss", exact: true }).click(); };

const REFUSAL = "run 1a000000-0000-4000-8000-000000000001 is already terminal; there is nothing to cancel";
const ENTRY: CommandResultFeedEntry = {
  id: "refused-1", targetRunId: "1a000000-0000-4000-8000-000000000001", expectedVersion: 3, subject: "Jordan Reyes", workflowLabel: "Separations",
  actionLabel: "Cancel run", clock: "9:41 AM", actorId: "actor-1",
  settlement: { kind: "refused", reason: "rejected", problem: REFUSAL, message: REFUSAL, code: "invalid-state" },
};
const feed = (title: string, extra: Partial<Story> = {}): Story => ({
  title, ready: '[role="alert"], [data-app-root]', render: () => <StoryFrame><div className="p-4"><CommandResultFeed results={[ENTRY]} /></div></StoryFrame>, ...extra,
});

const OUTCOME: BulkBatchOutcome = {
  commandId: "0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b",
  plan: { verb: "cancel", label: "Cancel", eligible: [{ runId: ENTRY.targetRunId, title: "Jordan Reyes", expectedVersion: 3 }], skipped: [], unavailable: [] },
  subjects: new Map([[ENTRY.targetRunId, "Jordan Reyes"]]),
  response: BulkRunCommandResponseSchema.parse({ state: "refused", code: "RUN_CONTINUATION_REFUSED", message: "The batch was refused." }),
};
const bulk = (title: string, extra: Partial<Story> = {}): Story => ({
  title, render: () => <StoryFrame><div className="p-4"><BulkCommandFeedback bulkOutcome={OUTCOME} reviewing={false} onReviewed={noop} onSelectRun={noop} /></div></StoryFrame>, ...extra,
});

const FEED = {
  refused: feed("A refused command, with Dismiss", { ready: '[role="alert"]' }),
  dismissed: feed("The refused command after Dismiss", { play: dismiss }),
} satisfies Record<"refused" | "dismissed", Story>;
const BULK = {
  "nothing-sent": bulk("A batch that sent nothing, with Dismiss", { ready: '[role="alert"]' }),
  dismissed: bulk("The batch notice after Dismiss", { play: dismiss }),
} satisfies Record<"nothing-sent" | "dismissed", Story>;

export const COMMAND_NOTICE_STORIES = defineSurface("command-notice", { feed: FEED, bulk: BULK });
