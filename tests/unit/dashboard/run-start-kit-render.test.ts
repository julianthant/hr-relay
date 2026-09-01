/**
 * THE RUN MODAL'S DRAWN FACTS — D272 items 8 and 9, rendered rather than described.
 *
 * Five of ledger 1's region-C rows (`docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md`)
 * are claims about what reaches the SCREEN, and every one of them was true in
 * the source and false in the 1440x900 parity reference:
 *
 *   C48 / C81 — a locked value's reason survived only as a `title` tooltip,
 *               which is unreachable by touch and by keyboard;
 *   C57       — the plan drew a three-column table where the demo draws a card
 *               per proposed row;
 *   C61       — `expiresAt` printed as a raw ISO instant in operator-facing text;
 *   C69       — the conflict banner named a state with no exit;
 *   C72       — every result arm said "Dismiss", including the settled one.
 *
 * The pieces are JSX inside a `.tsx`, so they are pinned by rendering the real
 * components to static markup. The tooltip cases strip every `title=` attribute
 * FIRST — that is the whole assertion: the reason has to be there when the
 * tooltip is not.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  EnqueueResultBanner,
  LockedFact,
  PlanPreview,
  StartChoiceControl,
} from "../../../src/dashboard/surfaces/run-start-kit.js";
import { ENQUEUE_POLICY_REASON } from "../../../src/dashboard/surfaces/run-start-model.js";
import { fmtClock } from "../../../src/dashboard/surfaces/format.js";
import { CommandResultSchema, type CommandResult } from "../../../src/domain/commands.js";
import { StartPlanResponseSchema, type StartPlanResponse } from "../../../src/dashboard/client/commands.js";

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
  plannedBy: "person@example.edu",
  configSnapshotId: "cfg-1",
  fingerprints: {
    descriptorFingerprint: HASH,
    configFingerprint: HASH,
    ingressSchemaHash: HASH,
    canonicalInputSchemaHash: HASH,
    inputFingerprint: HASH,
  },
  planned: [
    {
      runId: "1a000000-0000-4000-8000-000000000001",
      traceId: "tr-000000000001",
      title: "Ada Lovelace",
      subtitle: "E1234567",
      matchKey: "eid:E1234567",
    },
  ],
  refused: [],
});

describe("a locked value states its reason ON SCREEN (C48 / C81, D272 item 9)", () => {
  it("prints the reason as page text, not only as a tooltip", () => {
    const markup = renderToStaticMarkup(
      createElement(LockedFact, {
        label: "Active-run policy",
        value: "Refuses the start while a run for the same subject is unfinished",
        reason: ENQUEUE_POLICY_REASON,
      }),
    );
    // The negative control is the strip: before this port the ONLY occurrence
    // of the reason in this markup was inside `title=`, and this case fails the
    // moment the `<p>` goes back to being a tooltip.
    assert.ok(
      textOf(withoutTooltips(markup)).includes(ENQUEUE_POLICY_REASON),
      "the reason is reachable only by hovering",
    );
    assert.ok(textOf(markup).includes("Active-run policy"), "the fact is unlabelled");
  });

  it("states the reason ONCE — the `<p>` replaced the tooltip, it did not join it", () => {
    // Unit F5b finding 4. `title` is not a second rendering of the same fact:
    // it joins the accessible description, so a screen reader that has just
    // read the `<p>` reads the identical sentence again from the tooltip. The
    // mutation is putting `reason={reason}` back on `LockedValue`.
    const markup = renderToStaticMarkup(
      createElement(LockedFact, {
        label: "Active-run policy",
        value: "Refuses the start while a run for the same subject is unfinished",
        reason: ENQUEUE_POLICY_REASON,
      }),
    );
    assert.doesNotMatch(markup, /title="/u, "the reason went back onto a tooltip as well");
    assert.equal(
      occurrences(textOf(markup), ENQUEUE_POLICY_REASON),
      1,
      "a screen reader reads this locked value's reason more than once",
    );
  });

  it("is the SAME component behind the sub-selection, so the two cannot drift", () => {
    // Two near-identical renderings are two things that happen to agree today
    // (`src/dashboard/CLAUDE.md`, 2026-08-26). C48 and C81 were exactly that
    // pair, and only one of them was ever going to be re-read.
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

describe("the plan is a card per proposed row (C57, D272 item 8)", () => {
  it("draws no table, and names every served identity on the card", () => {
    const markup = renderToStaticMarkup(
      createElement(PlanPreview, { plan: PLAN }),
    );
    assert.doesNotMatch(markup, /<table/u, "the plan is still a table");
    const text = textOf(markup);
    for (const served of ["Ada Lovelace", "E1234567", "eid:E1234567", "tr-000000000001"]) {
      assert.ok(text.includes(served), `the card drops the served ${served}`);
    }
  });

  it("invents none of the demo's unserved plan-row anatomy", () => {
    // `StartPlanResponse.planned[]` carries no role, panel, containment,
    // born-as status or note — ledger 1's first region-C `builds:` line. An
    // absence is drawn as an absence, never as a plausible constant.
    const text = textOf(
      renderToStaticMarkup(createElement(PlanPreview, { plan: PLAN })),
    );
    for (const invented of ["not yet created", "panel", "containment"]) {
      assert.ok(!text.includes(invented), `the card invented an unserved ${invented}`);
    }
  });

  it("puts the untruncatable identities on the provenance line, not in a clipped chip", () => {
    // Unit F5b finding 5, and it is `Chip`'s OWN rule: a chip is a single-line
    // token that cuts inside its border and recovers the cut on `title` — "if
    // a fact cannot survive truncation it is not a chip: put it on the row's
    // `MetaLine`, where it can wrap." Half of `eid:E1234567` is a different
    // subject, and a `title` is reachable by mouse and by nobody else, which
    // is exactly the defect C48/C81 fixed one component up.
    //
    // Both assertions are red against the chips this replaced: `Chip` emits
    // `title="eid:E1234567"` and carries `dsClip.token`'s `whitespace-nowrap`.
    const markup = renderToStaticMarkup(createElement(PlanPreview, { plan: PLAN }));
    for (const identity of ["eid:E1234567", "tr-000000000001"]) {
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
    assert.ok(textOf(markup).includes("trace tr-000000000001"));
  });

  it("prints the plan's expiry as a clock reading, never a raw ISO instant (C61)", () => {
    const text = textOf(
      renderToStaticMarkup(createElement(PlanPreview, { plan: PLAN })),
    );
    assert.ok(text.includes(`expires ${fmtClock(EXPIRES_AT)}`), "the expiry is not a clock reading");
    assert.ok(!text.includes(EXPIRES_AT), "the raw ISO instant is on an operator's screen");
  });
});

describe("the result banner's own words (C69 / C72, D272 items 8 and 9)", () => {
  const applied: CommandResult = CommandResultSchema.parse({
    state: "applied",
    commandId: "3a000000-0000-4000-8000-000000000001",
    affectedTargets: [{
      family: "start",
      workflowId: "person-lookup",
      startPlanId: "5a000000-0000-4000-8000-000000000001",
      expectedVersion: 4,
    }],
  });

  const rejected: CommandResult = CommandResultSchema.parse({
    state: "rejected",
    commandId: "3a000000-0000-4000-8000-000000000002",
    code: "policy-refused",
    message: "A run for this subject is already unfinished.",
  });

  const conflict: CommandResult = CommandResultSchema.parse({
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
    // D253 refuses a re-send of the same envelope identically, so the plan
    // token in this form is spent for good: without this control the banner
    // names a state the operator cannot leave.
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
