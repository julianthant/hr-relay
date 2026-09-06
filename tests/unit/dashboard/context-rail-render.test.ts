// @vitest-environment jsdom
/** D334: the read-only Context rail preserves grouping, provenance and keyboard layout controls. */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  ContextRail,
  type ContextSections,
} from "../../../src/dashboard/surfaces/context-rail.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { ToastProvider } from "../../../src/dashboard/ds/ui.js";
import {
  ContextSummaryWireSchema,
  RunDetailSectionResponseSchema,
} from "../../../src/domain/dashboard/run-detail.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** what a sighted operator can read with no pointer: the markup minus its tooltips */
function withoutTooltips(markup: string): string {
  return markup.replace(/title="[^"]*"/gu, "");
}

/** the markup's text content, tags gone and React's entity escapes undone */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&")
    .replace(/&#x2F;/gu, "/")
    .replace(/\s+/gu, " ")
    .trim();
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const RUN_ID = "11111111-1111-4111-8111-111111111111";

/**
 * A client that answers NOTHING and throws by name if the rail reaches for it.
 *
 * Every case here is a resting render — no press, no dispatch — so a reach for
 * the client is a defect this file wants to hear about rather than absorb.
 */
function refusingClient(): DashboardClient {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, property): unknown {
      throw new Error(
        `the Context rail reached for client.${String(property)} on a resting render`,
      );
    },
  };
  return new Proxy({}, handler) as unknown as DashboardClient;
}

const SUMMARY = ContextSummaryWireSchema.parse({ dataFacts: 3, evidenceFacts: 0, attempts: 1 });

/**
 * Three entries over TWO attributed steps and one the build cannot attribute —
 * the exact shape C51 and C54 are about, parsed through the real wire schema so
 * the fixture cannot outlive its contract.
 */
function dataSections(): ContextSections {
  const response = RunDetailSectionResponseSchema.parse({
    section: "context-data",
    payload: {
      runId: RUN_ID,
      editing: { state: "editable", expectedVersion: 4 },
      entries: [
        {
          label: "Employee id",
          valueRedacted: "10••••23",
          edit: {
            state: "editable",
            nodeId: "find-person",
            fieldPath: "employeeId",
            value: "10000023",
            pendingCorrection: { state: "none" },
          },
          origin: { nodeId: "find-person", step: "Find person", dir: "read", system: "ucpath" },
        },
        {
          label: "Department",
          valueRedacted: "Neurosciences",
          edit: { state: "locked", reason: "Recorded by the run." },
          origin: { nodeId: "find-person", step: "Find person", dir: "read", system: "ucpath" },
        },
        {
          label: "Separation date",
          valueRedacted: "2026-09-30",
          edit: { state: "locked", reason: "Recorded by the run." },
          origin: { nodeId: "submit-separation", step: "Submit separation", dir: "write" },
        },
        {
          label: "Legacy key",
          valueRedacted: "sep-4471",
          edit: { state: "locked", reason: "Recorded under an earlier descriptor." },
        },
      ],
    },
  });
  // The parse answers the whole section union; a fixture that drifted onto
  // another arm would otherwise render an empty rail and pass every assertion
  // below by drawing nothing.
  if (response.section !== "context-data") {
    throw new Error(`the fixture parsed as ${response.section}, not context-data`);
  }
  return { "context-data": response.payload };
}

function renderRail(sections: ContextSections, dataExpanded = false): string {
  return renderToStaticMarkup(
    createElement(
      DashboardClientProvider,
      {
        client: refusingClient(),
        children: createElement(ToastProvider, {
          children: createElement(ContextRail, {
            summary: SUMMARY,
            sections,
            onClose: () => undefined,
            actorId: "operator-1",
            liveStatus: "queued",
            dataExpanded,
            onDataExpandedChange: () => undefined,
            onSaved: () => undefined,
          }),
        }),
      },
    ),
  );
}

describe("the step group's own chrome (C51, D273 item 5)", () => {
  it("gives every attributed step a Well, a recessed band and divided rows", () => {
    const markup = renderRail(dataSections());
    // Two attributed steps, so two banded groups. The band is what the recess
    // border under it identifies: a heading floating over rows draws neither.
    assert.equal(occurrences(markup, "border-[color:var(--ds-recess-border)] bg-[var(--ds-surface-1)]"), 2);
    assert.match(markup, /Find person/u);
    assert.match(markup, /Submit separation/u);
    // `Find person` records two rows, so exactly one divider falls between
    // them; `Submit separation` records one and gets none. A divider is drawn
    // BETWEEN values, never above the first.
    assert.equal(occurrences(markup, "border-t border-[color:var(--ds-border-subtle)]"), 1);
  });

  it("gives the unattributed group no band, because it has no step to name", () => {
    const markup = renderRail(dataSections());
    // The chrome encodes the step. The entry with no field identity is drawn
    // as a value — it just is not drawn a heading, empty or invented.
    assert.match(markup, /Legacy key/u);
    assert.equal(occurrences(markup, "border-[color:var(--ds-recess-border)] bg-[var(--ds-surface-1)]"), 2);
  });

  it("puts the system chip on the band and not on each row", () => {
    // `Find person` reads UCPath for two of its values; the chip is said once.
    const markup = renderRail(dataSections());
    assert.equal(occurrences(textOf(withoutTooltips(markup)), "UCPATH"), 1);
  });
});

describe("the rail's words (C16 / C32, D273 item 5)", () => {
  it("names the direction with the demo's own pair", () => {
    const markup = renderRail(dataSections());
    assert.match(markup, /<span class="sr-only">read<\/span>/u);
    assert.match(markup, /<span class="sr-only">write<\/span>/u);
    // `written` was a tense this ledger uses nowhere else.
    assert.equal(markup.includes(">written<"), false);
  });

  it("gives the Data section ONE name, read by its region and its label alike", () => {
    // The recorded divergence from the demo (C16): its region says `Data` under
    // a visible `Extracted fields`. One expression feeds both halves here, so
    // they cannot drift — the rule `intake.tsx` landed for WCAG 2.5.3.
    const markup = renderRail(dataSections());
    assert.match(markup, /<section aria-label="Extracted fields"/u);
    assert.equal(occurrences(markup, "Extracted fields"), 2);
  });
});

describe("D334 read-only source data", () => {
  it("keeps redacted source values without offering a checkpoint mutation", () => {
    const markup = renderRail(dataSections());
    for (const value of ["10••••23", "Neurosciences", "2026-09-30", "sep-4471"]) assert.ok(markup.includes(value));
    assert.equal(markup.includes("10000023"), false, "legacy editable payload cannot disclose raw values");
    assert.equal(markup.includes("<input"), false);
    assert.equal(markup.includes("Save"), false);
    assert.equal(markup.includes("correction"), false);
    assert.equal(occurrences(markup, "Recorded source values are read-only."), 4);
  });

  it("widens and narrows using keyboard focus without touching the command client", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    let expanded = false;
    const render = () => root.render(createElement(DashboardClientProvider, { client: refusingClient(),
      children: createElement(ToastProvider, { children: createElement(ContextRail, {
        summary: SUMMARY, sections: dataSections(), onClose: () => undefined, actorId: "operator-1", liveStatus: "queued",
        dataExpanded: expanded, onDataExpandedChange: (value: boolean) => { expanded = value; render(); }, onSaved: () => { throw new Error("read-only data saved"); },
      }) }) }));
    try {
      await act(async () => { render(); });
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Widen the data surface"]'); assert.ok(button);
      button.focus(); await act(async () => { button.click(); }); assert.equal(expanded, true);
      assert.equal(document.activeElement, button); assert.equal(button.getAttribute("aria-label"), "Narrow the data surface");
      await act(async () => { button.click(); }); assert.equal(expanded, false); assert.equal(document.activeElement, button);
      assert.equal(document.querySelectorAll("input").length, 0);
    } finally { await act(async () => { root.unmount(); }); host.remove(); }
  });
});
