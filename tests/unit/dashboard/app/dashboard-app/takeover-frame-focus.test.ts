import { PARITY_WORKFLOW_COMPOSITION } from "../../../../parity/helpers/workflow-composition.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../../../parity/helpers/fixture-settings.js";
// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { FrontendBootstrapWireSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { CalendarWireSchema } from "../../../../../src/models/dashboard/calendar.js";
import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { DashboardApp } from "../../../../../src/dashboard/app/dashboard-app.js";
import {
  RUN_START_DOOR_ID,
  restoreDashboardTakeoverFocus,
} from "../../../../../src/dashboard/app/dashboard-app-model.js";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { TakeoverFrame } from "../../../../../src/dashboard/ds/primitives/primitives-layout.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { IntakeWorkspace } from "../../../../../src/dashboard/surfaces/intake/intake.js";

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
  protectedSchemaHash: FIXTURE_FINGERPRINT,
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

      spreadsheetIntake: false,
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

const EDITABLE_SETTINGS = FIXTURE_EDITABLE_SETTINGS;
const CALENDAR = ({ month, day }: { month: string; day: string }) => CalendarWireSchema.parse({
  month,
  day,
  today: "2026-08-27",
  authorityGeneration: 1,
  monthCounts: [],
  firstDay: null,
  lastDay: null,
  previousDay: null,
  nextDay: null,
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


async function mountTakeover(label: string, children: ReactNode[]): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(createElement(TakeoverFrame, { label, children }));
  });
}


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
    calendar: (input: Parameters<DashboardClient["calendar"]>[0]) => Promise.resolve(CALENDAR(input)),

    intakeSession: () => new Promise<never>(() => undefined),
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
  await mountSurface(appClient(), createElement(DashboardApp, { workflowComposition: PARITY_WORKFLOW_COMPOSITION }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountDashboardAtCurrentHistoryEntry(): Promise<void> {
  await mountSurface(appClient(), createElement(DashboardApp, { workflowComposition: PARITY_WORKFLOW_COMPOSITION }));
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

async function press(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.focus();
    button.click();
    await Promise.resolve();
  });
}

async function dirtyBrowserSettings(): Promise<{ input: HTMLInputElement; value: boolean }> {
  const row = document.querySelector('[data-settings-path="browser.headless"]');
  const input = row?.querySelector('[role="switch"]');
  const control = row?.querySelector(".ds-switch-control");
  assert.ok(input instanceof HTMLInputElement && control instanceof HTMLElement, "Settings browser switch did not mount");
  const value = !input.checked;
  await act(async () => control.click());
  assert.equal(input.checked, value);
  return { input, value };
}

// jsdom does not implement Tab navigation; assert the first enabled descendant order directly.
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
    // Chromium applies focus-visible to programmatic focus; suppress the frame outline.
    assert.ok(cls.includes("outline-none"), `the frame must suppress the UA ring: ${cls.join(" ")}`);
    // And it must not have opted INTO the product ring by accident.
    assert.ok(!cls.includes("ds-focus"), "the frame is not an interactive control");
  });

  it("does not steal focus from a descendant that took it in the same commit", async () => {
    // React autoFocus commits before passive effects; preserve a child control that already took focus.
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
  it("Spreadsheet intake receives frame focus, then Tab reaches Close first", async () => {

    const client = {
      intakeSession: () => new Promise<never>(() => undefined),
    } as unknown as DashboardClient;
    await mountSurface(client, createElement(IntakeWorkspace, {
      workflowLabel: "Fixture workflow",
      actorId: "fixture-operator",
      supportsDryRun: false,
      sessionId: "fixture-intake-session",
      onClose: () => undefined,
      onEnqueued: () => undefined,
    }));

    const frame = frameOf("Spreadsheet intake");
    assert.equal(document.activeElement, frame);
    const first = takeFirstTab(frame);
    assert.equal(first.textContent?.trim(), "Close");
  });

  it("the retired UI catalog URL shows an explicit removal notice without mounting its reader", async () => {
    await mountDashboard("?settings=ui-catalog");

    const frame = frameOf("Settings");
    assert.equal(document.activeElement, frame);
    assert.equal(
      document.querySelector('section[aria-label="UI catalog"]'),
      null,
      "the catalog must no longer mount a frame of its own",
    );
    assert.match(frame.textContent ?? "", /UI catalog removed/u);
    assert.equal([...frame.querySelectorAll("a")].some(link => link.textContent?.trim() === "UI catalog"), false);
    assert.equal(takeFirstTab(frame).getAttribute("aria-label"), "Back to dashboard");
    assert.equal(
      document.querySelector('[aria-label="Close the UI catalog"]'),
      null,
      "a section may not carry a second exit from the page that contains it",
    );
  });
});

describe("closing a route-backed takeover restores its toolbar door", () => {

  it("returns intake focus to Start a run after the route unmounts", async () => {
    await mountDashboard("?intake=e1f2a3b4-0000-4000-8000-000000000001");
    await press(buttonNamed("Close"));

    const door = buttonNamed("Start a run");
    assert.equal(door.id, RUN_START_DOOR_ID);
    assert.equal(document.activeElement, door);
    assert.equal(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Import spreadsheet",
      ),
      undefined,
      "the toolbar's Import spreadsheet door is retired — the Run Modal carries the handoff",
    );
  });

  it("uses the persistent main region when a deep link has no matching door", () => {
    const main = document.createElement("main");
    main.id = "fixture-main-region";
    main.tabIndex = -1;
    document.body.append(main);

    restoreDashboardTakeoverFocus(document, RUN_START_DOOR_ID, main.id);
    assert.equal(document.activeElement, main);
  });

  it("fails loud when neither the requested door nor the main fallback exists", () => {
    assert.throws(
      () => restoreDashboardTakeoverFocus(
        document,
        RUN_START_DOOR_ID,
        "missing-main-region",
      ),
      /neither dashboard-run-start-door nor missing-main-region is mounted/u,
    );
  });
});

describe("Settings exits share the page-owned draft guard", () => {
  it("retains the same draft across catalog subroutes, restores cancelled-dialog focus and exits to gear", async () => {
    await mountDashboard("?settings=general");
    const { input, value } = await dirtyBrowserSettings();
    const frame = frameOf("Settings");
    const themeRow = [...document.querySelectorAll<HTMLElement>(".ds-switch-row")].find(row => row.textContent?.includes("Dark theme"));
    const themeSwitch = themeRow?.querySelector("input");
    const themeControl = themeRow?.querySelector(".ds-switch-control");
    assert.ok(themeSwitch instanceof HTMLInputElement && themeControl instanceof HTMLElement);
    const initialTheme = themeSwitch.checked;
    await act(async () => themeControl.click());
    assert.equal(themeSwitch.checked, !initialTheme);
    const notifications = document.querySelector(".rail-notification-toggle");
    assert.ok(notifications instanceof HTMLButtonElement);
    assert.match(notifications.getAttribute("aria-label") ?? "", /^Notifications, \d+ unread$/u);
    await press(notifications);
    assert.equal(frameOf("Settings"), frame, "opening notifications preserves the runtime draft owner");
    assert.equal(input.checked, value, "browser appearance and notification controls preserve runtime edits");
    await press(notifications);
    const sectionLink = (label: string): HTMLAnchorElement => {
      const link = [...document.querySelectorAll("nav[aria-label='Settings sections'] a")]
        .find(candidate => candidate.textContent?.trim() === label);
      assert.ok(link instanceof HTMLAnchorElement, `missing section ${label}`);
      return link;
    };
    const editorLabel = sectionLink("General").textContent?.trim();
    assert.equal(editorLabel, "General");
    await act(async () => sectionLink("Keyboard").click());
    assert.match(window.location.search, /settings=keyboard/u);
    assert.equal(document.querySelectorAll('section[aria-label="Settings"]').length, 1);
    const dashboard = buttonNamed("Back to dashboard");
    await press(dashboard);
    await press(buttonNamed("Keep editing"));
    assert.equal(document.activeElement, dashboard, "cancelling the shell exit restores focus to its persistent navigation control");
    assert.match(window.location.search, /settings=keyboard/u);
    await press(dashboard);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    assert.equal(document.querySelector('[role="dialog"]'), null, "Escape closes the pending dirty-exit dialog");
    assert.equal(document.activeElement, dashboard, "Escape restores focus to the persistent navigation control");
    await act(async () => sectionLink("General").click());
    const restored = document.querySelector('[data-settings-path="browser.headless"] [role="switch"]');
    assert.ok(restored instanceof HTMLInputElement);
    assert.equal(restored.checked, value);
    await press(buttonNamed("Back to dashboard"));
    await press(buttonNamed("Discard changes"));
    assert.equal(document.querySelector('section[aria-label="Settings"]'), null);
    assert.equal(window.location.search.includes("catalog"), false);
    assert.equal(document.activeElement?.id, "settings-gear");
  });

  it("requires a discard before persistent rail navigation unmounts a dirty Settings draft", async () => {
    await mountDashboard("?settings=display");
    await dirtyBrowserSettings();

    await press(buttonNamed("Back to dashboard"));
    assert.ok(frameOf("Settings"), "a dirty rail navigation must leave Settings mounted for confirmation");
    assert.match(document.body.textContent ?? "", /Discard unsaved settings\?/u);
    const discard = buttonNamed("Discard changes");
    await press(discard);
    assert.equal(document.querySelector('section[aria-label="Settings"]'), null);
    assert.ok(document.getElementById("dashboard-main-region"));
  });

  it("allows persistent rail navigation immediately when the Settings draft is clean", async () => {
    await mountDashboard("?settings=display");
    await press(buttonNamed("Back to dashboard"));
    assert.equal(document.querySelector('section[aria-label="Settings"]'), null);
    assert.equal(document.body.textContent?.includes("Discard unsaved settings?"), false);
    assert.ok(document.getElementById("dashboard-main-region"));
  });

  it("reconciles a dirty native popstate until the operator chooses an exit", async () => {
    await mountSettingsAtThirdHistoryEntry();
    await dirtyBrowserSettings();

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

  it("preserves both native history entries when a dirty Settings exit is cancelled", async () => {
    await mountSettingsAtThirdHistoryEntry();
    await dirtyBrowserSettings();
    const cursor = window.history.state as { hrDashboardRouteCursor: number };
    await moveHistory("back");
    await press(buttonNamed("Keep editing"));
    assert.ok(frameOf("Settings"));
    assert.deepEqual(window.history.state, cursor, "cancelled navigation keeps the stable history cursor");
    await moveHistory("back");
    await press(buttonNamed("Discard changes"));
    await settleHistory();
    assert.equal(window.location.search, "?day=2026-08-26");
    await moveHistory("forward");
    assert.equal(window.location.search, "?settings=display", "cancelled navigation preserves the forward entry");
  });

  it("accepts clean browser history navigation and preserves its forward destination", async () => {
    await mountSettingsAtThirdHistoryEntry();
    await moveHistory("back");
    assert.equal(document.querySelector('section[aria-label="Settings"]'), null);
    await moveHistory("forward");
    assert.equal(window.location.search, "?settings=display");
    assert.ok(frameOf("Settings"));
  });
});
