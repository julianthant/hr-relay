import assert from "node:assert/strict";
import { describe,it } from "vitest";

import {
bulkClosingAssurance,
bulkResultCounts,
bulkSubjectsOf,
} from "../../../../src/dashboard/app/commands/bulk-dispatch.js";
import { BulkRunCommandResponseSchema } from "../../../../src/rules/commands/commands.js";

describe("the complete bulk result vector", () => {
  it("keeps every outcome bucket, including zeros, and distinguishes a clean pass", () => {
    const response = BulkRunCommandResponseSchema.parse({
      state: "vector",
      bulkCommandId: "1a000000-0000-4000-8000-000000000001",
      type: "retry",
      requestedCount: 2,
      results: [
        {
          outcome: "applied",
          runId: "1a000000-0000-4000-8000-000000000002",
          commandId: "1a000000-0000-4000-8000-000000000003",
          replayed: false,
          detail: "queued again",
        },
        {
          outcome: "applied",
          runId: "1a000000-0000-4000-8000-000000000004",
          commandId: "1a000000-0000-4000-8000-000000000005",
          replayed: false,
          detail: "queued again",
        },
      ],
    });
    if (response.state !== "vector") throw new Error("fixture must be a bulk vector");
    assert.deepEqual(bulkResultCounts(response), { applied: 2, conflict: 0, refused: 0, errored: 0 });
    assert.equal(bulkClosingAssurance(response), "clean");
  });

  it("requires review for every partial vector, including an unattempted remainder", () => {
    const response = BulkRunCommandResponseSchema.parse({
      state: "vector",
      bulkCommandId: "1a000000-0000-4000-8000-000000000006",
      type: "cancel",
      requestedCount: 3,
      results: [{
        outcome: "conflict",
        runId: "1a000000-0000-4000-8000-000000000007",
        commandId: "1a000000-0000-4000-8000-000000000008",
        currentVersion: 4,
        detail: "the row changed",
      }],
    });
    if (response.state !== "vector") throw new Error("fixture must be a bulk vector");
    assert.equal(bulkClosingAssurance(response), "needs-review");
  });
});

describe("the frozen subjects", () => {
  it("freezes one subject per eligible target so the result band can name runs after the page moves on", () => {
    const plan = { verb: "resume", label: "Resume", eligible: [
      { runId: "run-1", title: "Alpha", expectedVersion: 1 },
      { runId: "run-2", title: "Bravo", expectedVersion: 2 },
    ] } as const;
    assert.deepEqual([...bulkSubjectsOf(plan)], [["run-1", "Alpha"], ["run-2", "Bravo"]]);
  });
});
