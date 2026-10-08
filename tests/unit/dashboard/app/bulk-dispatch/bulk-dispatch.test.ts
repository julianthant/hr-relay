/**
 * D235 — the bulk plan/compose layer, pinned at its two load-bearing rules.
 *
 * OFFERED vs ELIGIBLE is the pair the strip has to say out loud: a verb is
 * offered when at least one selected row serves it, and its target set is the
 * INTERSECTION of the selection with the rows whose own `actions[]` admit it —
 * a row outside that intersection is SKIPPED and named, never silently dropped
 * and never sent. And a plan with nothing eligible REFUSES to become an
 * envelope, because "nothing happened" must never be mistakable for "it
 * worked".
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  BULK_STRIP_VERBS,
  bulkClosingAssurance,
  bulkConfirmBody,
  bulkResultCounts,
  bulkSubjectsOf,
  bulkUnavailableIds,
  composeBulkRunCommand,
  planBulkVerb,
  planBulkVerbs,
  type BulkCandidateRow,
} from "../../../../../src/dashboard/app/commands/bulk-dispatch.js";
import { BulkRunCommandResponseSchema } from "../../../../../src/rules/commands/commands.js";
import type { ActionDescriptorWire } from "../../../../../src/models/dashboard/actions.js";

function servedCommand(
  command: "cancel" | "retry",
  expectedVersion: number,
  label?: string,
): ActionDescriptorWire {
  return {
    key: command,
    label: label ?? (command === "cancel" ? "Cancel" : "Retry"),
    intent: "neutral",
    placement: ["menu"],
    kind: "command",
    command,
    expectedVersion,
  };
}

function row(runId: string, title: string, actions: readonly ActionDescriptorWire[]): BulkCandidateRow {
  return { runId, title, actions };
}

describe("planBulkVerb — the intersection and the named skips (D235)", () => {
  it("offers cancel only; Rerun needs individual review", () => {
    assert.deepEqual(BULK_STRIP_VERBS, ["cancel"]);
  });
  it("splits a mixed selection into the eligible intersection and the named skipped rows", () => {
    const rows = [
      row("run-1", "Alpha", [servedCommand("cancel", 3)]),
      // Serves retry only — cancel must SKIP it by name, not send it.
      row("run-2", "Bravo", [servedCommand("retry", 7)]),
      row("run-3", "Charlie", [servedCommand("cancel", 5), servedCommand("retry", 5)]),
    ] as const;

    const plan = planBulkVerb(rows, "cancel", ["run-1", "run-2", "run-3"]);
    assert.deepEqual(
      plan.eligible,
      [
        { runId: "run-1", title: "Alpha", expectedVersion: 3 },
        { runId: "run-3", title: "Charlie", expectedVersion: 5 },
      ],
      "the eligible set is the intersection, with each row's OWN served version frozen in",
    );
    assert.deepEqual(plan.skipped, [{ runId: "run-2", title: "Bravo" }]);
  });

  it("uses the server's label when every eligible row agrees, and the strip's own noun when they disagree", () => {
    const agreeing = planBulkVerb(
      [
        row("run-1", "Alpha", [servedCommand("cancel", 1, "Cancel run")]),
        row("run-2", "Bravo", [servedCommand("cancel", 2, "Cancel run")]),
      ],
      "cancel",
      ["run-1", "run-2"],
    );
    assert.equal(agreeing.label, "Cancel run");

    const disagreeing = planBulkVerb(
      [
        row("run-1", "Alpha", [servedCommand("cancel", 1, "Cancel run")]),
        row("run-2", "Bravo", [servedCommand("cancel", 2, "Cancel group")]),
      ],
      "cancel",
      ["run-1", "run-2"],
    );
    // Neither row's authored label wins over the other; the fallback is the verb's own noun.
    assert.equal(disagreeing.label, "Cancel");
  });

  it("offers only verbs with at least one eligible row", () => {
    const plans = planBulkVerbs(
      [row("run-1", "Alpha", [servedCommand("cancel", 1)]), row("run-2", "Bravo", [])],
      ["run-1", "run-2"],
    );
    assert.deepEqual(plans.map(({ verb }) => verb), ["cancel"], "retry has no eligible row, so it is not offered");
  });
});

/**
 * The THIRD bucket, and the one the strip used to lose entirely: a selected id
 * the current day serves no row for. It is neither eligible nor skipped —
 * `skipped` means "the server described this row and it does not offer the
 * verb" — so before this it fell out of every plan, out of every count, and out
 * of the confirm copy, leaving `Cancel 3 · 1 skipped` under `6 selected`.
 */
describe("planBulkVerb — selected rows the day no longer serves", () => {
  it("names a selected id with no served row instead of dropping it", () => {
    const plan = planBulkVerb(
      [row("run-1", "Alpha", [servedCommand("cancel", 3)])],
      "cancel",
      ["run-1", "run-gone", "run-also-gone"],
    );
    assert.deepEqual(plan.eligible, [{ runId: "run-1", title: "Alpha", expectedVersion: 3 }]);
    assert.deepEqual(plan.skipped, [], "a row the day does not serve was never described, so it is not a skip");
    assert.deepEqual(plan.unavailable, ["run-gone", "run-also-gone"]);
  });

  it("states the unavailable rows in the confirm body, beside the skipped ones", () => {
    const body = bulkConfirmBody(planBulkVerb(
      [
        row("run-1", "Alpha", [servedCommand("cancel", 3)]),
        row("run-2", "Bravo", [servedCommand("retry", 4)]),
      ],
      "cancel",
      ["run-1", "run-2", "run-gone"],
    ));
    assert.match(body, /1 selected row is left alone/u, "the served-but-ineligible row is still named");
    assert.match(body, /1 selected row is no longer on this day/u);
  });

  it("refuses a plan whose whole selection has left the day, naming why", () => {
    const plan = planBulkVerb([], "cancel", ["run-gone", "run-also-gone"]);
    const composed = composeBulkRunCommand(plan, { actorId: "operator", source: "queue" });
    assert.equal(composed.state, "refused");
    assert.match(
      composed.state === "refused" ? composed.reason : "",
      /2 selected rows are no longer on this day/u,
      "the refusal must not claim the rows failed to serve retry — they were never described at all",
    );
  });

  it("throws when a candidate row is not in the selection it claims to plan for", () => {
    assert.throws(
      () => bulkUnavailableIds([row("run-1", "Alpha", [])], ["run-2"]),
      /run-1/u,
      "a row outside the selection means the caller filtered wrong; it must not be planned silently",
    );
  });
});

describe("the complete bulk result vector (D235)", () => {
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

describe("composeBulkRunCommand — a plan with nothing eligible refuses (D235)", () => {
  const context = { actorId: "local-operator", source: "queue" } as const;

  it("refuses an empty selection and a selection where nothing serves the verb, with different reasons", () => {
    const nothingSelected = composeBulkRunCommand(planBulkVerb([], "cancel", []), context);
    assert.equal(nothingSelected.state, "refused");
    assert.match((nothingSelected as { reason: string }).reason, /no rows are selected/);

    const nothingServes = composeBulkRunCommand(
      planBulkVerb([row("run-1", "Alpha", []), row("run-2", "Bravo", [])], "cancel", ["run-1", "run-2"]),
      context,
    );
    assert.equal(nothingServes.state, "refused");
    assert.match(
      (nothingServes as { reason: string }).reason,
      /none of the 2 selected rows still on this day serves cancel/,
    );
  });

  it("refuses stale bulk retry actions and composed plans", () => {
    const plan = planBulkVerb([row("run-1", "Alpha", [servedCommand("retry", 4)])], "retry", ["run-1"]);
    assert.deepEqual(plan.eligible, []);
    assert.equal(composeBulkRunCommand(plan, context).state, "refused");
  });

  it("composes a best-effort envelope whose bulk identity seeds the child identities", () => {
    const plan = planBulkVerb(
      [row("run-1", "Alpha", [servedCommand("cancel", 4)]), row("run-2", "Bravo", [servedCommand("cancel", 9)])],
      "cancel",
      ["run-1", "run-2"],
    );
    const composed = composeBulkRunCommand(plan, context);
    assert.equal(composed.state, "ready");
    const request = (composed as { request: Record<string, unknown> }).request;
    assert.equal(request.family, "run");
    assert.equal(request.type, "cancel");
    assert.equal(request.mode, "best-effort", "the runtime executes no other mode, and the client never asks for one");
    assert.equal(request.bulkCommandId, request.commandId, "the bulk identity is the child identities' seed");
    assert.deepEqual(request.targets, [
      { runId: "run-1", expectedVersion: 4 },
      { runId: "run-2", expectedVersion: 9 },
    ]);
  });
});

describe("the confirm copy and the frozen subjects (D235)", () => {
  it("states the count, the per-run transition, and how many rows are left alone", () => {
    const plan = planBulkVerb(
      [
        row("run-1", "Alpha", [servedCommand("cancel", 1)]),
        row("run-2", "Bravo", [servedCommand("cancel", 2)]),
        row("run-3", "Charlie", []),
      ],
      "cancel",
      ["run-1", "run-2", "run-3"],
    );
    const body = bulkConfirmBody(plan);
    assert.match(body, /2 runs, as 2 separate commands/);
    assert.match(body, /1 selected row is left alone/);
    assert.match(body, /reported\s+run by run/);
  });

  it("freezes one subject per eligible target so the result band can name runs after the page moves on", () => {
    const plan = planBulkVerb(
      [row("run-1", "Alpha", [servedCommand("cancel", 1)]), row("run-2", "Bravo", [servedCommand("cancel", 2)])],
      "cancel",
      ["run-1", "run-2"],
    );
    assert.deepEqual([...bulkSubjectsOf(plan)], [["run-1", "Alpha"], ["run-2", "Bravo"]]);
  });
});
