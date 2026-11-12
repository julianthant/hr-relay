// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { BulkCommandFeedback } from "../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { BulkRunCommandResponseSchema } from "../../../../src/rules/commands/commands.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const runId = (seed: number): string => `1a000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;

it("the review dialog speaks in the past about rows that were already gone when the batch was sent", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    // Parsed through the schema: a dialog tested against a shape the wire cannot produce is tested against nothing.
    const response = BulkRunCommandResponseSchema.parse({ state: "vector", bulkCommandId: "0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b", type: "cancel", requestedCount: 1,
      results: [{ runId: runId(1), commandId: "1f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b", outcome: "applied", replayed: false, detail: "cancelled" }] });
    const bulkOutcome = { plan: { verb: "cancel", label: "Cancel", eligible: [{ runId: runId(1), title: "Jordan Reyes", expectedVersion: 3 }], skipped: [], unavailable: [runId(7), runId(8)] },
      subjects: new Map([[runId(1), "Jordan Reyes"]]), response } as Parameters<typeof BulkCommandFeedback>[0]["bulkOutcome"];
    await act(async () => root.render(createElement(BulkCommandFeedback, { bulkOutcome, reviewing: true, onReviewed: () => undefined, onSelectRun: () => undefined })));
    const text = (document.body.textContent ?? "").replace(/\s+/gu, " ");
    assert.ok(text.includes("2 selected rows were no longer on this day when this batch was sent, so nothing was sent for them"), text);
    assert.ok(text.includes(runId(7)) && text.includes(runId(8)), text);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("a stored result's unattempted rows say not attempted, never not offered", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    const response = BulkRunCommandResponseSchema.parse({ state: "vector", bulkCommandId: "0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b", type: "cancel", requestedCount: 2,
      results: [{ runId: runId(1), commandId: "1f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b", outcome: "errored", detail: "threw" }] });
    const bulkOutcome = { plan: { verb: "cancel", label: "Cancel", eligible: [], skipped: [{ runId: runId(2), title: "Casey Lin" }], skippedReason: "Not attempted", unavailable: [] },
      subjects: new Map([[runId(1), "Jordan Reyes"]]), response } as Parameters<typeof BulkCommandFeedback>[0]["bulkOutcome"];
    await act(async () => root.render(createElement(BulkCommandFeedback, { bulkOutcome, reviewing: true, onReviewed: () => undefined, onSelectRun: () => undefined })));
    const text = (document.body.textContent ?? "").replace(/\s+/gu, " ");
    assert.ok(text.includes("Casey Lin") && text.includes("Not attempted") && !text.includes("Not offered"), text);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
