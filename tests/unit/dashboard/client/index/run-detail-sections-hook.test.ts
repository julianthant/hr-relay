// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import {
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
  type RunDetailSectionResponse,
  type RunDetailWire,
} from "../../../../../src/models/dashboard/run-detail.js";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { usePanelSections } from "../../../../../src/dashboard/app/use-panel-sections.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const RUN_A = "00000000-0000-4000-8000-000000000314";
const RUN_B = "00000000-0000-4000-8000-000000000315";
const roots: Root[] = [];

function detail(runId: string, rowRevision: number): RunDetailWire {
  return RunDetailWireSchema.parse({
    runId,
    rowRevision,
    panelKind: "run",
    header: {
      runId,
      traceId: "pl-100001-0314",
      workflowId: "person-lookup",
      actorId: "local-operator",
      title: "Section hook fixture",
      status: "queued",
      attempt: 1,
    },
    timeline: { events: [] },
    gate: { state: "absent", reason: "not started" },
    outcome: { state: "absent", reason: "not started" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
    availableSections: ["logs"],
  });
}

function logPage(runId: string): RunDetailSectionResponse {
  return RunDetailSectionResponseSchema.parse({
    section: "logs",
    payload: { runId, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } },
  });
}

interface PendingRead {
  readonly runId: string;
  readonly resolve: (response: RunDetailSectionResponse) => void;
}

function pendingClient(reads: PendingRead[]): DashboardClient {
  return {
    runSection(runId: string): Promise<RunDetailSectionResponse> {
      return new Promise((resolve) => reads.push({ runId, resolve }));
    },
  } as unknown as DashboardClient;
}

function SectionProbe({ detail: run, report }: {
  readonly detail: RunDetailWire;
  readonly report: (value: string) => void;
}) {
  const state = usePanelSections(run, "logs");
  const value = `${run.runId}:${state.sections.logs?.runId ?? "empty"}`;
  report(value);
  return createElement("output", null, value);
}

async function resolveRead(read: PendingRead): Promise<void> {
  await act(async () => {
    read.resolve(logPage(read.runId));
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

describe("run-detail section hook registration", () => {
  it("masks a previous run immediately while retaining same-run sections through revision refresh", async () => {
    const reads: PendingRead[] = [];
    const observations: string[] = [];
    const client = pendingClient(reads);
    const container = document.createElement("div");
    const root = createRoot(container);
    roots.push(root);
    const render = (run: RunDetailWire) => root.render(createElement(DashboardClientProvider, {
      client,
      children: createElement(SectionProbe, { detail: run, report: (value) => observations.push(value) }),
    }));

    await act(async () => render(detail(RUN_A, 1)));
    const firstA = reads.find((read) => read.runId === RUN_A);
    assert.ok(firstA, "first run sections were requested");
    await resolveRead(firstA);
    assert.equal(container.textContent, `${RUN_A}:${RUN_A}`);

    await act(async () => render(detail(RUN_A, 2)));
    assert.equal(container.textContent, `${RUN_A}:${RUN_A}`, "same-run revision refresh retains the served section");
    const refreshedA = reads.filter((read) => read.runId === RUN_A).at(-1);
    assert.ok(refreshedA && refreshedA !== firstA, "new revision starts a fresh section read");

    await act(async () => render(detail(RUN_B, 1)));
    assert.equal(container.textContent, `${RUN_B}:empty`, "run switch clears old sections during render, before its effect fetches");
    const firstB = reads.find((read) => read.runId === RUN_B);
    assert.ok(firstB, "selected run sections were requested");
    await resolveRead(firstB);
    assert.equal(container.textContent, `${RUN_B}:${RUN_B}`);

    await resolveRead(refreshedA);
    assert.equal(container.textContent, `${RUN_B}:${RUN_B}`, "late previous-run responses cannot overwrite the selected run");
    assert.ok(observations.includes(`${RUN_B}:empty`), "the switch render itself did not expose the previous run's section");
  });
});
