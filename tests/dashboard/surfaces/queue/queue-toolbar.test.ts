
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import type { BulkVerbPlan } from "../../../../src/dashboard/app/commands/bulk-dispatch.js";
import { QueueToolbar } from "../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { BulkRunCommandResponseSchema } from "../../../../src/rules/commands/commands.js";

const noop = (): void => undefined;

function runId(seed: number): string {
  return `1a000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

/** The band as the shell mounts it: select mode on, and no plan to draw. */
function bandText(input: {
  selectedCount: number;
  unavailable: readonly string[];
  bulkPlans?: readonly BulkVerbPlan[];
}): string {
  const markup = renderToStaticMarkup(createElement(QueueToolbar, {
    sort: "attention",
    onSort: noop,
    selectMode: true,
    onSelectMode: noop,
    selectedCount: input.selectedCount,
    visibleIds: [runId(1), runId(2), runId(3), runId(4), runId(5), runId(6)],
    onSelectAll: noop,
    onClearSelection: noop,
    bulkPlans: input.bulkPlans ?? [],
    bulkUnavailable: input.unavailable,
    onBulk: noop,
    bulkOutcome: null,
    onDismissBulkOutcome: noop,
    onSelectRun: noop,
  }));
  return markup
    // Replace tags with whitespace before collapsing text so adjacent nodes cannot merge words.
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/&quot;/gu, "\"")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

describe("the selection band's refusal, when a selection yields no bulk plan", () => {
  it("says the rows have LEFT THE DAY when every selected row is gone, and claims nothing about actions[]", () => {
    const text = bandText({ selectedCount: 3, unavailable: [runId(7), runId(8), runId(9)] });
    assert.ok(
      text.includes(
        "3 selected rows are no longer on this day, so nothing can be sent for them from this screen.",
      ),
      `the all-gone sentence is missing from: ${text}`,
    );
    assert.ok(
      !text.includes("serve Cancel"),
      "with no row still on the day, `actions[]` says nothing this screen may repeat",
    );
  });

  it("uses the SINGULAR when exactly one selected row has left the day", () => {
    const text = bandText({ selectedCount: 1, unavailable: [runId(7)] });
    assert.ok(
      text.includes(
        "1 selected row is no longer on this day, so nothing can be sent for it from this screen.",
      ),
      `the singular all-gone sentence is missing from: ${text}`,
    );
  });

  it("counts only the rows STILL on the day in the mixed case, and discloses the rest", () => {
    // 6 selected, 2 of them gone: four rows are here and serve neither verb.
    const text = bandText({ selectedCount: 6, unavailable: [runId(7), runId(8)] });
    assert.ok(
      text.includes(
        "None of the 4 selected rows still on this day serve Cancel, "
        + "so there is nothing to apply to this selection.",
      ),
      `the mixed sentence must count 6 - 2 = 4, not 6: ${text}`,
    );
    assert.ok(
      text.includes(
        "A further 2 selected rows are no longer on this day, so nothing can be sent for them from this screen.",
      ),
      `the rows that left the day must still be disclosed: ${text}`,
    );
  });

  it("uses the SINGULAR verb when exactly one selected row is still on the day", () => {
    const text = bandText({ selectedCount: 4, unavailable: [runId(7), runId(8), runId(9)] });
    assert.ok(
      text.includes(
        "None of the 1 selected row still on this day serves Cancel, "
        + "so there is nothing to apply to this selection.",
      ),
      `4 - 3 = 1 and the sentence must agree with itself: ${text}`,
    );
  });

  it("adds no `A further …` tail when nothing left the day", () => {
    const text = bandText({ selectedCount: 2, unavailable: [] });
    assert.ok(
      text.includes(
        "None of the 2 selected rows still on this day serve Cancel, "
        + "so there is nothing to apply to this selection.",
      ),
      `the whole selection is still here: ${text}`,
    );
    assert.ok(!text.includes("A further"), `nothing left the day, so there is no tail to add: ${text}`);
  });

  it("says nothing at all when nothing is selected — a caption on an absence is not a refusal", () => {
    const text = bandText({ selectedCount: 0, unavailable: [] });
    assert.ok(!text.includes("no longer on this day"), text);
    assert.ok(!text.includes("nothing to apply to this selection"), text);
    assert.ok(text.includes("0 selected"), `the count itself still reads out loud: ${text}`);
  });
});


function outcomeBandText(unavailable: readonly string[]): string {
  const markup = renderToStaticMarkup(createElement(QueueToolbar, {
    sort: "attention",
    onSort: noop,
    selectMode: true,
    onSelectMode: noop,
    selectedCount: 3,
    visibleIds: [runId(1), runId(2), runId(3)],
    onSelectAll: noop,
    onClearSelection: noop,
    bulkPlans: [],
    bulkUnavailable: unavailable,
    onBulk: noop,
    bulkOutcome: {
      plan: {
        verb: "cancel",
        label: "Cancel",
        eligible: [{ runId: runId(1), title: "Jordan Reyes", expectedVersion: 3 }],
        skipped: [],
        unavailable,
      },
      subjects: new Map([[runId(1), "Jordan Reyes"]]),
      // Parsed THROUGH the schema, not hand-built: a band tested against a
      // shape the wire cannot produce is a band tested against nothing.
      response: BulkRunCommandResponseSchema.parse({
        state: "vector",
        bulkCommandId: "0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b",
        type: "cancel",
        requestedCount: 1,
        results: [{
          runId: runId(1),
          commandId: "1f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b",
          outcome: "applied",
          replayed: false,
          detail: "cancelled",
        }],
      }),
    },
    onDismissBulkOutcome: noop,
    onSelectRun: noop,
  }));
  return markup
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/&quot;/gu, "\"")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

describe("the outcome band's third bucket", () => {
  it("speaks in the PAST about rows that were already gone when the batch was sent", () => {
    const text = outcomeBandText([runId(7), runId(8)]);
    assert.ok(
      text.includes(
        "2 selected rows were no longer on this day when this batch was sent, so nothing was sent for them",
      ),
      `the outcome sentence must be past tense throughout: ${text}`,
    );
    assert.ok(
      !text.includes("are no longer on this day, so nothing can be sent for them from this screen: "),
      `the present-tense sentence must not be the one pinned to a past instant: ${text}`,
    );
  });

  it("agrees with itself in the SINGULAR too", () => {
    const text = outcomeBandText([runId(7)]);
    assert.ok(
      text.includes(
        "1 selected row was no longer on this day when this batch was sent, so nothing was sent for it",
      ),
      `one row is "was", not "were" and not "is": ${text}`,
    );
  });
});

describe("the selection band's refusal is READABLE, not merely present", () => {
  it("puts the sentence in no `truncate` span — a toolbar has no popover to recover a clipped reason", () => {
    const markup = renderToStaticMarkup(createElement(QueueToolbar, {
      sort: "attention",
      onSort: noop,
      selectMode: true,
      onSelectMode: noop,
      selectedCount: 6,
      visibleIds: [runId(1), runId(2)],
      onSelectAll: noop,
      onClearSelection: noop,
      bulkPlans: [],
      bulkUnavailable: [runId(7), runId(8)],
      onBulk: noop,
      bulkOutcome: null,
      onDismissBulkOutcome: noop,
      onSelectRun: noop,
    }));
    const sentence = /<span class="([^"]*)">None of the 4 selected/u.exec(markup);
    assert.ok(sentence !== null, `the refusal sentence did not render at all: ${markup}`);
    assert.ok(
      !/(^|\s)truncate(\s|$)/u.test(sentence[1] ?? ""),
      `the refusal must wrap rather than clip: ${String(sentence[1])}`,
    );
    // And the band it sits in must be able to grow, or wrapping only overflows.
    assert.ok(
      markup.includes("min-h-[var(--ds-h-bar)]"),
      "a wrapping sentence in a fixed-height band is the same clip by another route",
    );
  });
});
