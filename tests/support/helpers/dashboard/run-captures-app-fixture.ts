/** Closed synthetic HTTP/SSE boundary for the REAL DashboardApp and typed client.
 * No client method, parser, hook, or component is replaced. DOM declarations
 * are observable here; this fixture provides no browser layout/decode proof. */
import { CalendarWireSchema } from "../../../../src/models/dashboard/calendar.js";
import { FIXTURE_EDITABLE_SETTINGS, FIXTURE_STORAGE_RELOCATION } from "../../fixtures/dashboard/fixture-settings.js";
import assert from "node:assert/strict";
import { act, createElement, Fragment, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { z } from "zod";
import { DashboardApp } from "../../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { FrontendBootstrapWireSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema } from "../../../../src/models/dashboard/projection.js";
import { RunCaptureArtifactWireSchema, RunDetailWireSchema, type RunDetailWire } from "../../../../src/models/dashboard/run-detail.js";

export const CAPTURE_RUN_A = "00000000-0000-4000-8000-000000000701";
export const CAPTURE_RUN_B = "00000000-0000-4000-8000-000000000702";
export const CAPTURE_ARTIFACT_A = "00000000-0000-4000-8000-000000000711";
export const CAPTURE_ARTIFACT_B = "00000000-0000-4000-8000-000000000712";
export const CAPTURE_BUNDLE_A = "00000000-0000-4000-8000-000000000721";
export const CAPTURE_BUNDLE_B = "00000000-0000-4000-8000-000000000722";
export const CAPTURE_BASE_URL = "http://capture-app.test";
const NOW = "2026-08-30T18:00:00.000Z";
const HASH = "a".repeat(64);

export function captureData(artifactId = CAPTURE_ARTIFACT_A) {
  return RunCaptureArtifactWireSchema.parse({
    artifact: { artifactId, mediaKind: "data", mediaType: "application/json", byteLength: 2,
      sha256: "b".repeat(64), sensitivity: "restricted", redaction: "restricted-access" },
    origins: [{ bundleId: CAPTURE_BUNDLE_A, originKind: "unexpected-state" },
      { bundleId: CAPTURE_BUNDLE_B, originKind: "operator-request" }],
  });
}

export function captureImage(artifactId = CAPTURE_ARTIFACT_A) {
  return RunCaptureArtifactWireSchema.parse({
    artifact: { artifactId, mediaKind: "image", mediaType: "image/png", byteLength: 68,
      sha256: "c".repeat(64), sensitivity: "safe", redaction: "not-required", width: 320, height: 240 },
    origins: [{ bundleId: CAPTURE_BUNDLE_A, originKind: "operator-request" }],
  });
}

/** These synthetic natural dimensions exercise callbacks, not a browser decoder. */
export async function signalImageLoad(image: HTMLImageElement, decode: () => Promise<void>, width = 320, height = 240) {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width }, naturalHeight: { configurable: true, value: height },
    decode: { configurable: true, value: decode },
  });
  await act(async () => { image.dispatchEvent(new Event("load")); });
}

const BOOTSTRAP = FrontendBootstrapWireSchema.parse({
  wireVersion: 1, appVersion: "0.1.0", descriptorHash: HASH, settingsSchemaHash: HASH,
  protectedSchemaHash: HASH,
  projectionGeneration: 1, actor: { id: "local-operator", label: "Local operator" },
  serverClock: { now: NOW, zone: "America/Los_Angeles" },
  storage: { authority: "healthy", backup: "current", checkedAt: NOW },
  workflows: [{ id: "fixture-workflow", code: "fw", label: "Fixture workflow", categoryId: "operations",
    descriptorFingerprint: HASH, availability: { state: "available" }, role: { kind: "standalone" },
    start: {
      enqueue: "reject-active",
      version: 1,
      // D296 — the captures fixture is about the run detail, not the launcher.
      spreadsheetIntake: false,
      steps: [{
        key: "fixture-step",
        label: "Fixture step",
        includedByDefault: true,
        control: { state: "required", reason: "The fixture workflow always runs this step." },
      }],
    } }],
  systemInstances: [], settingsSections: [], featureAvailability: [],
});
export const CAPTURE_DAY = DashboardDayWireSchema.parse({
  day: "2026-08-30", descriptorHash: HASH, projectionGeneration: 1, snapshotCursor: "pc:1",
  monthCounts: [], workflowCounts: [{ workflowId: "fixture-workflow", count: 0, statusCounts: [] }],
  statusCounts: [], queueSurfaces: [], workerCards: [], workerPools: [], notifications: [],
});

export function captureDayRevision(runId: string, rowRevision: number) {
  const counts = [{ status: "queued", count: 1 }];
  return DashboardDayWireSchema.parse({ ...CAPTURE_DAY,
    workflowCounts: [{ workflowId: "fixture-workflow", count: 1, statusCounts: counts }], statusCounts: counts,
    queueSurfaces: [{
      runId, itemId: runId, workflowId: "fixture-workflow",
      traceId: "fw-100001-0000", attempt: 1, lineage: { state: "root" }, actorId: "local-operator",
      appVersion: { state: "present", value: "0.1.0" }, descriptorVersion: 1, descriptorHash: HASH,
      configFingerprint: HASH, resolvedInstances: [], dryRun: false, priority: "interactive",
      runNumber: { state: "present", value: 1 }, session: { state: "absent", reason: "Synthetic run has no session" },
      containment: "root", linkedRuns: [], facts: { state: "absent", reason: "Not settled" },
      startedAt: NOW, updatedAt: NOW, endedAt: { state: "absent", reason: "Not ended" },
      gateOpenedAt: { state: "absent", reason: "No gate" }, displayName: { state: "absent", reason: "Not renamed" },
      title: `Synthetic capture run ${runId}`, subtitle: { state: "absent", reason: "No subtitle" }, status: "queued",
      liveMessage: { state: "absent", reason: "No message" }, warnings: { state: "absent", reason: "Not settled" },
      pipeline: [], panelKind: "run", availableSections: ["logs", "receipt", "captures"], actions: [],
      rowRevision, surfaceKind: "single",
    }],
  });
}

export function captureDetail(runId = CAPTURE_RUN_A, overrides: Partial<z.input<typeof RunDetailWireSchema>> = {}): RunDetailWire {
  return RunDetailWireSchema.parse({
    runId, rowRevision: 1, panelKind: "run",
    header: { runId, traceId: "fw-100001-0000", workflowId: "fixture-workflow", actorId: "local-operator",
      title: `Synthetic capture run ${runId}`, status: "queued", attempt: 1 },
    timeline: { events: [] }, gate: { state: "absent", reason: "not started" },
    outcome: { state: "absent", reason: "not started" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
    captures: { state: "available", artifactCount: 1 }, availableSections: ["logs", "receipt", "captures"],
    ...overrides,
  });
}

export interface CaptureHttpRequest { readonly url: string; readonly signal: AbortSignal | null | undefined }
export interface CaptureAppRun {
  readonly detail: () => unknown;
  readonly captures: (request: CaptureHttpRequest) => Promise<Response>;
  readonly receipt?: () => unknown;
}

export function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class DeclarationOnlyResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Test-only failure control in the real root's effect cleanup, not a fake root. */
function CaptureFixtureLifetime({ onMount, onUnmount }: { onMount: (() => void) | undefined; onUnmount: (() => void) | undefined }) {
  useEffect(() => { onMount?.(); return () => { onUnmount?.(); }; }, [onMount, onUnmount]);
  return null;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "non-Error failure";
}

export async function mountCaptureApp(input: {
  readonly runId: string;
  readonly runs: ReadonlyMap<string, CaptureAppRun>;
  readonly section?: "logs" | "receipt";
  readonly onUnmount?: () => void;
  readonly onMount?: () => void;
}) {
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  const priorResize = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const priorUrl = window.location.href;
  const priorHistoryState: unknown = window.history.state;
  const priorChildren = [...document.body.childNodes];
  const counts=[{status:"queued",count:input.runs.size}];
  const selectedDay=DashboardDayWireSchema.parse({...captureDayRevision(input.runId,1),
    queueSurfaces:[...input.runs.keys()].flatMap(runId=>captureDayRevision(runId,1).queueSurfaces),
    statusCounts:counts,workflowCounts:[{workflowId:"fixture-workflow",count:input.runs.size,statusCounts:counts}],
  });
  const requests: CaptureHttpRequest[] = [];
  const unexpected: string[] = [];
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const client = createDashboardClient({ baseUrl: CAPTURE_BASE_URL, fetchImpl: async (url, init) => {
    const request = { url, signal: init?.signal };
    requests.push(request);
    if (url === `${CAPTURE_BASE_URL}/api/v1/bootstrap`) return Response.json(BOOTSTRAP);
    if (url === `${CAPTURE_BASE_URL}/api/v1/preflight`) return Response.json({error:"capture-fixture-preflight-unavailable"},{status:503});
    if (url === `${CAPTURE_BASE_URL}/api/v1/settings/editable`) return Response.json(FIXTURE_EDITABLE_SETTINGS);
    if (url === `${CAPTURE_BASE_URL}/api/v1/settings/storage-relocation`) return Response.json(FIXTURE_STORAGE_RELOCATION);
    if (url === `${CAPTURE_BASE_URL}/api/v1/calendar?month=2026-08&day=2026-08-30`) return Response.json(CalendarWireSchema.parse({
      month:"2026-08",day:"2026-08-30",today:"2026-08-30",authorityGeneration:1,
      monthCounts:selectedDay.monthCounts,firstDay:"2026-08-30",lastDay:"2026-08-30",previousDay:null,nextDay:null,
    }));
    if (url === `${CAPTURE_BASE_URL}/events/v1?topics=dashboard-day:2026-08-30`) {
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        stream = controller;
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
          type: "snapshot", topic: "dashboard-day", cursor: "pc:1", payload: selectedDay,
        })}\n\n`));
        init?.signal?.addEventListener("abort", () => { controller.close(); }, { once: true });
      } });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    for (const [runId, run] of input.runs) {
      const path = `${CAPTURE_BASE_URL}/api/v1/runs/${runId}`;
      if (url === path) return Response.json(run.detail());
      if (url === `${path}/captures`) return run.captures(request);
      if (url === `${path}/receipt`) return Response.json({ section: "receipt", payload:
        run.receipt === undefined ? { state: "missing", reason: "Synthetic run has no full receipt yet" } : run.receipt() });
      if (url === `${path}/logs`) return Response.json({ section: "logs", payload: { runId, rows: [], notes: [] } });
    }
    unexpected.push(url);
    throw new Error(`Closed capture-app fixture has no response for ${url}`);
  } });
  const host = document.createElement("div");
  let root: Root | undefined;
  const unmount = async () => {
    const failures: unknown[] = [];
    try { await act(async () => { root?.unmount(); }); } catch (error) { failures.push(error); }
    finally { root = undefined; }
    try { host.remove(); } catch (error) { failures.push(error); }
    try { window.history.replaceState(priorHistoryState, "", priorUrl); } catch (error) { failures.push(error); }
    for (const [key, descriptor] of [["IS_REACT_ACT_ENVIRONMENT", priorAct], ["ResizeObserver", priorResize]] as const) {
      try {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
        else Object.defineProperty(globalThis, key, descriptor);
      } catch (error) { failures.push(error); }
    }
    try {
      const children = [...document.body.childNodes];
      assert.equal(children.length === priorChildren.length && children.every((node, i) => node === priorChildren[i]), true,
        "Capture app cleanup left a portal or changed foreign DOM; no foreign node was removed as cleanup");
      assert.deepEqual(unexpected, [], "the app crossed an undeclared fixture boundary");
    } catch (error) { failures.push(error); }
    if (failures.length > 0) {
      throw new AggregateError(failures, `Capture app cleanup failed: ${failures.map(failureMessage).join("; ")}`);
    }
  };
  try {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    Reflect.set(globalThis, "ResizeObserver", DeclarationOnlyResizeObserver);
    document.body.append(host);
    window.history.replaceState(null, "", `/?day=2026-08-30&run=${input.runId}&section=${input.section ?? "logs"}`);
    const mounted = createRoot(host);
    root = mounted;
    await act(async () => { mounted.render(createElement(DashboardClientProvider, {
      client, children: createElement(Fragment, null, createElement(DashboardApp),
        createElement(CaptureFixtureLifetime, { onMount: input.onMount, onUnmount: input.onUnmount })),
    })); });
  } catch (error) {
    try { await unmount(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Capture app mount and cleanup failed: ${failureMessage(error)}; ${failureMessage(cleanupError)}`, { cause: cleanupError });
    }
    throw error;
  }
  return { client, host, requests, unmount,
    async navigate(runId: string | undefined) {
      await act(async () => {
        const historyState: unknown = window.history.state;
        assert.ok(typeof historyState === "object" && historyState !== null, "the mounted dashboard must own history state");
        const routeCursor: unknown = Reflect.get(historyState, "hrDashboardRouteCursor");
        assert.ok(typeof routeCursor === "number", "the mounted dashboard must own a route cursor");
        window.history.pushState(
          { hrDashboardRouteCursor: routeCursor + 1 },
          "",
          runId === undefined ? "/?day=2026-08-30" : `/?day=2026-08-30&run=${runId}&section=receipt`,
        );
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    },
    async publishDay(day: unknown) {
      assert.ok(stream, "the real day subscription must be open");
      const controller = stream;
      await act(async () => { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
        type: "snapshot", topic: "dashboard-day", cursor: "pc:2", payload: DashboardDayWireSchema.parse(day),
      })}\n\n`)); });
    },
  };
}

export function captureButton(label: string, within: ParentNode = document): HTMLButtonElement {
  const button = [...within.querySelectorAll("button")].find(node =>
    node.getAttribute("aria-label") === label || node.textContent?.trim() === label);
  assert.ok(button instanceof HTMLButtonElement, `missing native button: ${label}`);
  return button;
}

export function captureDialog(): HTMLElement {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find(node => node.querySelector("h2")?.textContent === "Run capture");
  assert.ok(dialog instanceof HTMLElement, "missing named Run capture dialog");
  return dialog;
}

export async function pressCaptureControl(button: HTMLButtonElement) {
  await act(async () => { button.focus(); button.click(); });
}
