// @vitest-environment jsdom
/** D334: the read-only Context rail preserves grouping, provenance and keyboard layout controls. */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { Hono } from "hono";
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
import { ItemAttemptHistoryResponseSchema, type ItemAttemptHistoryResponse } from "../../../src/domain/dashboard/item-attempt-history.js";
import { ActionDescriptorWireSchema } from "../../../src/domain/dashboard/actions.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { registerRunDetailRoutes } from "../../../src/backend/transports/dashboard/routes/run-detail.js";
import { createItemAttemptHistoryQuery } from "../../../src/backend/runs/dashboard/queries/item-attempt-history.js";
import type { RunDetailQueryDeps } from "../../../src/backend/runs/dashboard/queries/run-detail-types.js";
import type { RequestIdentityCheckpoint } from "../../../src/backend/transports/dashboard/request-identity.js";
import { sqliteRunReader } from "../../helpers/canonical-run-reader.js";
import { makeWorld, runRecordOf, uuidOf, type DashboardWorld } from "../../unit/server/helpers/dashboard-harness.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";

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

function historyWire(input: Readonly<{
  selectedRunId: string;
  itemId: string;
  selectedAttempt: number;
  entries: readonly Readonly<{
    runId: string;
    attempt: number | null;
    disposition?: "live" | "archived" | "deleted";
    partitionDay?: string;
    deletedAt?: string;
  }>[];
  offset?: number;
  totalEntries?: number;
  nextCursor?: string | null;
}>): ItemAttemptHistoryResponse {
  return ItemAttemptHistoryResponseSchema.parse({
    schemaVersion: 1,
    state: "available",
    selected: {
      state: "present", disposition: "live", runId: input.selectedRunId,
      workflowId: "person-lookup", itemId: input.itemId,
      attempt: input.selectedAttempt, rowRevision: 1,
    },
    item: { workflowId: "person-lookup", itemId: input.itemId },
    page: {
      limit: 50,
      offset: input.offset ?? 0,
      totalEntries: input.totalEntries ?? input.entries.length,
      entries: input.entries.map((entry) => entry.disposition === "deleted" ? ({
        disposition: "deleted",
        runId: entry.runId,
        workflowId: "person-lookup",
        itemId: input.itemId,
        attempt: entry.attempt,
        deletedAt: entry.deletedAt ?? "2026-09-22T17:00:00.000Z",
      }) : ({
        disposition: entry.disposition ?? "live",
        runId: entry.runId,
        workflowId: "person-lookup",
        itemId: input.itemId,
        attempt: entry.attempt ?? 1,
        rowRevision: 1,
        partitionDay: entry.partitionDay ?? "2026-09-22",
      })),
      nextCursor: input.nextCursor ?? null,
    },
  });
}

/**
 * Three entries over TWO attributed steps and one the build cannot attribute —
 * the exact shape C51 and C54 are about, parsed through the real wire schema so
 * the fixture cannot outlive its contract.
 */
function dataSections(runId = RUN_ID, attempt = 1, employeeId = "10••••23"): ContextSections {
  const checkpoint = {
    state: "present",
    runId,
    attempt,
    claimGeneration: 3,
    descriptorVersion: 1,
    contractFingerprint: "a".repeat(64),
    schemaHash: "b".repeat(64),
    writtenAt: "2026-09-22T17:00:00.000Z",
  } as const;
  const entry = (label: string, valueRedacted: string, nodeId: string, fieldPath: string,
    origin?: Record<string, string>) => ({
    label, valueRedacted,
    coordinate: { nodeId, fieldPath },
    checkpoint,
    valueState: "present" as const,
    ...(origin === undefined ? {} : { origin }),
  });
  const response = RunDetailSectionResponseSchema.parse({
    section: "context-data",
    payload: {
      runId,
      state: "available",
      entries: [
        entry("Employee id", employeeId, "find-person", "employeeId",
          { nodeId: "find-person", step: "Find person", dir: "read", system: "ucpath" }),
        entry("Department", "Neurosciences", "find-person", "department",
          { nodeId: "find-person", step: "Find person", dir: "read", system: "ucpath" }),
        entry("Separation date", "2026-09-30", "submit-separation", "separationDate",
          { nodeId: "submit-separation", step: "Submit separation", dir: "write" }),
        entry("Legacy key", "sep-4471", "legacy-node", "legacyKey"),
      ],
    },
  });
  if (response.section !== "context-data") {
    throw new Error(`the fixture parsed as ${response.section}, not context-data`);
  }
  const attempts = RunDetailSectionResponseSchema.parse({
    section: "context-attempts",
    payload: { runId, entries: [{ label: "Current attempt", valueRedacted: "1" }] },
  });
  if (attempts.section !== "context-attempts") throw new Error("the fixture parsed as the wrong attempt section");
  return { "context-data": response.payload, "context-attempts": attempts.payload };
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
            dataExpanded,
            onDataExpandedChange: () => undefined,
          }),
        }),
      },
    ),
  );
}

describe("observed Run data", () => {
  it("shows a recorded field when there is no editable checkpoint field", () => {
    const response = RunDetailSectionResponseSchema.parse({
      section: "context-data",
      payload: {
        runId: RUN_ID,
        state: "available",
        entries: [],
        observations: [{
          kind: "observed",
          logId: "e1b8ae3e-0000-4000-8000-000000000021",
          sequence: 0,
          at: "2026-09-22T17:00:00.000Z",
          attempt: 2,
          traceId: "pl-100000-e1b8",
          spanPath: "pl-100000-e1b8/read-document#1.2",
          producer: { nodeId: "read-document", step: "Separation Document", taskId: "kuali/read-separation-document", system: "kuali" },
          points: [{ direction: "read", field: "documentNumber", values: [
            { key: "documentNumber", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "4684" },
          ] }],
        }],
      },
    });
    assert.equal(response.section, "context-data");
    const markup = renderRail({ ...dataSections(), "context-data": response.payload });
    const visible = textOf(withoutTooltips(markup));
    assert.match(visible, /Separation Document/u);
    assert.match(visible, /4684/u);
    assert.doesNotMatch(visible, /No run data recorded/u);
  });
});

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
  it("keeps historical masked source values without reconstructing missing values or offering a checkpoint mutation", () => {
    const markup = renderRail(dataSections());
    for (const value of ["10••••23", "Neurosciences", "2026-09-30", "sep-4471"]) assert.ok(markup.includes(value));
    assert.equal(markup.includes("10000023"), false, "historical missing complete value must not be reconstructed");
    assert.equal(markup.includes("<input"), false);
    assert.equal(markup.includes("Save"), false);
    assert.equal(markup.includes("correction"), false);
    assert.equal(occurrences(markup, "Recorded source values are read-only."), 4);
  });

  it("displays newly supplied complete identifiers without offering a checkpoint mutation", () => {
    const markup = renderRail(dataSections(RUN_ID, 1, "10000023"));
    assert.ok(markup.includes("10000023"));
    assert.equal(markup.includes("10••••23"), false);
    assert.equal(markup.includes("<input"), false);
    assert.equal(markup.includes("Save"), false);
    assert.equal(markup.includes("correction"), false);
    assert.equal(occurrences(markup, "Recorded source values are read-only."), 4);
  });

  it("widens and narrows using keyboard focus without touching the command client", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const client = {
      itemAttemptHistory: async () => historyWire({
        selectedRunId: RUN_ID, itemId: uuidOf(5001), selectedAttempt: 1,
        entries: [{ runId: RUN_ID, attempt: 1 }],
      }),
    } as unknown as DashboardClient;
    let expanded = false;
    const render = () => root.render(createElement(DashboardClientProvider, { client,
      children: createElement(ToastProvider, { children: createElement(ContextRail, {
        summary: SUMMARY, sections: dataSections(), onClose: () => undefined,
        dataExpanded: expanded, onDataExpandedChange: (value: boolean) => { expanded = value; render(); },
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

describe("Context attempt-history reads", () => {
  it("loads item-wide history through the BFF and typed client while attempt one is selected", async () => {
    const current: DashboardWorld = makeWorld();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const previousSearch = window.location.search;
    const itemId = uuidOf(9800);
    const firstBase = runRecordOf({ seed: 980, attempt: 1, enqueuedAt: "2026-08-03T06:30:00.000Z" });
    const first = RunRecordSchema.parse({ ...firstBase, envelope: { ...firstBase.envelope, itemId } });
    current.database.authority.runs.enqueue(first);
    const secondBase = runRecordOf({ seed: 981, attempt: 2, enqueuedAt: "2026-08-03T07:30:00.000Z" });
    const second = RunRecordSchema.parse({
      ...secondBase,
      envelope: { ...secondBase.envelope, itemId, retryOf: first.envelope.runId },
    });
    current.database.authority.runs.enqueue(second);
    const historyQuery = createItemAttemptHistoryQuery({
      database: current.database,
      reader: sqliteRunReader(current.database, current.clock),
    });
    const app = new Hono<{ Variables: { requestActorId: ReturnType<RequestIdentityCheckpoint["identify"]> } }>();
    const runDetail: RunDetailQueryDeps = {
      itemAttemptHistory: historyQuery,
      stateRoot: current.stateRoot,
      projection: current.projection,
      authority: current.authority,
      descriptors: { resolve: () => undefined },
    };
    registerRunDetailRoutes(app, { runDetail });
    const requests: string[] = [];
    const client = createDashboardClient({
      baseUrl: "http://fixture.test",
      fetchImpl: async (url, init) => {
        requests.push(url);
        return app.fetch(new Request(url, init));
      },
    });
    let rerunAction = ActionDescriptorWireSchema.parse({
      kind: "navigation",
      navigate: { kind: "rerun", expectedVersion: first.version + 1 },
      key: "rerun",
      label: "Rerun",
      intent: "neutral",
      placement: ["data"],
    });
    const handled: Array<{ action: typeof rerunAction; target: { runId: string; expectedVersion: number } }> = [];
    const rail = () => createElement(DashboardClientProvider, {
      client,
      children: createElement(ToastProvider, { children: createElement(ContextRail, {
        summary: SUMMARY,
        sections: dataSections(first.envelope.runId, 1),
        onClose: () => undefined,
        dataExpanded: false,
        onDataExpandedChange: () => undefined,
        actions: [rerunAction],
        target: { runId: first.envelope.runId, expectedVersion: first.version },
        onAction: (action, target) => handled.push({ action, target }),
      }) }),
    });
    window.history.replaceState({}, "", `/?day=2026-09-22&run=${first.envelope.runId}`);

    try {
      await act(async () => {
        root.render(rail());
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      const later = Array.from(host.querySelectorAll("a")).find((anchor) => anchor.textContent === "Attempt 2");
      assert.ok(later, "the attempt-one rail should render its later item retry");
      assert.equal(requests.length, 1);
      assert.match(requests[0] ?? "", new RegExp(`/runs/${first.envelope.runId}/attempt-history\\?limit=50$`, "u"));
      assert.equal(later.getAttribute("href"), `?day=2026-08-03&run=${second.envelope.runId}`);
      assert.equal(Array.from(host.querySelectorAll("button")).some((button) => button.textContent === "Rerun"), false,
        "a rerun action projected from another version is not shown");
      rerunAction = ActionDescriptorWireSchema.parse({
        ...rerunAction,
        navigate: { kind: "rerun", expectedVersion: first.version },
      });
      await act(async () => { root.render(rail()); });
      const rerun = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Rerun");
      assert.ok(rerun);
      await act(async () => { rerun.click(); });
      assert.deepEqual(handled, [{
        action: rerunAction,
        target: { runId: first.envelope.runId, expectedVersion: first.version },
      }]);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      current.dispose();
      window.history.replaceState({}, "", previousSearch.length === 0 ? "/" : `/${previousSearch}`);
    }
  });

  it("opens archives by exact archive route and leaves deleted entries non-openable", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const selectedRunId = "44444444-4444-4444-8444-444444444444";
    const archivedRunId = "55555555-5555-4555-8555-555555555555";
    const deletedRunId = "66666666-6666-4666-8666-666666666666";
    const itemId = uuidOf(5004);
    const previousSearch = window.location.search;
    const client = {
      itemAttemptHistory: async () => historyWire({
        selectedRunId, itemId, selectedAttempt: 2,
        entries: [
          { runId: selectedRunId, attempt: 2 },
          { runId: archivedRunId, attempt: 1, disposition: "archived" },
          { runId: deletedRunId, attempt: null, disposition: "deleted" },
        ],
      }),
    } as unknown as DashboardClient;
    window.history.replaceState({}, "", `/?day=2026-09-22&run=${selectedRunId}`);

    try {
      await act(async () => {
        root.render(createElement(DashboardClientProvider, {
          client,
          children: createElement(ToastProvider, { children: createElement(ContextRail, {
            summary: SUMMARY,
            sections: dataSections(selectedRunId, 2),
            onClose: () => undefined,
            dataExpanded: false,
            onDataExpandedChange: () => undefined,
          }) }),
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const archiveLink = Array.from(host.querySelectorAll("a")).find((anchor) => anchor.textContent === "Attempt 1 · archived");
      assert.ok(archiveLink);
      assert.equal(archiveLink.getAttribute("href"), `?archive=${archivedRunId}&archiveView=runs`);
      const deletedLabel = Array.from(host.querySelectorAll("span")).find((span) => span.textContent === "Deleted run");
      assert.ok(deletedLabel);
      assert.equal(deletedLabel.closest("a"), null);
      assert.equal(Array.from(host.querySelectorAll("a")).some((anchor) => anchor.getAttribute("href")?.includes(deletedRunId)), false);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      window.history.replaceState({}, "", previousSearch.length === 0 ? "/" : `/${previousSearch}`);
    }
  });

  it("does not let a late earlier-page response from the old run enter the newly selected run", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const oldRunId = "22222222-2222-4222-8222-222222222222";
    const newRunId = "33333333-3333-4333-8333-333333333333";
    const oldItemId = uuidOf(5002);
    const newItemId = uuidOf(5003);
    let releaseOldPage: ((response: ItemAttemptHistoryResponse) => void) | undefined;
    const client = {
      itemAttemptHistory: (runId: string, options?: { cursor?: string }) => {
        if (runId === oldRunId && options?.cursor !== undefined) {
          return new Promise<ItemAttemptHistoryResponse>((resolve) => { releaseOldPage = resolve; });
        }
        return Promise.resolve(runId === oldRunId
          ? historyWire({ selectedRunId: oldRunId, itemId: oldItemId, selectedAttempt: 1,
            entries: [{ runId: oldRunId, attempt: 1 }], totalEntries: 2, nextCursor: "old-page" })
          : historyWire({ selectedRunId: newRunId, itemId: newItemId, selectedAttempt: 1,
            entries: [{ runId: newRunId, attempt: 1 }] }));
      },
    } as unknown as DashboardClient;
    let selectedRunId = oldRunId;
    const render = () => root.render(createElement(DashboardClientProvider, {
      client,
      children: createElement(ToastProvider, { children: createElement(ContextRail, {
        summary: SUMMARY,
        sections: dataSections(selectedRunId, 1),
        onClose: () => undefined,
        dataExpanded: false,
        onDataExpandedChange: () => undefined,
      }) }),
    }));

    try {
      await act(async () => {
        render();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      assert.ok(host.textContent?.includes("Show earlier attempts"));
      const earlierButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Show earlier attempts");
      assert.ok(earlierButton);
      await act(async () => { earlierButton.click(); });
      assert.ok(releaseOldPage);

      selectedRunId = newRunId;
      await act(async () => {
        render();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const newLink = Array.from(host.querySelectorAll("a")).find((anchor) => anchor.getAttribute("href")?.includes(newRunId));
      assert.ok(newLink, "the new run's own initial history should be visible");
      await act(async () => {
        releaseOldPage?.(historyWire({ selectedRunId: oldRunId, itemId: oldItemId, selectedAttempt: 1,
          entries: [{ runId: oldRunId, attempt: 7 }], offset: 1, totalEntries: 2 }));
      });
      assert.equal(host.textContent?.includes("Attempt 7"), false);
      assert.ok(Array.from(host.querySelectorAll("a")).some((anchor) => anchor.getAttribute("href")?.includes(newRunId)));
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });
});
