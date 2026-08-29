// @vitest-environment jsdom
/**
 * ENTERING a takeover moves focus into it — the open half of a pair this tree
 * only held the close end of.
 *
 * Settings, Archive, the Explorer and the Activity report were Radix `Dialog`s.
 * A dialog takes focus on open and gives it back on close for free; D272 item 1
 * / D274 item 5 turned all four into routed full-page takeovers, unit F4b
 * re-implemented the CLOSE arm by hand (`settingsCloseFocusTargetId`, pinned in
 * `settings-takeover.test.ts`), and nothing re-implemented the OPEN arm. The
 * result was a page that replaces the whole window while the operator's focus
 * stays on a door that is no longer rendered: the next Tab walks the top bar,
 * and a keyboard operator cannot reach the page they just opened without
 * re-Tabbing the entire shell.
 *
 * `TakeoverFrame` (D275 item 2 — ONE shared wrapper, kept as the accessibility
 * and motion convention) now owns it. The generic claims below test that one
 * owner; the two adoption tests prove the last adopters, intake and the UI
 * catalog, actually cross the boundary and keep their truthful first control.
 * Three claims, and each was run against a mutation of the exact line it pins:
 *
 * 1. **The frame takes focus on mount.** Deleting the `node.focus(...)` call
 *    turns the first two tests red.
 * 2. **It is a focus TARGET, never a tab stop.** Dropping `tabIndex={-1}`
 *    turns THREE of the four red, which is the useful surprise: a bare
 *    `section` is not focusable, so `focus()` silently does nothing and claim
 *    1 collapses with it. The attribute is load-bearing, not decoration.
 * 3. **A descendant that focused itself in the same commit KEEPS focus.**
 *    Deleting the `node.contains(document.activeElement)` guard turns the third
 *    test red — the frame steals focus back off the control the surface
 *    deliberately focused on arrival.
 *
 * A fourth claim earned its place the hard way. Focus was reasoned to be
 * invisible to the parity corpus — the frame carries no `ds-focus` class, so
 * the product's opt-in `.ds-focus:focus-visible` ring never paints. The lane
 * disagreed: 38 references moved, 2548 pixels each, tracing the frame's own
 * perimeter. The ring was CHROMIUM'S, not the product's — a programmatic focus
 * with no preceding pointer interaction matches `:focus-visible`, and the UA's
 * `outline: auto` picked up the base layer's `* { outline-color }`. So opening
 * any takeover drew a ring around the whole page. `outline-none` suppresses it,
 * and the fourth test pins that class: the operator can never tab TO this
 * element, so an indicator on it points at nothing actionable, and it is the
 * region's accessible NAME that announces the arrival.
 *
 * That assertion is a class check, which on its own would be weak — the real
 * proof is the parity lane going green with zero references moved. It lives
 * here so the fast lane catches a deletion in seconds rather than in the 5
 * minutes the reference corpus costs.
 */
import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { CaptureOperatorSessionListWireSchema } from "../../../src/domain/capture-operator.js";
import { FrontendBootstrapWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import { UiCatalogWireSchema } from "../../../src/domain/dashboard/explorer.js";
import { DashboardDayWireSchema } from "../../../src/domain/dashboard/projection.js";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import {
  IMPORT_SPREADSHEET_DOOR_ID,
  UI_CATALOG_DOOR_ID,
  restoreDashboardTakeoverFocus,
} from "../../../src/dashboard/app/dashboard-app-model.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { TakeoverFrame } from "../../../src/dashboard/ds/primitives-layout.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { IntakeWorkspace } from "../../../src/dashboard/surfaces/intake.js";
import { UiCatalogWorkspace } from "../../../src/dashboard/surfaces/ui-catalog.js";

class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);

const FIXTURE_FINGERPRINT = "a".repeat(64);
const APP_BOOTSTRAP = FrontendBootstrapWireSchema.parse({
  wireVersion: 1,
  appVersion: "0.1.0",
  descriptorHash: FIXTURE_FINGERPRINT,
  settingsSchemaHash: FIXTURE_FINGERPRINT,
  projectionGeneration: 1,
  actor: { id: "local-operator", label: "Local operator" },
  serverClock: { now: "2026-08-27T18:00:00.000Z", zone: "America/Los_Angeles" },
  storage: { authority: "healthy", backup: "current", checkedAt: "2026-08-27T18:00:00.000Z" },
  workflows: [{
    id: "fixture-workflow",
    code: "fw",
    label: "Fixture workflow",
    categoryId: "operations",
    descriptorFingerprint: FIXTURE_FINGERPRINT,
    availability: { state: "available" },
    role: { kind: "standalone" },
    start: {
      enqueue: "reject-active",
      version: 1,
      steps: [{
        key: "fixture-step",
        label: "Fixture step",
        includedByDefault: true,
        control: { state: "required", reason: "Fixture step is required." },
      }],
    },
  }],
  systemInstances: [],
  settingsSections: [],
  featureAvailability: [],
});
const APP_DAY = DashboardDayWireSchema.parse({
  day: "2026-08-27",
  descriptorHash: FIXTURE_FINGERPRINT,
  projectionGeneration: 1,
  snapshotCursor: "pc:1",
  monthCounts: [],
  workflowCounts: [{ workflowId: "fixture-workflow", count: 0, statusCounts: [] }],
  statusCounts: [],
  queueSurfaces: [],
  workerCards: [],
  workerPools: [],
  notifications: [],
});
const EMPTY_CAPTURE_SESSIONS = CaptureOperatorSessionListWireSchema.parse({
  wireVersion: 1,
  sessions: [],
});
const EMPTY_UI_CATALOG = UiCatalogWireSchema.parse({
  wireVersion: 1,
  sourcePath: "generated/ui-catalog.json",
  schemaVersion: 1,
  entries: [],
});

let mounted: Root | undefined;

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
});

/** The takeover's own root — the `section` the frame renders and names. */
function frameOf(label: string): HTMLElement {
  const node = document.querySelector(`section[aria-label="${label}"]`);
  assert.ok(node instanceof HTMLElement, `no takeover frame is labelled "${label}"`);
  return node;
}

/**
 * Mounts a takeover the way the shell does: into a host that is already in the
 * document, so `document.activeElement` is a real answer rather than a
 * detached-tree artefact.
 */
async function mountTakeover(label: string, children: ReactNode[]): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(createElement(TakeoverFrame, { label, children }));
  });
}

/**
 * Mounts one real takeover against only the client reads its initial arm owns.
 * The provider remains strict: an unexpected client call still throws rather
 * than falling through a permissive fake.
 */
async function mountSurface(client: DashboardClient, children: ReactNode): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(createElement(DashboardClientProvider, { client, children }));
  });
}

/** The whole app client is closed: an unserved read is a fixture defect, not an empty answer. */
function appClient(): DashboardClient {
  const served = {
    bootstrap: () => Promise.resolve(APP_BOOTSTRAP),
    subscribeDay: (input: Parameters<DashboardClient["subscribeDay"]>[0]) => {
      input.onDay(APP_DAY);
      input.onState({ state: "live" });
      return { close: () => undefined };
    },
    activeCaptureSessions: () => Promise.resolve(EMPTY_CAPTURE_SESSIONS),
    uiCatalog: () => Promise.resolve(EMPTY_UI_CATALOG),
  } as unknown as DashboardClient;
  return new Proxy(served, {
    get(target, property, receiver) {
      if (!(property in target)) {
        throw new Error(`the focus fixture does not serve DashboardClient.${String(property)}`);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

async function mountDashboard(search: string): Promise<void> {
  window.history.replaceState(null, "", `/${search}`);
  await mountSurface(appClient(), createElement(DashboardApp));
  await act(async () => {
    await Promise.resolve();
  });
}

function buttonNamed(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((candidate) => (
    candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label
  ));
  assert.ok(button instanceof HTMLButtonElement, `no button is named "${label}"`);
  return button;
}

async function press(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.focus();
    button.click();
    await Promise.resolve();
  });
}

/**
 * The browser's first Tab from a `tabIndex=-1` frame reaches the first enabled
 * descendant in DOM order. jsdom does not implement Tab navigation, so make
 * that order explicit, focus the same node, and assert the resulting target.
 */
function takeFirstTab(frame: HTMLElement): HTMLElement {
  const first = frame.querySelector<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
  );
  assert.ok(first instanceof HTMLElement, "the takeover has no first Tab target");
  first.focus();
  assert.equal(document.activeElement, first);
  return first;
}

describe("ds/TakeoverFrame — entering a takeover moves focus into it", () => {
  it("focuses its own labelled section on mount", async () => {
    await mountTakeover("Activity report", [
      createElement("button", { key: "b", type: "button" }, "Export"),
    ]);
    assert.equal(document.activeElement, frameOf("Activity report"));
  });

  it("leaves the door it was opened from — focus does not stay on the trigger", async () => {
    // The gear/segment the operator pressed. It stays MOUNTED (the top bar
    // renders it regardless of which takeover is open), which is precisely why
    // a missing focus move is invisible until someone presses Tab.
    const door = document.createElement("button");
    door.type = "button";
    door.id = "the-door";
    document.body.append(door);
    door.focus();
    assert.equal(document.activeElement, door, "the fixture must start with the door focused");

    await mountTakeover("Archive", [createElement("button", { key: "b", type: "button" }, "Back")]);
    assert.notEqual(document.activeElement, door);
    assert.equal(document.activeElement, frameOf("Archive"));
  });

  it("is a focus target, not a tab stop", async () => {
    await mountTakeover("Workflow explorer", []);
    assert.equal(frameOf("Workflow explorer").getAttribute("tabindex"), "-1");
  });

  it("paints no focus ring — the UA's included", async () => {
    await mountTakeover("Workflow explorer", []);
    const cls = frameOf("Workflow explorer").className.split(/\s+/u);
    // Chromium's own `:focus-visible { outline: auto }` matches a programmatic
    // focus. Without this class the ring traced the whole page and moved 38
    // parity references; jsdom computes no UA styles, so the class IS the
    // assertion here and the parity corpus is the proof behind it.
    assert.ok(cls.includes("outline-none"), `the frame must suppress the UA ring: ${cls.join(" ")}`);
    // And it must not have opted INTO the product ring by accident.
    assert.ok(!cls.includes("ds-focus"), "the frame is not an interactive control");
  });

  it("does not steal focus from a descendant that took it in the same commit", async () => {
    // React applies `autoFocus` in the commit phase, before the frame's passive
    // effect runs — the same ordering a surface gets when it focuses a control
    // of its own on arrival. The frame must yield to it.
    await mountTakeover("Settings", [
      createElement("input", { key: "q", type: "search", autoFocus: true, "aria-label": "Search settings" }),
    ]);
    const focused = document.activeElement;
    assert.ok(focused instanceof HTMLInputElement, `expected the search input to keep focus, got ${String(focused?.tagName)}`);
    assert.equal(focused.getAttribute("aria-label"), "Search settings");
    assert.notEqual(focused, frameOf("Settings"));
  });
});

describe("the two remaining takeovers use the shared focus boundary (UF-FU-1)", () => {
  it("Spreadsheet intake upload receives frame focus, then Tab reaches Close first", async () => {
    const client = {
      activeCaptureSessions: () => Promise.resolve({ wireVersion: 1, sessions: [] }),
    } as unknown as DashboardClient;
    await mountSurface(client, createElement(IntakeWorkspace, {
      workflowId: "fixture-workflow",
      workflowLabel: "Fixture workflow",
      actorId: "fixture-operator",
      supportsDryRun: false,
      sessionId: undefined,
      onSession: () => undefined,
      onClose: () => undefined,
      onEnqueued: () => undefined,
    }));

    const frame = frameOf("Spreadsheet intake");
    assert.equal(document.activeElement, frame);
    const first = takeFirstTab(frame);
    assert.equal(first.textContent?.trim(), "Close");
  });

  it("UI catalog receives frame focus, then Tab reaches its Close control first", async () => {
    const client = {
      uiCatalog: () => Promise.resolve({
        wireVersion: 1,
        sourcePath: "generated/ui-catalog.json",
        schemaVersion: 1,
        entries: [],
      }),
    } as unknown as DashboardClient;
    await mountSurface(client, createElement(UiCatalogWorkspace, {
      query: "",
      onQuery: () => undefined,
      view: "selectors",
      onView: () => undefined,
      onClose: () => undefined,
    }));

    const frame = frameOf("UI catalog");
    assert.equal(document.activeElement, frame);
    const first = takeFirstTab(frame);
    assert.equal(first.getAttribute("aria-label"), "Close the UI catalog");
  });
});

describe("closing a route-backed takeover restores its toolbar door", () => {
  it("returns intake focus to Import spreadsheet after the route unmounts", async () => {
    await mountDashboard("?intake=new");
    await press(buttonNamed("Close"));

    const door = buttonNamed("Import spreadsheet");
    assert.equal(door.id, IMPORT_SPREADSHEET_DOOR_ID);
    assert.equal(document.activeElement, door);
  });

  it("returns catalog focus to UI catalog after the route unmounts", async () => {
    await mountDashboard("?catalog=");
    await press(buttonNamed("Close the UI catalog"));

    const door = buttonNamed("UI catalog");
    assert.equal(door.id, UI_CATALOG_DOOR_ID);
    assert.equal(document.activeElement, door);
  });

  it("uses the persistent main region when a deep link has no matching door", () => {
    const main = document.createElement("main");
    main.id = "fixture-main-region";
    main.tabIndex = -1;
    document.body.append(main);

    restoreDashboardTakeoverFocus(document, UI_CATALOG_DOOR_ID, main.id);
    assert.equal(document.activeElement, main);
  });

  it("fails loud when neither the requested door nor the main fallback exists", () => {
    assert.throws(
      () => restoreDashboardTakeoverFocus(
        document,
        IMPORT_SPREADSHEET_DOOR_ID,
        "missing-main-region",
      ),
      /neither dashboard-import-spreadsheet-door nor missing-main-region is mounted/u,
    );
  });
});
