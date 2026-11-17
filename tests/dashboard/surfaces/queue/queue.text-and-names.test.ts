// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { QueuePanel } from "../../../../src/dashboard/surfaces/queue/queue.js";
import { queueMemberPresentation } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { mockQueueSurface } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { initialMockDraft } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { QueueSurfaceWireSchema } from "../../../../src/models/dashboard/projection.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";

const base = mockQueueSurface({ id: "00000000-0000-4000-8000-000000000041", workflowId: "onboarding", title: "Morrow, Bea", subject: "Morrow, Bea", draft: initialMockDraft("onboarding"), approved: true, seeded: true }, "2026-08-03T10:57:54.000Z");
const SENTENCE = "The system did not show the expected page. Review the current page before continuing.";
const failed = () => QueueSurfaceWireSchema.parse({ ...base, runId: RunIdSchema.parse("00000000-0000-4000-8000-000000000041"), status: "failed",
  endedAt: { state: "present", value: "2026-08-03T10:58:45.000Z" }, liveMessage: { state: "present", value: SENTENCE },
  warnings: { state: "present", count: 1, first: "[ucpath/read-paypath-position] UNEXPECTED_PAGE_STATE: raw detail — write state at failure: not-attempted" } });

it("titles a failed card's chip with the served sentence alone", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(QueuePanel, { surfaces: [failed()], state: { nowIso: "2026-08-03T20:00:00.000Z", openWells: new Set<string>() }, handlers: { onSelect() {} }, workflowLabelOf: () => "Onboarding", panelLabel: "Onboarding" } as never)));
    const titles = [...host.querySelectorAll("[title]")].map(node => node.getAttribute("title") ?? "");
    assert.ok(titles.includes(SENTENCE));
    assert.ok(titles.every(title => !/[[\]]|[A-Z]{2,}_[A-Z_]+|write state/u.test(title)));
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("names a member row as name, workflow, status", () => {
  const surface = QueueSurfaceWireSchema.parse({ ...base, subtitle: { state: "present", value: "person lookup" }, status: "done" });
  const view = queueMemberPresentation({ kind: "run", key: "k", item: { key: "k", representative: surface, attempts: [surface] } } as never, undefined, "Onboarding");
  assert.match(view.accessibleName, /^Morrow, Bea, Onboarding, [a-z ]+$/u);
  assert.doesNotMatch(view.accessibleName, /person lookup/u);
});
