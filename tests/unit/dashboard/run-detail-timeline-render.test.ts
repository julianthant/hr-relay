// @vitest-environment jsdom
/**
 * D273 item 2, rendered — the markup half of the run-detail timeline ports.
 *
 * Operator context is `docs/decisions/dashboard.md` §D273
 * (answered A on 2026-08-26); the audited rows are ledger 2 B41, B44, B50, B57,
 * B60 and B61. `run-detail-timeline.test.ts` pins the three folds; this file
 * pins that the component actually CONSUMES them, which a fold cannot see.
 *
 * The claims here are all about the element that reaches the browser — whether
 * the segment is a `<button>` a keyboard can reach, whether the disclosure
 * names the category's state, whether a homeless wait gets a segment, and which
 * words the axis prints — so `renderToStaticMarkup` is the right instrument,
 * exactly as `queue-gate-age.test.ts` uses it for the queue row's name.
 *
 * The F6b block below adds two claims `renderToStaticMarkup` cannot make: the
 * read-forward strip's own segment (the categorical strip's un-ported sibling)
 * and the disclosure button's `aria-expanded` actually FLIPPING on focus. The
 * file takes `// @vitest-environment jsdom` for that half — `renderToStaticMarkup`
 * runs identically under it, so nothing above this line changes behaviour.
 */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it } from "vitest";
import { RunDetailWireSchema, type RunDetailWire } from "../../../src/domain/dashboard/run-detail.js";
import { Timeline } from "../../../src/dashboard/surfaces/run-detail/timeline.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const RUN_ID = "e1b8ae3e-0000-4000-8000-000000000001";
const NOTE_ID = "e1b8ae3e-0000-4000-8000-000000000101";
const GATE_ID = "e1b8ae3e-0000-4000-8000-0000000000a1";
const STARTED_AT = "2026-08-25T12:00:00.000Z";
const OPENED_AT = "2026-08-25T12:01:00.000Z";
const NOW = "2026-08-25T12:03:30.000Z";

const OPEN_GATE = {
  state: "open",
  gateId: GATE_ID,
  label: "Confirm this is the right person",
  openedAt: OPENED_AT,
  revision: 3,
} as const;

const NO_GATE = { state: "absent", reason: "this run reached no gate" } as const;

function step(label: string, state: string, durationSec?: number): unknown {
  return {
    label,
    state,
    ...(durationSec === undefined ? {} : { durationSec }),
    members: [{ label: `${label} node`, state, ...(durationSec === undefined ? {} : { durationSec }) }],
  };
}

function detailOf(steps: readonly unknown[], gate: unknown): RunDetailWire {
  return RunDetailWireSchema.parse({
    runId: RUN_ID,
    rowRevision: 4,
    panelKind: "run",
    header: {
      runId: RUN_ID,
      traceId: "pl-120000-e1b8",
      workflowId: "person-lookup",
      actorId: "local-operator",
      title: "EID 10873698",
      status: "running",
      attempt: 1,
    },
    timeline: {
      events: [{
        noteId: NOTE_ID,
        sequence: 0,
        at: STARTED_AT,
        label: "searching",
        state: "active",
        notRun: { state: "absent", reason: "this step ran" },
      }],
      steps,
    },
    gate,
    outcome: { state: "absent", reason: "run is still executing" },
    context: { dataFacts: 2, evidenceFacts: 0, attempts: 1 },
    availableSections: ["logs", "receipt", "context-data", "context-attempts"],
  });
}

function render(steps: readonly unknown[], gate: unknown): string {
  return renderToStaticMarkup(createElement(Timeline, { detail: detailOf(steps, gate), nowIso: NOW }));
}

describe("B41 — the timeline segment is reachable by keyboard", () => {
  it("renders each segment as a button so the disclosure's focus-within can fire", () => {
    const html = render([step("Find person", "done", 4), step("Cross-verify", "active")], NO_GATE);
    // Two segments, two buttons. The `<span aria-label>` this replaces named
    // nothing at all — a generic element with no role takes no accessible name
    // — and a group with no focusable child can never open on focus.
    assert.equal(html.match(/<button type="button"/gu)?.length, 2);
    assert.match(html, /aria-label="Find person — done, took 4s"/u);
    // The disclosure's own trigger: without a focusable child this class is dead.
    assert.match(html, /group-focus-within:block/u);
  });
});

describe("B44 — an unmeasured segment that ran is dimmed", () => {
  it("dims the segment with no duration and leaves the measured one alone", () => {
    const html = render([step("Find person", "done", 4), step("Cross-verify", "done")], NO_GATE);
    const buttons = html.match(/<button type="button"[^>]*>/gu) ?? [];
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0]?.includes("opacity-70"), false);
    assert.equal(buttons[1]?.includes("opacity-70"), true);
  });
});

describe("B50 — the disclosure names the category's own state", () => {
  it("prints a Status row above the member list", () => {
    const html = render([step("Find person", "done", 4)], NO_GATE);
    assert.match(html, /Status/u);
    // The card discloses the members AND says what the category itself is; a
    // card that only listed members made the reader infer the one fact it
    // exists to settle.
    assert.ok(html.indexOf("Status") < html.indexOf("Find person node"));
  });
});

describe("B57 — a homeless wait still gets a segment", () => {
  it("draws the orphan segment when no step records the wait", () => {
    const html = render([step("Find person", "done", 4)], OPEN_GATE);
    assert.match(html, /Waiting on you/u);
  });

  it("draws no orphan segment when a step IS blocked", () => {
    const html = render([step("Find person", "done", 4), step("Approve", "blocked")], OPEN_GATE);
    assert.equal(/Waiting on you</u.test(html), false);
  });

  it("draws no orphan segment for a run with no open gate", () => {
    assert.equal(/Waiting on you/u.test(render([step("Find person", "done", 4)], NO_GATE)), false);
  });
});

describe("B60/B61 — the axis prints both halves and no longer claims a span", () => {
  it("names the working sum, not the first-to-last elapsed", () => {
    const html = render([step("Find person", "done", 4), step("Cross-verify", "done", 6)], NO_GATE);
    assert.match(html, /10s working/u);
    // The retired vocabulary: the span between the first and last event under
    // the word `elapsed` measured a different thing entirely.
    assert.equal(/elapsed/u.test(html), false);
  });

  it("adds the waiting half only while a gate is open", () => {
    const waiting = render([step("Find person", "done", 4)], OPEN_GATE);
    assert.match(waiting, /4s working · 2m 30s waiting on you/u);
    assert.equal(/waiting on you/u.test(render([step("Find person", "done", 4)], NO_GATE)), false);
  });

  it("prints no working half when nothing was measured", () => {
    // Not `0s working`. A run whose steps recorded no duration did not work for
    // zero seconds — nothing measured it.
    const html = render([step("Find person", "active")], NO_GATE);
    assert.equal(/working/u.test(html), false);
  });
});

describe("F6b item 1 — the read-forward strip's segment names itself", () => {
  it("computes an accessible name via role=\"img\", not a bare aria-label", () => {
    // `steps: []` forces the un-categorical fallback strip — the one raw
    // per-event bar the categorical `StepStrip` above never draws.
    const html = render([], NO_GATE);
    // A generic <span aria-label> computes NO accessible name (HTML-AAM): the
    // regression this pins is the role vanishing while the label stays, which
    // looks identical in every diff that does not grep for `role=`.
    assert.match(html, /<span role="img" aria-label="searching — active"/u);
  });
});

describe("F6b item 3 — the disclosure trigger names what it controls", () => {
  let mounted: Root | undefined;

  afterEach(async () => {
    const root = mounted;
    mounted = undefined;
    if (root !== undefined) {
      await act(async () => {
        root.unmount();
      });
    }
    document.body.replaceChildren();
  });

  it("pairs aria-controls with the member card's own id, both arms present statically", () => {
    const html = render([step("Find person", "done", 4), step("Cross-verify", "active")], NO_GATE);
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/gu)].map((match) => match[1]);
    assert.equal(controls.length, 2);
    for (const id of controls) {
      // Every controlled id names a real element in the same markup — an
      // `aria-controls` pointing at nothing is as unreachable as none at all.
      assert.match(html, new RegExp(`id="${String(id)}"`, "u"));
    }
    // Unfocused, unhovered: the disclosure has not opened yet.
    assert.equal([...html.matchAll(/aria-expanded="(true|false)"/gu)].every((m) => m[1] === "false"), true);
  });

  it("flips aria-expanded to true on focus and back to false on blur", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted = root;

    await act(async () => {
      root.render(createElement(Timeline, {
        detail: detailOf([step("Find person", "done", 4)], NO_GATE),
        nowIso: NOW,
      }));
    });

    const button = host.querySelector("button");
    if (button === null) throw new Error("the strip rendered no disclosure button");
    assert.equal(button.getAttribute("aria-expanded"), "false");

    await act(async () => {
      button.focus();
    });
    assert.equal(button.getAttribute("aria-expanded"), "true");

    await act(async () => {
      button.blur();
    });
    assert.equal(button.getAttribute("aria-expanded"), "false");
  });

  it("keeps the focused step disclosure with that step when a live patch reorders categories", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted = root;
    const before = [step("Find person", "done", 4), step("Cross-verify", "active")];

    await act(async () => {
      root.render(createElement(Timeline, { detail: detailOf(before, NO_GATE), nowIso: NOW }));
    });

    const focused = [...host.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label")?.startsWith("Cross-verify"),
    );
    if (focused === undefined) throw new Error("the cross-verify disclosure was not rendered");
    await act(async () => focused.focus());
    assert.equal(focused.getAttribute("aria-expanded"), "true");

    await act(async () => {
      root.render(createElement(Timeline, {
        detail: detailOf([step("Cross-verify", "done", 7), step("Find person", "done", 4)], NO_GATE),
        nowIso: NOW,
      }));
    });

    const reordered = host.querySelector('button[aria-label^="Cross-verify"]');
    assert.equal(document.activeElement, reordered);
    assert.equal(reordered?.getAttribute("aria-expanded"), "true");
    assert.equal(host.querySelector('button[aria-label^="Find person"]')?.getAttribute("aria-expanded"), "false");
  });
});
