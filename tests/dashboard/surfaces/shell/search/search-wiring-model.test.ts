// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { FIXTURE_DAY_WIRE } from "../../../../support/fixtures/dashboard/fixture-day.js";
import { buildWorkspaceSearchData, useWorkspaceSearchData } from "../../../../../src/dashboard/surfaces/shell/search/search-wiring-model.js";
import { runDisplayId } from "../../../../../src/dashboard/surfaces/shared/status/run-display-model.js";
import { dsStatusOf, statusAccessibleName } from "../../../../../src/dashboard/surfaces/shared/status/status-model.js";
import type { NavbarData } from "../../../../../src/dashboard/surfaces/shell/search/navbar-view-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

const input = () => ({
  today: "2026-08-04",
  day: FIXTURE_DAY_WIRE.day,
  rows: FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.surfaceKind === "single").slice(0, 2),
  workflowLabel: (workflowId: string) => workflowId === "person-lookup" ? "Person Lookup" : workflowId,
});

describe("workspace search wiring", () => {
  it("keeps queue search order, identities, labels, states and destinations", () => {
    const searchInput = input();
    const [queued, running] = searchInput.rows;
    assert.ok(queued && running);

    const data = buildWorkspaceSearchData(searchInput);
    assert.deepEqual(data.results, [
      { id: String(queued.runId), publicId: runDisplayId(queued.runId, queued.traceId), subject: queued.title, workflow: "Person Lookup", day: searchInput.day,
        state: statusAccessibleName(dsStatusOf(queued.status)), destination: { kind: "run", runId: String(queued.runId), day: searchInput.day } },
      { id: String(running.runId), publicId: runDisplayId(running.runId, running.traceId), subject: running.title, workflow: "Person Lookup", day: searchInput.day,
        state: statusAccessibleName(dsStatusOf(running.status)), destination: { kind: "run", runId: String(running.runId), day: searchInput.day } },
    ]);
  });

  it("returns no results while unavailable", () => {
    const data = buildWorkspaceSearchData({ ...input(), unavailable: "Queue data is unavailable." });
    assert.equal(data.unavailable, "Queue data is unavailable.");
    assert.deepEqual(data.counts, {});
    assert.deepEqual(data.results, []);
  });

  it("memoizes identical inputs and refreshes when a search input changes", () => {
    type SearchInput = Parameters<typeof buildWorkspaceSearchData>[0];
    let current: NavbarData | undefined;
    function Harness({ searchInput }: { searchInput: SearchInput }) {
      current = useWorkspaceSearchData(searchInput);
      return null;
    }
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const original = input();
    const render = (searchInput: SearchInput): void => act(() => root?.render(createElement(Harness, { searchInput })));

    render(original);
    const first = current;
    assert.ok(first);
    render({ ...original });
    assert.strictEqual(current, first);
    render({ ...original, day: "2026-08-02" });
    assert.notStrictEqual(current, first);
    assert.equal(current?.results[0]?.day, "2026-08-02");
  });
});
