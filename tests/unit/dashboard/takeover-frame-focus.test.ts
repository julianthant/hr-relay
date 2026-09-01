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
 * owner; the adoption test proves the last adopter, intake, actually crosses
 * the boundary and keeps its truthful first control. The UI catalog was the
 * other one until D295 made it a Settings SECTION — it owns no frame of its
 * own now, which is what the case below its adoption test pins instead.
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
import { FrontendBootstrapWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import { EditableSettingsWireSchema } from "../../../src/domain/dashboard/settings-editor.js";
import { UiCatalogWireSchema } from "../../../src/domain/dashboard/explorer.js";
import { DashboardDayWireSchema } from "../../../src/domain/dashboard/projection.js";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import {
  IMPORT_SPREADSHEET_DOOR_ID,
  restoreDashboardTakeoverFocus,
} from "../../../src/dashboard/app/dashboard-app-model.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { TakeoverFrame } from "../../../src/dashboard/ds/primitives-layout.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { IntakeWorkspace } from "../../../src/dashboard/surfaces/intake.js";

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
  monthCounts: [{ day: "2026-08-26", count: 0 }, { day: "2026-08-27", count: 0 }],
  workflowCounts: [{ workflowId: "fixture-workflow", count: 0, statusCounts: [] }],
  statusCounts: [],
  queueSurfaces: [],
  workerCards: [],
  workerPools: [],
  notifications: [],
});
const EMPTY_UI_CATALOG = UiCatalogWireSchema.parse({
  wireVersion: 1,
  sourcePath: "generated/ui-catalog.json",
  schemaVersion: 1,
  entries: [],
});
const EDITABLE_SETTINGS = EditableSettingsWireSchema.parse({
  revision: 1,
  settingsSchemaHash: FIXTURE_FINGERPRINT,
  settingsFingerprint: "b".repeat(64),
  activeConfigFingerprint: "c".repeat(64),
  runtimeStatus: { state: "current", identity: { settingsRevision: 1, settingsSchemaHash: FIXTURE_FINGERPRINT, settingsFingerprint: "b".repeat(64), configFingerprint: "c".repeat(64) } },
  sections: [
    { id: "general", label: "General", description: "General.", leaves: [{ path: "actor.label", input: "text", label: "Operator label", description: "Label.", effectiveValue: "Local operator", defaultValue: "Local operator", source: "default", editable: true }] },
    { id: "display", label: "Display", description: "Display.", leaves: [
      { path: "display.screenWidth", input: "number", label: "Screen width", description: "Width.", effectiveValue: 2560, defaultValue: 2560, source: "default", editable: true, minimum: 1, unit: "px" },
      { path: "display.screenHeight", input: "number", label: "Screen height", description: "Height.", effectiveValue: 1440, defaultValue: 1440, source: "default", editable: true, minimum: 1, unit: "px" },
    ] },
    { id: "performance", label: "Performance", description: "Performance.", leaves: [
      { path: "ocr.pageConcurrency", input: "number", label: "OCR concurrency", description: "OCR.", effectiveValue: 1, defaultValue: 1, source: "default", editable: true, minimum: 0 },
      { path: "ocr.maxValidationRetries", input: "number", label: "OCR retries", description: "Retries.", effectiveValue: 1, defaultValue: 1, source: "default", editable: true, minimum: 0 },
      { path: "timeouts.duoApprovalSeconds", input: "number", label: "Duo timeout", description: "Duo.", effectiveValue: 180, defaultValue: 180, source: "default", editable: true, minimum: 1 },
      { path: "concurrency.defaultWorkers", input: "number", label: "Workers", description: "Workers.", effectiveValue: 1, defaultValue: 1, source: "default", editable: true, minimum: 1 },
    ] },
    { id: "paths", label: "Paths", description: "Paths.", leaves: [{ path: "paths.reportsDir", input: "text", label: "Reports", description: "Reports.", effectiveValue: "/tmp/reports", defaultValue: "/tmp/reports", source: "default", editable: true }] },
  ],
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
    uiCatalog: () => Promise.resolve(EMPTY_UI_CATALOG),
    editableSettings: () => Promise.resolve(EDITABLE_SETTINGS),
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
    await Promise.resolve();
  });
}

async function mountDashboardAtCurrentHistoryEntry(): Promise<void> {
  await mountSurface(appClient(), createElement(DashboardApp));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function moveHistory(direction: "back" | "forward"): Promise<void> {
  await act(async () => {
    window.history[direction]();
    await new Promise<void>((resolve) => { window.setTimeout(resolve, 20); });
  });
}

async function settleHistory(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => { window.setTimeout(resolve, 20); });
  });
}

async function mountSettingsAtThirdHistoryEntry(): Promise<void> {
  window.history.replaceState({ hrDashboardRouteCursor: 0 }, "", "/");
  window.history.pushState({ hrDashboardRouteCursor: 1 }, "", "/?day=2026-08-26");
  window.history.pushState({ hrDashboardRouteCursor: 2 }, "", "/?settings=display");
  await mountDashboardAtCurrentHistoryEntry();
}

function buttonNamed(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((candidate) => (
    candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label
  ));
  assert.ok(button instanceof HTMLButtonElement, `no button is named "${label}"`);
  return button;
}

function buttonWithAriaPrefix(prefix: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label")?.startsWith(prefix));
  assert.ok(button instanceof HTMLButtonElement, `no button aria-label starts with "${prefix}"`);
  return button;
}

async function press(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.focus();
    button.click();
    await Promise.resolve();
  });
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor?.set === undefined) throw new Error("HTML input value setter is unavailable");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    Reflect.apply(descriptor.set, input, [value]);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
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

  /*
    D295's negative half. The catalog used to be the fifth takeover and is a
    Settings section now, so the claims invert: it must have NO frame of its
    own, and the frame it lives in must still own exactly one exit. A second
    close control inside the content pane would be two exits from one page —
    which is why `UiCatalogSection` takes no `onClose` at all.
  */
  it("the UI catalog draws inside the Settings frame and owns no exit of its own", async () => {
    await mountDashboard("?settings=ui-catalog");

    const frame = frameOf("Settings");
    assert.equal(document.activeElement, frame);
    assert.equal(
      document.querySelector('section[aria-label="UI catalog"]'),
      null,
      "the catalog must no longer mount a frame of its own",
    );
    assert.match(frame.textContent ?? "", /UI catalog/u);
    assert.equal(takeFirstTab(frame).textContent?.trim(), "Back to the dashboard");
    assert.equal(
      document.querySelector('[aria-label="Close the UI catalog"]'),
      null,
      "a section may not carry a second exit from the page that contains it",
    );
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

  it("uses the persistent main region when a deep link has no matching door", () => {
    const main = document.createElement("main");
    main.id = "fixture-main-region";
    main.tabIndex = -1;
    document.body.append(main);

    restoreDashboardTakeoverFocus(document, IMPORT_SPREADSHEET_DOOR_ID, main.id);
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

describe("Settings exits share the page-owned draft guard", () => {
  it("requires a discard before persistent TopBar navigation unmounts a dirty Settings draft", async () => {
    await mountDashboard("?settings=display");
    const input = document.querySelector("input");
    assert.ok(input instanceof HTMLInputElement, "Settings editable input did not mount");
    await setInputValue(input, "Edited operator");

    await press(buttonNamed("Dashboard"));
    assert.ok(frameOf("Settings"), "a dirty TopBar navigation must leave Settings mounted for confirmation");
    assert.match(document.body.textContent ?? "", /Discard unsaved settings\?/u);
    const discard = buttonNamed("Discard changes");
    assert.match(discard.className, /pointer-coarse:min-h-11/u);
    assert.match(buttonNamed("Keep editing").className, /pointer-coarse:min-h-11/u);
    await press(discard);
    assert.equal(document.querySelector('section[aria-label="Settings"]'), null);
    assert.ok(document.getElementById("dashboard-main-region"));
  });

  it("allows persistent TopBar navigation immediately when the Settings draft is clean", async () => {
    await mountDashboard("?settings=display");
    await press(buttonNamed("Dashboard"));
    assert.equal(document.querySelector('section[aria-label="Settings"]'), null);
    assert.equal(document.body.textContent?.includes("Discard unsaved settings?"), false);
    assert.ok(document.getElementById("dashboard-main-region"));
  });

  it("reconciles a dirty native popstate until the operator chooses an exit", async () => {
    await mountSettingsAtThirdHistoryEntry();
    const input = document.querySelector("input");
    assert.ok(input instanceof HTMLInputElement, "Settings editable input did not mount");
    await setInputValue(input, "Edited operator");

    await moveHistory("back");
    assert.ok(frameOf("Settings"));
    assert.equal(window.location.search, "?settings=display", "the dirty route is restored before confirmation");
    await press(buttonNamed("Keep editing"));
    assert.ok(frameOf("Settings"));
    assert.equal(window.location.search, "?settings=display");
    await moveHistory("back");
    await press(buttonNamed("Discard changes"));
    await settleHistory();
    assert.equal(window.location.search, "?day=2026-08-26", "discard replays the original destination rather than skipping it");

    await moveHistory("forward");
    assert.equal(window.location.search, "?settings=display", "the cancellation preserves the entry ahead of the original destination");
  });

  it("accepts a clean native popstate immediately", async () => {
    await mountSettingsAtThirdHistoryEntry();
    await moveHistory("back");
    assert.equal(document.querySelector('section[aria-label="Settings"]'), null);
    assert.equal(window.location.search, "?day=2026-08-26");
  });

  it("does not mutate TopBar history until a dirty Settings exit is confirmed", async () => {
    await mountDashboard("");
    await press(buttonWithAriaPrefix("Previous day"));
    await press(buttonNamed("Settings"));
    const input = document.querySelector("input");
    assert.ok(input instanceof HTMLInputElement, "Settings editable input did not mount");
    await setInputValue(input, "Edited operator");

    const back = buttonNamed("Back");
    assert.equal(back.disabled, false);
    assert.equal(buttonNamed("Forward").disabled, true);
    await press(back);
    await press(buttonNamed("Keep editing"));
    assert.ok(frameOf("Settings"));
    assert.equal(buttonNamed("Back").disabled, false, "cancelled navigation keeps the prior history cursor");
    assert.equal(buttonNamed("Forward").disabled, true, "cancelled navigation creates no forward place");
  });

  it("accepts clean TopBar history navigation immediately", async () => {
    await mountDashboard("");
    await press(buttonWithAriaPrefix("Previous day"));
    await press(buttonNamed("Settings"));
    await press(buttonNamed("Back"));
    assert.equal(document.querySelector('section[aria-label="Settings"]'), null);
    assert.equal(buttonNamed("Forward").disabled, false);
  });
});
