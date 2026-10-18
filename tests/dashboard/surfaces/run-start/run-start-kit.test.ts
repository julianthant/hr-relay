
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import {
EnqueueResultBanner,
LockedFact,
PlanPreview,
StartChoiceControl,
} from "../../../../src/dashboard/surfaces/run-start/run-start-kit.js";
import { ENQUEUE_POLICY_REASON } from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { fmtClock } from "../../../../src/dashboard/surfaces/shared/status/format.js";
import { StartPlanWireSchema as StartPlanResponseSchema,type StartPlanWire as StartPlanResponse } from "../../../../src/models/dashboard/start-plan.js";
import { CommandResultSchema,type CommandResult } from "../../../../src/rules/commands/commands.js";

/** what a sighted operator can read with no pointer: the markup minus its tooltips */
function withoutTooltips(markup: string): string {
  return markup.replace(/title="[^"]*"/gu, "");
}

/** how many times a sentence occurs in a string — a fact said twice is a defect */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** the markup's text content, tags gone and React's entity escapes undone */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

const EXPIRES_AT = "2026-08-26T21:47:03.000Z";
const HASH = "a".repeat(64);

/** parsed through the real wire schema, so a fixture cannot outlive its contract */
const PLAN: StartPlanResponse = StartPlanResponseSchema.parse({
  wireVersion: 1,
  startPlanId: "5a000000-0000-4000-8000-000000000001",
  workflowId: "person-lookup",
  expectedVersion: 4,
  expiresAt: EXPIRES_AT,
  dryRun: false,
  priority: "interactive",
  plannedBy: "local-operator",
  configSnapshotId: "c0000000-0000-4000-8000-000000000001",
  fingerprints: {
    descriptorFingerprint: HASH,
    configFingerprint: HASH,
    ingressSchemaHash: HASH,
    canonicalInputSchemaHash: HASH,
    inputFingerprint: HASH,
  },
  planned: [
    {
      logicalKey: "entry:1",
      title: "Ada Lovelace",
      subtitle: "E1234567",
      matchKey: "eid:E1234567",
    },
  ],
  refused: [],
});

describe("a locked value states its reason on screen", () => {
  it("prints the reason as page text, not only as a tooltip", () => {
    const markup = renderToStaticMarkup(
      createElement(LockedFact, {
        label: "Active-run policy",
        value: "Refuse overlapping subject runs",
        reason: ENQUEUE_POLICY_REASON,
      }),
    );

    assert.ok(
      textOf(withoutTooltips(markup)).includes(ENQUEUE_POLICY_REASON),
      "the reason is reachable only by hovering",
    );
    assert.ok(textOf(markup).includes("Active-run policy"), "the fact is unlabelled");
  });

  it("states the reason ONCE — the `<p>` replaced the tooltip, it did not join it", () => {

    const markup = renderToStaticMarkup(
      createElement(LockedFact, {
        label: "Active-run policy",
        value: "Refuse overlapping subject runs",
        reason: ENQUEUE_POLICY_REASON,
      }),
    );
    assert.doesNotMatch(markup, /title="/u, "the reason went back onto a tooltip as well");
    assert.equal(
      occurrences(textOf(markup), ENQUEUE_POLICY_REASON),
      1,
      "a screen reader reads this locked value's reason more than once",
    );
    assert.doesNotMatch(markup, /<select/u, "a fixed fact must not offer a dropdown");
    assert.ok(textOf(markup).includes("Refuse overlapping subject runs"), "the fixed value disappeared");
  });

  it("is the SAME component behind the sub-selection, so the two cannot drift", () => {

    const markup = renderToStaticMarkup(
      createElement(StartChoiceControl, {
        constant: { field: "keepNonHdh", value: { kind: "boolean", value: true } },
        reason: "fixed by this workflow's input surface",
      }),
    );
    assert.ok(
      textOf(withoutTooltips(markup)).includes("fixed by this workflow's input surface"),
      "the sub-selection's reason is reachable only by hovering",
    );
  });
});

describe("the plan draws one card per proposed row", () => {
  it("draws no table, and names every served identity on the card", () => {
    const markup = renderToStaticMarkup(
      createElement(PlanPreview, { plan: PLAN }),
    );
    assert.doesNotMatch(markup, /<table/u, "the plan is still a table");
    const text = textOf(markup);
    for (const served of ["Ada Lovelace", "E1234567", "eid:E1234567"]) {
      assert.ok(text.includes(served), `the card drops the served ${served}`);
    }
  });

  it("invents none of the demo's unserved plan-row anatomy", () => {

    const text = textOf(
      renderToStaticMarkup(createElement(PlanPreview, { plan: PLAN })),
    );
    for (const invented of ["not yet created", "panel", "containment"]) {
      assert.ok(!text.includes(invented), `the card invented an unserved ${invented}`);
    }
  });

  it("puts the untruncatable identities on the provenance line, not in a clipped chip", () => {

    const markup = renderToStaticMarkup(createElement(PlanPreview, { plan: PLAN }));
    for (const identity of ["eid:E1234567"]) {
      assert.ok(textOf(markup).includes(identity), `the card drops the served ${identity}`);
      // Neither identity carries a regex metacharacter, so the literal is the
      // pattern; a helper that escaped one would be untested machinery here.
      assert.doesNotMatch(
        markup,
        new RegExp(`title="[^"]*${identity}`, "u"),
        `${identity} is recoverable only by hovering`,
      );
    }
    assert.doesNotMatch(markup, /whitespace-nowrap/u, "a served identity is back inside a single-line token");
    assert.ok(textOf(markup).includes("match key eid:E1234567"));
    assert.equal(textOf(markup).includes("trace"), false, "a proposal has no lifecycle trace");
  });

  it("prints the plan's expiry as a clock reading, never a raw ISO instant", () => {
    const text = textOf(
      renderToStaticMarkup(createElement(PlanPreview, { plan: PLAN })),
    );
    assert.ok(text.includes(`expires ${fmtClock(EXPIRES_AT)}`), "the expiry is not a clock reading");
    assert.ok(!text.includes(EXPIRES_AT), "the raw ISO instant is on an operator's screen");
  });
});

describe("result banner uses its own words", () => {
  const applied: Exclude<CommandResult, { state: "pending" }> = nonPendingResult({
    state: "applied",
    commandId: "3a000000-0000-4000-8000-000000000001",
    affectedTargets: [{
      family: "start",
      workflowId: "person-lookup",
      startPlanId: "5a000000-0000-4000-8000-000000000001",
      expectedVersion: 4,
    }],
  });

  const rejected: Exclude<CommandResult, { state: "pending" }> = nonPendingResult({
    state: "rejected",
    commandId: "3a000000-0000-4000-8000-000000000002",
    code: "policy-refused",
    message: "A run for this subject is already unfinished.",
  });

  const conflict: Exclude<CommandResult, { state: "pending" }> = nonPendingResult({
    state: "conflict",
    commandId: "3a000000-0000-4000-8000-000000000003",
    currentVersion: 7,
    message: "The start plan was built against version 4.",
  });

  const noop = (): void => undefined;

  it("says Close on a settled start and Dismiss on a refusal", () => {
    // Closing a receipt and dismissing a refusal are different acts; one word
    // for both makes them read as the same one.
    assert.ok(
      textOf(renderToStaticMarkup(
        createElement(EnqueueResultBanner, { result: applied, onDismiss: noop }),
      )).includes("Close"),
    );
    const refusalText = textOf(renderToStaticMarkup(
      createElement(EnqueueResultBanner, { result: rejected, onDismiss: noop }),
    ));
    assert.ok(refusalText.includes("Dismiss"));
    assert.ok(!refusalText.includes("Close"), "a refusal is dismissed, not closed");
  });

  it("gives the conflict arm the one exit it has", () => {

    const text = textOf(renderToStaticMarkup(
      createElement(EnqueueResultBanner, { result: conflict, onReload: noop, onDismiss: noop }),
    ));
    assert.ok(text.includes("Reload the form"), "the conflict banner has no exit");
    assert.ok(text.includes("7"), "the version the server actually holds is not shown");
  });

  it("still draws a conflict when no reload handler is wired, rather than a bare banner claim", () => {
    const text = textOf(renderToStaticMarkup(
      createElement(EnqueueResultBanner, { result: conflict }),
    ));
    assert.ok(text.includes("The start plan moved under this form"));
    assert.ok(!text.includes("Reload the form"), "an unwired control was offered anyway");
  });
});

function nonPendingResult(input: unknown): Exclude<CommandResult, { state: "pending" }> {
  const result = CommandResultSchema.parse(input);
  if (result.state === "pending") throw new Error("Start fixture cannot be pending");
  return result;
}
