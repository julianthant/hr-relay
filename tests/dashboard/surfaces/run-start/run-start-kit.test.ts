
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import {
LockedFact,
PlanPreview,
StartChoiceControl,
TypedInput,
} from "../../../../src/dashboard/surfaces/run-start/run-start-kit.js";
import { fmtClock } from "../../../../src/dashboard/surfaces/shared/status/format.js";
import { InputRunSurfaceSchema } from "../../../../src/models/workflow/ingress.js";
import { WORK_STUDY_INPUT_PARSER, WORK_STUDY_TYPED_INPUT } from "../../../../src/models/workflows/work-study/input.js";
import { StartPlanWireSchema as StartPlanResponseSchema,type StartPlanWire as StartPlanResponse } from "../../../../src/models/dashboard/start-plan.js";

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
        reason: "Fixed by this workflow.",
      }),
    );

    assert.ok(
      textOf(withoutTooltips(markup)).includes("Fixed by this workflow."),
      "the reason is reachable only by hovering",
    );
    assert.ok(textOf(markup).includes("Active-run policy"), "the fact is unlabelled");
  });

  it("states the reason ONCE — the `<p>` replaced the tooltip, it did not join it", () => {

    const markup = renderToStaticMarkup(
      createElement(LockedFact, {
        label: "Active-run policy",
        value: "Refuse overlapping subject runs",
        reason: "Fixed by this workflow.",
      }),
    );
    assert.doesNotMatch(markup, /title="/u, "the reason went back onto a tooltip as well");
    assert.equal(
      occurrences(textOf(markup), "Fixed by this workflow."),
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

describe("Work Study's typed input", () => {
  const surface = InputRunSurfaceSchema.parse({ placeholder: "10000001, 10000002", parser: WORK_STUDY_INPUT_PARSER, typedInput: WORK_STUDY_TYPED_INPUT });
  const render = (draft: Record<string, string>) => renderToStaticMarkup(createElement(TypedInput, {
    surface, workflowId: "work-study", text: "", onText: () => undefined, preview: { entries: [], submissions: [], problem: null }, draft }));

  it("asks for the Effective date as a typed date, not a switch, and offers no mode choice", () => {
    const markup = render({ effectiveDate: "08/03/2026" });
    assert.ok(markup.includes("Effective date"), "no Effective date row");
    assert.ok(markup.includes("The day the change takes effect."), "the row note is missing");
    assert.ok(markup.includes('value="08/03/2026"'), "the typed date is not shown");
    assert.ok(!markup.includes('role="switch"'), "the date is rendered as a switch");
    assert.ok(markup.includes('aria-label="Employee IDs"'), "the Employee IDs box is missing");
    assert.ok(!/role="radiogroup"|role="tablist"/u.test(markup), "a mode choice is offered for a single-mode surface");
  });
});
