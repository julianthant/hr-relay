// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { TooltipProvider } from "../../../../../src/dashboard/ds/ui.js";
import { LogSample } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import { createServedClock, ServedClockContext } from "../../../../../src/dashboard/state/served-clock.js";
import { QueueSurfaceWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY_WIRE } from "../../../../support/fixtures/dashboard/fixture-day.js";

const { useRunWiring, projectRunLogs } = vi.hoisted(() => ({ useRunWiring: vi.fn(), projectRunLogs: vi.fn() }));
vi.mock("../../../../../src/dashboard/state/client-context.js", () => ({ useDashboardClient: () => ({}), useDashboardCommandBinding: () => undefined }));
vi.mock("../../../../../src/dashboard/state/run-wiring-adapter.js", () => ({ projectRunLogs, useRunWiring }));
vi.mock("../../../../../src/dashboard/surfaces/run-detail/review/review.js", () => ({ RunReview: () => null }));

const running = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.status === "running")!;
const SINCE = "2026-11-27T10:00:00.000Z";
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useRunWiring.mockReturnValue({ state: "loaded", snapshot: { detail: { header: { title: "Lookup" }, availableSections: ["logs"] }, logs: {}, unavailableEvidence: [] } });
  projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => { vi.useRealTimers(); host.remove(); });

describe("Needs Duo banner in Logs", () => {
  it("names the system, ticks the elapsed time and has no button", async () => {
    const row = QueueSurfaceWireSchema.parse({ ...running, updatedAt: "2026-11-27T10:00:05.000Z",
      operatorWait: { state: "present", kind: "duo", system: "ucpath", since: SINCE } });
    const clock = createServedClock("2026-11-27T10:00:05.000Z");
    const root = createRoot(host);
    await act(async () => root.render(createElement(ServedClockContext.Provider, { value: clock },
      createElement(TooltipProvider, null, createElement(LogSample, { selection: { row, workflowLabel: "Person Lookup" } })))));
    assert.match(host.textContent ?? "", /Approving Duo for UCPath/u);
    assert.match(host.textContent ?? "", /Waiting 5s/u);
    await act(async () => { vi.advanceTimersByTime(125_000); });
    assert.match(host.textContent ?? "", /Waiting 2m 10s/u);
    const live = [...host.querySelectorAll('[role="status"]')].find(node => /Approving Duo/u.test(node.textContent ?? ""));
    assert.ok(live);
    assert.equal(live.querySelectorAll('button, a[href], [role="button"], [role="link"]').length, 0);
    // A tick must not announce: the live region's elapsed text is aria-hidden and the readable copy sits outside it.
    const ticking = [...live.querySelectorAll("span")].filter(span => /^Waiting /u.test(span.textContent ?? ""));
    assert.ok(ticking.length > 0 && ticking.every(span => span.closest('[aria-hidden="true"]') !== null));
    const readable = [...host.querySelectorAll(".sr-only")].find(span => /^Waiting 2m 10s$/u.test(span.textContent ?? ""));
    assert.ok(readable && !live.contains(readable));
    assert.doesNotMatch(host.textContent ?? "", /Approve|Retry Duo/u);
    await act(async () => root.unmount());
  });
});
