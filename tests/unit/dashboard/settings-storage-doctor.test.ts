// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SettingsPage } from "../../../src/dashboard/surfaces/settings.js";
import {
  SettingsSectionPrimitiveSchema,
  StorageHealthSummaryWireSchema,
} from "../../../src/domain/dashboard/bootstrap.js";
import {
  StorageDoctorWireSchema,
  type StorageDoctorWire,
} from "../../../src/domain/dashboard/storage.js";

class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const STORAGE = StorageHealthSummaryWireSchema.parse({
  authority: "healthy",
  backup: "current",
  checkedAt: "2026-08-31T16:00:00.000Z",
});
const SECTIONS = SettingsSectionPrimitiveSchema.array().parse([
  { id: "storage", label: "Storage", revision: 1 },
]);

const REPORT_BASE = {
  mode: "read-only",
  checkedAt: "2026-08-31T16:01:00.000Z",
  authority: {
    state: "healthy",
    schemaVersion: 27,
    authorityGeneration: 41,
    pageCount: 12,
  },
  counts: {
    state: "available",
    values: {
      pendingCommands: 0,
      unresolvedWriteIntents: 0,
      leases: 0,
      durableOutbox: 0,
      runTerminalOutbox: 0,
      providerReservations: 0,
      artifactOutbox: 0,
      captureFinalizationOutboxes: 0,
    },
  },
  backup: {
    state: "missing",
    cause: { code: "backup-missing", summary: "no verified backup is present" },
  },
  restoreCandidates: [],
  service: { state: "never-run", reason: "backup service has not run" },
} as const;

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
});

async function mountDoctor(report: StorageDoctorWire): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  const client = {
    editableSettings: () => Promise.reject(new Error("editable settings are outside this fixture")),
    storageDoctor: () => Promise.resolve(report),
  } as unknown as DashboardClient;
  await act(async () => {
    root = createRoot(host as HTMLElement);
    root.render(createElement(DashboardClientProvider, {
      client,
      children: createElement(SettingsPage, {
        storage: STORAGE,
        sections: SECTIONS,
        workflowLabels: new Map<string, string>(),
        section: "storage",
        actorId: "local-operator",
        descriptorFingerprint: "a".repeat(64),
        preflight: [],
        onSection: () => undefined,
        onClose: () => undefined,
      }),
    }));
  });
  const run = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === "Run storage doctor");
  if (!(run instanceof HTMLButtonElement)) throw new Error("storage doctor action is missing");
  await act(async () => { run.click(); });
  return host;
}

describe("loaded Settings storage doctor", () => {
  it("renders every degraded span-authority diagnosis with exact counts and identifying facts", async () => {
    const report = StorageDoctorWireSchema.parse({
      ...REPORT_BASE,
      spanAuthority: {
        state: "degraded",
        streamRunCount: 11,
        liveRunCount: 7,
        archived: [{
          runId: "00000000-0000-4000-8000-000000000101",
          archivedAt: "2026-08-31T15:00:00.000Z",
        }],
        problems: [
          { state: "missing", runId: "00000000-0000-4000-8000-000000000102" },
          { state: "missing-span", runId: "00000000-0000-4000-8000-000000000103" },
          {
            state: "malformed-authority",
            source: "archived",
            recordKey: "record-digest-8dc3",
            summary: "archived authority record failed strict parsing",
          },
          {
            state: "malformed",
            runId: "00000000-0000-4000-8000-000000000104",
            table: "span_stream",
            summary: "queued root ordering is contradictory",
          },
        ],
      },
    });

    const dom = await mountDoctor(report);
    const text = dom.textContent ?? "";
    assert.match(text, /Span authority degraded/u);
    assert.equal(
      dom.querySelector('section[aria-labelledby="span-authority-title"]')?.getAttribute("aria-live"),
      "polite",
    );
    assert.match(text, /11 stream runs/u);
    assert.match(text, /7 live authority runs/u);
    assert.match(text, /1 archived run/u);
    const archived = [...dom.querySelectorAll("details")].find(
      (candidate) => candidate.querySelector("summary")?.textContent === "1 archived run",
    );
    assert.ok(archived instanceof HTMLDetailsElement, "archived accounting has no reachable disclosure");
    await act(async () => { archived.querySelector("summary")?.click(); });
    assert.equal(archived.open, true);
    assert.match(archived.textContent ?? "", /00000000-0000-4000-8000-000000000101/u);
    assert.match(text, /missing.*00000000-0000-4000-8000-000000000102/u);
    assert.match(text, /missing-span.*00000000-0000-4000-8000-000000000103/u);
    assert.match(text, /malformed-authority.*archived.*record-digest-8dc3.*archived authority record failed strict parsing/u);
    assert.match(text, /malformed.*span_stream.*00000000-0000-4000-8000-000000000104.*queued root ordering is contradictory/u);
    assert.equal(dom.querySelectorAll('[aria-label="Span authority problems"] > li').length, 4);
  });

  it("renders reconciled span authority with exact live, stream, and archived accounting", async () => {
    const report = StorageDoctorWireSchema.parse({
      ...REPORT_BASE,
      spanAuthority: {
        state: "reconciled",
        streamRunCount: 4,
        liveRunCount: 2,
        archived: [
          {
            runId: "00000000-0000-4000-8000-000000000201",
            archivedAt: "2026-08-31T14:00:00.000Z",
          },
          {
            runId: "00000000-0000-4000-8000-000000000202",
            archivedAt: "2026-08-30T14:00:00.000Z",
          },
        ],
      },
    });

    const dom = await mountDoctor(report);
    const text = dom.textContent ?? "";
    assert.match(text, /Span authority reconciled/u);
    assert.match(text, /4 stream runs/u);
    assert.match(text, /2 live authority runs/u);
    const archived = [...dom.querySelectorAll("details")].find(
      (candidate) => candidate.querySelector("summary")?.textContent === "2 archived runs",
    );
    assert.ok(archived instanceof HTMLDetailsElement, "reconciled archive accounting has no reachable disclosure");
    await act(async () => { archived.querySelector("summary")?.click(); });
    assert.equal(archived.open, true);
    assert.match(archived.textContent ?? "", /00000000-0000-4000-8000-000000000201/u);
    assert.match(archived.textContent ?? "", /00000000-0000-4000-8000-000000000202/u);
    assert.match(archived.textContent ?? "", /Aug 31/u);
    assert.match(archived.textContent ?? "", /Aug 30/u);
    const archivedRows = archived.querySelectorAll("li");
    assert.equal(archivedRows[0]?.title, "2026-08-31T14:00:00.000Z");
    assert.equal(archivedRows[1]?.title, "2026-08-30T14:00:00.000Z");
    assert.equal(dom.querySelector('[aria-label="Span authority problems"]'), null);
  });

  it("renders unavailable span authority as its exact cause rather than empty or reconciled evidence", async () => {
    const report = StorageDoctorWireSchema.parse({
      ...REPORT_BASE,
      spanAuthority: {
        state: "unavailable",
        cause: {
          code: "span-stream-invalid",
          summary: "span corpus directory spans is not a regular no-follow directory",
        },
      },
    });

    const dom = await mountDoctor(report);
    const text = dom.textContent ?? "";
    assert.match(text, /Span authority unavailable/u);
    assert.match(text, /span-stream-invalid/u);
    assert.match(text, /span corpus directory spans is not a regular no-follow directory/u);
    assert.doesNotMatch(text, /Span authority reconciled/u);
    assert.doesNotMatch(text, /stream runs|live authority runs|archived runs?/u);
    assert.equal(dom.querySelector('[aria-label="Span authority problems"]'), null);
  });
});
