// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { VirtuosoMockContext } from "react-virtuoso";
import { it } from "vitest";
import { QueuePanel } from "../../../../src/dashboard/surfaces/queue/queue.js";
import { QueueSurfaceWireSchema } from "../../../../src/models/dashboard/projection.js";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const absent = (reason: string) => ({ state: "absent", reason });
const now = "2026-08-03T18:00:00.000Z";
const surfaces = Array.from({ length: 300 }, (_, index) => QueueSurfaceWireSchema.parse({
  runId: uuid(index + 1), itemId: uuid(index + 1), workflowId: "windowed-fixture", traceId: `wf-100001-${String(index).padStart(4, "0")}`, attempt: 1, parent: null,
  actorId: "fixture", appVersion: { state: "present", value: "0.1.0" }, descriptorVersion: 1, descriptorHash: "a".repeat(64), configFingerprint: "b".repeat(64),
  resolvedInstances: [], dryRun: true, priority: "interactive", runNumber: { state: "present", value: index + 1 }, session: absent("No session"), linkedRuns: [], facts: absent("No result"),
  startedAt: now, updatedAt: now, endedAt: absent("Not ended"), operatorWait: { state: "absent" }, gateOpenedAt: absent("No gate"),
  displayName: absent("Not renamed"), title: `Record ${index}`, subtitle: absent("No subtitle"), status: "queued", liveMessage: absent("No message"), warnings: absent("No warnings"),
  pipeline: [], panelKind: "run", availableSections: ["logs"], actions: [], rowRevision: 1, surfaceKind: "single",
}));
const openWells = new Set<string>();
const label = () => "Windowed fixture";

it("mounts a window of a long day and brings a keyboard selection past its edge into view", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = (selectedRunId?: string) => act(async () => root.render(createElement(VirtuosoMockContext.Provider, { value: { viewportHeight: 600, itemHeight: 120 } },
    createElement(QueuePanel, { surfaces, panelLabel: "Windowed fixture", day: "2026-08-03", state: { selectedRunId, nowIso: now, openWells }, handlers: { onSelect: () => undefined }, workflowLabelOf: label }))));
  const mounted = () => [...host.querySelectorAll<HTMLElement>("[data-demo-row-id]")].map(row => row.dataset.demoRowId);
  const pressed = () => host.querySelector('[data-queue-open][aria-pressed="true"]')?.closest<HTMLElement>("[data-demo-row-id]")?.dataset.demoRowId;
  try {
    await render();
    const scroller = host.querySelector<HTMLElement>("[data-queue-scroll]");
    if (!scroller) throw new Error("queue scroller missing");
    // jsdom has no layout: give the scroller the mocked viewport, keep scrollTop as written and tell the list it moved.
    Object.defineProperties(scroller, { offsetHeight: { value: 600 }, scrollHeight: { value: 300 * 120 } });
    scroller.getBoundingClientRect = () => DOMRect.fromRect({ width: 420, height: 600 });
    scroller.scrollTo = (options?: ScrollToOptions | number) => {
      if (typeof options === "object" && options.top !== undefined) scroller.scrollTop = options.top;
      scroller.dispatchEvent(new Event("scroll"));
    };
    assert.ok(mounted().length < 30, "a long day mounts a window, not every row");
    assert.equal(mounted().includes(uuid(251)), false, "the target starts outside the window");

    await render(uuid(251));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.ok(mounted().includes(uuid(251)), "selecting a row outside the window brings it in");
    assert.equal(pressed(), uuid(251));

    await render(uuid(252));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.equal(pressed(), uuid(252), "the next key step selects the neighbour inside the new window");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
