// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import type { BulkBatchOutcome } from "../../../../../src/dashboard/app/commands/bulk-dispatch.js";
import { BulkCommandFeedback } from "../../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { bulkResultNotice } from "../../../../../src/dashboard/surfaces/queue/queue-toolbar-model.js";
import { CommandResultFeed } from "../../../../../src/dashboard/surfaces/shared/actions/actions.js";
import type { CommandResultFeedEntry } from "../../../../../src/dashboard/surfaces/shared/actions/actions-model.js";
import { BulkRunCommandResponseSchema } from "../../../../../src/rules/commands/commands.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const entry = (id: string): CommandResultFeedEntry => ({
  id, targetRunId: "1a000000-0000-4000-8000-000000000001", expectedVersion: 3, subject: "Jordan Reyes", workflowLabel: "Separations", actionLabel: `Cancel ${id}`,
  clock: "9:41 AM", actorId: "actor-1",
  settlement: { kind: "refused", reason: "rejected", problem: "Finished.", message: "Finished.", code: "RUN_CONTINUATION_REFUSED" },
});
const outcome = (commandId: string): BulkBatchOutcome => ({
  commandId, plan: { verb: "cancel", label: "Cancel", eligible: [], skipped: [], unavailable: [] }, subjects: new Map(),
  response: BulkRunCommandResponseSchema.parse({ state: "refused", code: "RUN_CONTINUATION_REFUSED", message: "Refused." }),
});
const strips = () => [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent ?? "");
const dismiss = () => act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')?.click(); });

async function mount<T>(render: (value: T) => ReturnType<typeof createElement>, first: T) {
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  await act(async () => root.render(render(first)));
  return { rerender: (value: T) => act(async () => root.render(render(value))), done: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it("dismissing a refused command hides its strip, keeps its Priority item, and a later refusal shows a new strip", async () => {
  const first = entry("one"), results = [first];
  const view = await mount((value: readonly CommandResultFeedEntry[]) => createElement(CommandResultFeed, { results: value }), results);
  try {
    assert.deepEqual(strips(), ["Cancel one: rejected"]);
    await dismiss();
    assert.deepEqual(strips(), []);
    assert.deepEqual(results, [first], "the feed never removes the entry the Inbox item is built from");
    await view.rerender([first, entry("two")]);
    assert.deepEqual(strips(), ["Cancel two: rejected"]);
  } finally { await view.done(); }
});

it("dismissing a batch that sent nothing hides its strip, keeps its Priority item, and a later batch shows a new strip", async () => {
  const first = outcome("0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b"), second = outcome("1f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b");
  const view = await mount((value: BulkBatchOutcome) => createElement(BulkCommandFeedback, { bulkOutcome: value, reviewing: false, onReviewed: () => undefined, onSelectRun: () => undefined }), first);
  try {
    assert.deepEqual(strips(), ["Cancel: nothing was sent"]);
    await dismiss();
    assert.deepEqual(strips(), []);
    assert.equal(bulkResultNotice(first).id, `bulk-result:${first.commandId}`);
    await view.rerender(second);
    assert.deepEqual(strips(), ["Cancel: nothing was sent"]);
  } finally { await view.done(); }
});
