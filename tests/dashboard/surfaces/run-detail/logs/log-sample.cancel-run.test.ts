// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, it, vi } from "vitest";
import { TooltipProvider } from "../../../../../src/dashboard/ds/ui.js";
import { LogSample } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import { QueueSurfaceWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { RunDecisionWireSchema } from "../../../../../src/models/dashboard/run-decision.js";
import { FIXTURE_DAY_WIRE } from "../../../../support/fixtures/dashboard/fixture-day.js";

const { useRunWiring, projectRunLogs } = vi.hoisted(() => ({ useRunWiring: vi.fn(), projectRunLogs: vi.fn() }));
vi.mock("../../../../../src/dashboard/state/client-context.js", () => ({ useDashboardClient: () => ({}), useDashboardCommandBinding: () => undefined }));
vi.mock("../../../../../src/dashboard/state/run-wiring-adapter.js", () => ({ projectRunLogs, useRunWiring }));
vi.mock("../../../../../src/dashboard/surfaces/run-detail/review/review.js", () => ({ RunReview: () => null }));

const CONFIRM = { title: "Cancel this run", body: "It stops.", confirmLabel: "Cancel the run", tone: "destructive" };
const base = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.status === "running")!;
const cancel = { key: "cancel", label: "Cancel run", kind: "command", command: "cancel", expectedVersion: base.rowRevision, intent: "destructive", icon: "cancel", placement: ["footer"], confirm: CONFIRM };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useRunWiring.mockReset(); projectRunLogs.mockReset();
  useRunWiring.mockReturnValue({ state: "loaded", snapshot: { detail: { header: { title: "Lookup" }, availableSections: ["logs"] }, logs: {}, unavailableEvidence: [] } });
  const served = RunDecisionWireSchema.parse({ type: "write-parked", title: "Did it save?",
    options: [{ id: "check-again", label: "Check again", hint: "Read it again.", send: { via: "action", actionKey: "a" } }] });
  projectRunLogs.mockReturnValue({ timeline: [], steps: [{ id: "d", time: "09:00", title: "Did it save?", entries: [{ kind: "decision", id: "d", time: "09:00", decision: { title: "Did it save?", state: "parked", served } }] }] });
});

it("cancels the run at once from a decision card, without the queue card's confirm", async () => {
  const row = QueueSurfaceWireSchema.parse({ ...base, actions: [...base.actions.filter(action => !(action.kind === "command" && action.command === "cancel")), cancel] });
  const sent: unknown[] = [];
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(LogSample, { source: "served", selection: { row, workflowLabel: "Person Lookup" }, onAction: (action: unknown) => sent.push(action) } as never))));
    const button = [...host.querySelectorAll("button")].find(node => node.textContent === "Cancel run")!;
    await act(async () => button.click());
    assert.equal(sent.length, 1);
    const action = sent[0] as { command: string; confirm?: unknown };
    assert.equal(action.command, "cancel");
    assert.equal(action.confirm, undefined);
    assert.ok(row.actions.some(candidate => candidate.key === "cancel" && "confirm" in candidate));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
