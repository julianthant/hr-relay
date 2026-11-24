import { FIXTURE_ACTIVE_PROFILE_STATE } from "../../support/helpers/dashboard/profiles/fixture-profile-setup.js";
import { profileActivationResponse } from "../../support/helpers/dashboard/shared-profile-cookie-tabs.js";
import { chatGptStatusFixture } from "../../support/helpers/chatgpt-status-fixture.js";
import { createPersonPreferences } from "../../../src/dashboard/state/person-preferences-model.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../src/models/config/person-preferences.js";
import { ProtectedSettingsApplyInputSchema } from "../../../src/models/config/protected-settings.js";
import { syntheticSettingsAuthority } from "../../support/helpers/dashboard/settings-harness.js";
import { ApplicationLifecycleSchema } from "../../../src/models/dashboard/application-lifecycle.js";
import { CommandRequestSchema, deriveSettingsCommandFingerprint, ProtectedSettingsCommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { URL as FileURL } from "node:url";
// @vitest-environment jsdom
import { FIXTURE_EDITABLE_SETTINGS as FIXTURE_EDITABLE_SETTINGS_m1 } from "../../support/helpers/dashboard/mock-world/fixture-settings.js";
import { MOCK_WORKFLOW_COMPOSITION as MOCK_WORKFLOW_COMPOSITION_m1 } from "../../support/helpers/dashboard/mock-world/workflow-composition.js";
// @vitest-environment jsdom

import assert_m1 from "node:assert/strict";
import { loadLazyPages } from "../../support/helpers/dashboard/lazy-pages.js";
import { act as act_m1,createElement as createElement_m1,type ReactNode as ReactNode_m1 } from "react";
import { createRoot as createRoot_m1,type Root as Root_m1 } from "react-dom/client";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1,vi as vi_m1 } from "vitest";
import { operatorFailureSentence } from "../../../src/models/failures/error-catalog.js";
import { PublicProfileStateSchema } from "../../../src/models/profiles/public-profile.js";
import {
RUN_START_DOOR_ID as RUN_START_DOOR_ID_m1
} from "../../../src/dashboard/app/dashboard-app-model.js";
import { DashboardApp as DashboardApp_m1 } from "../../../src/dashboard/app/dashboard-app.js";
import type { DashboardClient as DashboardClient_m1 } from "../../../src/dashboard/client/index.js";
import { TakeoverFrame as TakeoverFrame_m1 } from "../../../src/dashboard/ds/primitives/primitives-layout.js";
import { DashboardClientProvider as DashboardClientProvider_m1 } from "../../../src/dashboard/state/client-context.js";
import { FrontendBootstrapWireSchema as FrontendBootstrapWireSchema_m1 } from "../../../src/models/dashboard/bootstrap.js";
import { CalendarWireSchema as CalendarWireSchema_m1 } from "../../../src/models/dashboard/calendar.js";
import { DashboardDayWireSchema as DashboardDayWireSchema_m1 } from "../../../src/models/dashboard/projection.js";
// @vitest-environment jsdom
import { default as assert_m2,default as assert_m3 } from 'node:assert/strict';
import { readFileSync as readFileSync_m3 } from "node:fs";
import { act as act_m2,createElement as createElement_m2 } from 'react';
import { createRoot as createRoot_m2,type Root as Root_m2 } from 'react-dom/client';
import { afterEach as afterEach_m2,describe as describe_m2,describe as describe_m3,it as it_m2,it as it_m3 } from 'vitest';
import { DashboardApp as DashboardApp_m2 } from '../../../src/dashboard/app/dashboard-app.js';
import { createDashboardClient as createDashboardClient_m2 } from '../../../src/dashboard/client/index.js';
import { DashboardClientProvider as DashboardClientProvider_m2 } from '../../../src/dashboard/state/client-context.js';
import { DashboardDayWireSchema as DashboardDayWireSchema_m2,type DashboardDayWire as DashboardDayWire_m2 } from '../../../src/models/dashboard/projection.js';
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m2 } from '../../support/helpers/dashboard/mock-world/fixture-queue.js';
import { MOCK_WORKFLOW_COMPOSITION as MOCK_WORKFLOW_COMPOSITION_m2 } from "../../support/helpers/dashboard/mock-world/workflow-composition.js";
import { WORKFLOW_SOURCES } from "../../../src/dashboard/app/workflow-sources.js";
import { createFixtureBff as createFixtureBff_m2 } from '../../support/helpers/dashboard/fixture-bff.js';



{


class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);

const FIXTURE_FINGERPRINT = "a".repeat(64);
const APP_BOOTSTRAP = FrontendBootstrapWireSchema_m1.parse({
  wireVersion: 1,
  appVersion: "0.1.0",
  descriptorHash: FIXTURE_FINGERPRINT,
  settingsSchemaHash: FIXTURE_FINGERPRINT,
  protectedSchemaHash: FIXTURE_FINGERPRINT,
  projectionGeneration: 1,
  actor: { id: "local-operator", label: "Local operator" },
  workbookCompatibility: { workflows: [], libraries: [] },
  serverClock: { now: "2026-08-27T18:00:00.000Z", zone: "America/Los_Angeles" },
  storage: { authority: "healthy" },
  workflows: [{
    id: "fixture-workflow",
    code: "fw",
    label: "Fixture workflow",
    icon: "ClipboardCheck",
    categoryId: "operations",
    descriptorFingerprint: FIXTURE_FINGERPRINT,
    availability: { state: "available" },
    role: { kind: "standalone" },
    start: {
      enqueue: "reject-active",
      version: 1,

      readiness: { scope: "workbook-sources", state: "ready" }, spreadsheetIntake: false, requiredWorkbookFields: [],
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
/** The same workflow with a typed Run input, so the Start run dialog mounts an input box. */
const APP_BOOTSTRAP_WITH_INPUT = FrontendBootstrapWireSchema_m1.parse({ ...APP_BOOTSTRAP, workflows: (APP_BOOTSTRAP.workflows as readonly { readonly start: object }[]).map(flow => ({ ...flow,
  start: { ...flow.start, inputRun: { placeholder: "Employee ID", parser: { split: { kind: "delimited", delimiters: [",", "\n"] }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "eid" }] } } } })) });
const APP_DAY = DashboardDayWireSchema_m1.parse({
  day: "2026-08-27",
  descriptorHash: FIXTURE_FINGERPRINT,
  projectionGeneration: 1,
  snapshotCursor: "pc:1",
  monthCounts: [{ day: "2026-08-26", count: 0 }, { day: "2026-08-27", count: 0 }],
  workflowCounts: [{ workflowId: "fixture-workflow", count: 0, statusCounts: [] }],
  statusCounts: [],
  queueSurfaces: [],
  workerCards: [], workerAuthority: { state: "present", members: [] },
  workerPools: [],
  notifications: [],
});

const EDITABLE_SETTINGS = FIXTURE_EDITABLE_SETTINGS_m1;
const CALENDAR = ({ month, day }: { month: string; day: string }) => CalendarWireSchema_m1.parse({
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

let mounted: Root_m1 | undefined;

const _afterEachFixture0 = async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act_m1(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
};

/** The takeover's own root — the `section` the frame renders and names. */
function frameOf(label: string): HTMLElement {
  const node = document.querySelector(`section[aria-label="${label}"]`);
  assert_m1.ok(node instanceof HTMLElement, `no takeover frame is labelled "${label}"`);
  return node;
}


async function mountTakeover(label: string, children: ReactNode_m1[]): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot_m1(host);
  mounted = root;
  await act_m1(async () => {
    root.render(createElement_m1(TakeoverFrame_m1, { label, children }));
  });
}


async function mountSurface(client: DashboardClient_m1, children: ReactNode_m1): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot_m1(host);
  mounted = root;
  await act_m1(async () => {
    root.render(createElement_m1(DashboardClientProvider_m1, { client, children }));
  });
}

/** The whole app client is closed: an unserved read is a fixture defect, not an empty answer. */
function appClient(): DashboardClient_m1 {
  const served = {
    readProfileSession: () => Promise.resolve(FIXTURE_ACTIVE_PROFILE_STATE),
    subscribeProfileSessionStale: () => () => undefined,
    bootstrap: () => Promise.resolve(APP_BOOTSTRAP),
    applicationLifecycle: () => Promise.resolve(ApplicationLifecycleSchema.parse({ runtimeGeneration: 1, state: "ready", pause: "running", targets: [], update: "installer-unavailable" })),
    chatGptAccount: async () => chatGptStatusFixture(await (Promise.resolve({ state: "signed-out" }))),
    subscribeDay: (input: Parameters<DashboardClient_m1["subscribeDay"]>[0]) => {
      input.onDay(APP_DAY);
      input.onState({ state: "live" });
      return { select() {}, close: () => undefined };
    },
    calendar: (input: Parameters<DashboardClient_m1["calendar"]>[0]) => Promise.resolve(CALENDAR(input)),

    intakeSession: () => new Promise<never>(() => undefined),
    editableSettings: () => Promise.resolve(EDITABLE_SETTINGS),
    // Settings saves stay in flight, so an edit remains the page-owned draft the exit guard protects.
    executeCommand: () => new Promise<never>(() => undefined),
  } as unknown as DashboardClient_m1;
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
  await mountSurface(appClient(), createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1,
    previewPreferences: createPersonPreferences("preview", NEUTRAL_PERSON_PREFERENCES) }));
  await act_m1(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await loadLazyPages();
}

async function mountDashboardAtCurrentHistoryEntry(): Promise<void> {
  await mountSurface(appClient(), createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
  await act_m1(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await loadLazyPages();
}

async function moveHistory(direction: "back" | "forward"): Promise<void> {
  await act_m1(async () => {
    const moved = new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
    });
    window.history[direction]();
    await moved;
    await new Promise<void>((resolve) => { window.setTimeout(resolve, 20); });
  });
}

async function settleHistory(): Promise<void> {
  await act_m1(async () => {
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
  assert_m1.ok(button instanceof HTMLButtonElement, `no button is named "${label}"`);
  return button;
}

async function press(button: HTMLButtonElement): Promise<void> {
  await act_m1(async () => {
    button.focus();
    button.click();
    await Promise.resolve();
  });
}

const JOB_END_DATE = '[data-settings-path="annualDates.FY2027.jobEndDate"] input[type="date"]';
async function dirtyBrowserSettings(): Promise<{ input: HTMLInputElement; value: string }> {
  const input = document.querySelector<HTMLInputElement>(JOB_END_DATE);
  assert_m1.ok(input instanceof HTMLInputElement, "Settings job-end date control did not mount");
  const value = input.value === "2027-06-29" ? "2027-06-28" : "2027-06-29";
  await act_m1(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  assert_m1.equal(input.value, value);
  return { input, value };
}

// jsdom does not implement Tab navigation; assert the first enabled descendant order directly.
function takeFirstTab(frame: HTMLElement): HTMLElement {
  const first = frame.querySelector<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
  );
  assert_m1.ok(first instanceof HTMLElement, "the takeover has no first Tab target");
  first.focus();
  assert_m1.equal(document.activeElement === first, true);
  return first;
}

describe_m1("served signed-out appearance", () => {
  afterEach_m1(_afterEachFixture0);
  for (const preview of [false, true]) {
    it_m1(preview ? "honors an explicit preview owner" : "keeps neutral preferences despite origin storage", async () => {
      let reads = 0;
      const client = { ...appClient(), readProfileSession: async () => { reads++; return { state: "signed-out" as const }; } };
      localStorage.setItem("rebuild-demo.theme", "light");
      try {
        await mountSurface(client, createElement_m1(DashboardApp_m1, {
          workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1,
          ...(preview ? { previewPreferences: createPersonPreferences("preview", { ...NEUTRAL_PERSON_PREFERENCES, theme: "light" }) } : {}),
        }));
        assert_m1.equal(reads, 1);
        assert_m1.equal(document.querySelector("[data-app-root]")?.getAttribute("data-demo-theme"), preview ? "light" : NEUTRAL_PERSON_PREFERENCES.theme);
      } finally { localStorage.clear(); }
    });
  }
});

describe_m1("served sign-up Finish", () => {
  afterEach_m1(_afterEachFixture0);

  it_m1("keeps a fresh Run draft mounted when an old protected response arrives after resume", async () => {
    window.history.replaceState(null, "", "/");
    const old = Promise.withResolvers<Response>(), dispatched = Promise.withResolvers<void>(), publicRead = Promise.withResolvers<Response>();
    let defer = false, restarted = false, holdPublic = false, invalidateFresh = false, resumes = 0, reads = 0;
    const active = (epoch: number) => ({ state: "active", profileId: "00000000-0000-4000-8000-000000000002", duoState: "ready", epoch });
    const stale = () => Response.json({ state: "refused", code: "PROFILE_SESSION_STALE" }, { status: 401 });
    const live = createDashboardClient_m2({ baseUrl: "http://fixture.test", fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path.endsWith("/state")) {
        reads++; if (holdPublic) return publicRead.promise;
        return Response.json(restarted && resumes === 0 ? { state: "signed-out", resumable: true } : active(1 + resumes));
      }
      if (path.endsWith("/resume")) { resumes++; return profileActivationResponse(active(1 + resumes)); }
      if (path.endsWith("/bootstrap")) {
        if (defer) { defer = false; dispatched.resolve(); return old.promise; }
        if (restarted && resumes === 0 || invalidateFresh) return stale();
        return Response.json(APP_BOOTSTRAP_WITH_INPUT);
      }
      throw new Error(`unexpected draft-preservation request ${path}`);
    } });
    const client: DashboardClient_m1 = { ...appClient(), bootstrap: () => live.bootstrap(), readProfileSession: () => live.readProfileSession(),
      resumeProfile: () => live.resumeProfile(), subscribeProfileSessionStale: listener => live.subscribeProfileSessionStale(listener) };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => assert_m1.ok(document.querySelector(".dashboard-shell")));
    defer = true; const pending = assert_m1.rejects(client.bootstrap()); await dispatched.promise;
    try {
      restarted = true;
      await act_m1(async () => { await assert_m1.rejects(client.bootstrap()); });
      await vi_m1.waitFor(() => { assert_m1.equal(resumes, 1); assert_m1.ok(document.querySelector(".dashboard-shell")); });
      await act_m1(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Start run"]')?.click(); });
      const dialog = document.querySelector('[role="dialog"]'); assert_m1.ok(dialog);
      const workflow = [...dialog.querySelectorAll("button")].find(button => button.textContent?.includes("Fixture workflow"));
      assert_m1.ok(workflow); await act_m1(async () => workflow.click());
      const draft = dialog.querySelector<HTMLTextAreaElement | HTMLInputElement>('[aria-label="Input"] textarea, [aria-label="Input"] input:not([type="checkbox"])');
      assert_m1.ok(draft, "the actual Run input must be mounted");
      const setter = Object.getOwnPropertyDescriptor(draft instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set?.bind(draft);
      assert_m1.ok(setter);
      await act_m1(async () => { setter("10873698"); draft.dispatchEvent(new Event("input", { bubbles: true })); });
      assert_m1.equal(draft.value, "10873698"); holdPublic = true;
      await act_m1(async () => { old.resolve(stale()); await pending; });
      assert_m1.equal(draft.isConnected, true, "an old protected response must not unmount the fresh Run draft");
      assert_m1.equal(draft.value, "10873698"); assert_m1.equal(reads, 2);
      invalidateFresh = true;
      await act_m1(async () => { await assert_m1.rejects(client.bootstrap()); });
      assert_m1.equal(reads, 3); assert_m1.equal(draft.isConnected, false); assert_m1.equal(resumes, 1);
    } finally { old.resolve(stale()); publicRead.resolve(Response.json(active(2))); await pending; }
  });

  it_m1("reconciles an already-open dashboard after a stale cookie and resumes through fresh public authority", async () => {
    window.history.replaceState(null, "", "/");
    let restarted = false, resumes = 0, refusedReads = 0;
    const active = { state: "active" as const, profileId: "00000000-0000-4000-8000-000000000002", duoState: "ready" as const, epoch: 1 };
    const live = createDashboardClient_m2({ baseUrl: "http://fixture.test", fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path.endsWith("/state")) return Response.json(restarted && resumes === 0 ? { state: "signed-out", resumable: true } : { ...active, epoch: 1 + resumes });
      if (path.endsWith("/resume")) { resumes++; return profileActivationResponse({ ...active, epoch: 1 + resumes }); }
      if (path.endsWith("/bootstrap")) {
        if (restarted && resumes === 0) { refusedReads++; return Response.json({ state: "refused", code: "PROFILE_SESSION_STALE" }, { status: 401 }); }
        return Response.json(APP_BOOTSTRAP);
      }
      throw new Error(`unexpected restart fixture request ${path}`);
    } });
    const client: DashboardClient_m1 = { ...appClient(), bootstrap: () => live.bootstrap(), readProfileSession: () => live.readProfileSession(),
      resumeProfile: () => live.resumeProfile(), subscribeProfileSessionStale: listener => live.subscribeProfileSessionStale(listener) };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => assert_m1.ok(document.querySelector(".dashboard-shell")));
    restarted = true;
    await act_m1(async () => { await assert_m1.rejects(client.bootstrap()); });
    await vi_m1.waitFor(() => {
      assert_m1.equal(resumes, 1); assert_m1.ok(document.querySelector(".dashboard-shell"));
      assert_m1.equal(document.querySelector(".hub-onboarding") === null, true);
    });
    assert_m1.equal(refusedReads, 1);
    assert_m1.deepEqual(await client.readProfileSession(), { ...active, epoch: 2 });
  });

  it_m1("resumes the profile still signed in and shows the normal login form if that is refused", async () => {
    window.history.replaceState(null, "", "/?onboarding=signup");
    let resumed = 0;
    const client = { ...appClient(), readProfileSession: async () => ({ state: "signed-out" as const, signUpRequired: false, resumable: true as const }),
      resumeProfile: async () => { resumed++; return { state: "refused" as const, code: "PROFILE_TRANSITION_BLOCKED" as const }; } };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(resumed, 1); assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay"); }, { timeout: 3000 });
    await act_m1(async () => { [...document.querySelectorAll("a")].find(link => link.textContent === "Sign up")?.click(); });
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Create your profile"); }, { timeout: 3000 });
    await act_m1(async () => { [...document.querySelectorAll("a")].find(link => link.textContent === "Log in")?.click(); });
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay"); }, { timeout: 3000 });
    assert_m1.equal(resumed, 1);
  });



  it_m1.each(["login", "signup"] as const)("a successful automatic resume from the %s URL opens the dashboard shell", async onboarding => {
    window.history.replaceState(null, "", `/?onboarding=${onboarding}`);
    const active = { state: "active" as const, profileId: "00000000-0000-4000-8000-000000000002", duoState: "ready" as const, epoch: 7 };
    let resumed = 0;
    const client = { ...appClient(),
      readProfileSession: async () => resumed > 0 ? active : { state: "signed-out" as const, signUpRequired: false, resumable: true as const },
      resumeProfile: async () => { resumed++; return active; } };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => {
      assert_m1.equal(resumed, 1);
      assert_m1.equal(new URLSearchParams(window.location.search).has("onboarding"), false);
      assert_m1.equal(["Log in to Relay", "Create your profile"].includes(document.querySelector("h1")?.textContent ?? ""), false);
    }, { timeout: 3000 });
  });

  it_m1("a tab whose resume lost the race adopts the winner's session once it is in place", async () => {
    window.history.replaceState(null, "", "/");
    const active = { state: "active" as const, profileId: "00000000-0000-4000-8000-000000000002", duoState: "ready" as const, epoch: 7 };
    let cookie = false, resumed = 0, readsBeforeWinner = 0;
    let release!: () => void;
    const winner = new Promise<void>(resolve => { release = resolve; }).then(() => { cookie = true; });
    const client = { ...appClient(),
      readProfileSession: async () => { if (cookie) return active; readsBeforeWinner++; return { state: "signed-out" as const, signUpRequired: false, resumable: true as const }; },
      resumeProfile: async () => { resumed++; return { state: "refused" as const, code: "PROFILE_TRANSITION_BLOCKED" as const }; } };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(resumed, 1); assert_m1.equal(readsBeforeWinner >= 2, true); }, { timeout: 3000 });
    assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay");
    release(); await winner;
    await vi_m1.waitFor(() => { assert_m1.notEqual(document.querySelector("h1")?.textContent, "Log in to Relay"); }, { timeout: 3000 });
    assert_m1.equal(resumed, 1);
  });

  it_m1("keeps the login form when resume is genuinely refused and no session appears", async () => {
    window.history.replaceState(null, "", "/");
    let resumed = 0, reads = 0;
    const client = { ...appClient(),
      readProfileSession: async () => { reads++; return { state: "signed-out" as const, signUpRequired: false, resumable: true as const }; },
      resumeProfile: async () => { resumed++; return { state: "refused" as const, code: "PROFILE_AUTHORITY_UNAVAILABLE" as const }; } };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(resumed, 1); assert_m1.equal(reads >= 3, true); }, { timeout: 3500 });
    assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay");
    assert_m1.equal(resumed, 1);
  });

  it_m1.each([
    ["is cancelling", { state: "cancelling" as const, operationId: "00000000-0000-4000-8000-000000000003" }],
    ["was refused while it finishes", { state: "refused" as const, code: "PROFILE_LOGOUT_BLOCKED" as const }],
  ])("keeps checking while a logout %s and shows the login form once it completes", async (_name, waiting) => {
    window.history.replaceState(null, "", "/");
    let finished = false, reads = 0;
    const client = { ...appClient(), readProfileSession: async () => { reads++; return finished ? { state: "signed-out" as const, signUpRequired: false } : waiting; } };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(reads >= 2, true); }, { timeout: 3000 });
    assert_m1.equal(document.querySelector(".form-error")?.textContent, operatorFailureSentence("PROFILE_LOGOUT_BLOCKED"));
    finished = true;
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector(".form-error")?.textContent, ""); }, { timeout: 3000 });
    assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay");
  });

  it_m1.each([
    ["cancelling", { state: "cancelling" as const, operationId: "00000000-0000-4000-8000-000000000003" }, true],
    ["refused as blocked", { state: "refused" as const, code: "PROFILE_LOGOUT_BLOCKED" as const }, true],
    ["an ordinary refusal", { state: "refused" as const, code: "PROFILE_SIGN_IN_REFUSED" as const }, false],
  ])("a login submitted during a logout answers %s", async (_name, answer, clears) => {
    window.history.replaceState(null, "", "/");
    let finished = false, reads = 0, signIns = 0;
    const client = { ...appClient(), readProfileSession: async () => { reads++; return finished || !clears ? { state: "signed-out" as const, signUpRequired: false } : answer; },
      signInProfile: async () => { signIns++; return answer; } };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay"); }, { timeout: 3000 });
    for (const [name, value] of [["email", "fixture@ucsd.edu"], ["password", "disposable-fixture-password"]] as const) {
      await act_m1(async () => { const field = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true })); });
    }
    await act_m1(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    assert_m1.equal(signIns, 1);
    const readsAfterSubmit = reads;
    await vi_m1.waitFor(() => { assert_m1.equal(reads >= readsAfterSubmit + 2, true); }, { timeout: 3500 });
    assert_m1.notEqual(document.querySelector(".form-error")?.textContent, "");
    finished = true;
    if (clears) await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector(".form-error")?.textContent, ""); }, { timeout: 3000 });
    else {
      const settled = reads;
      await vi_m1.waitFor(() => { assert_m1.equal(reads >= settled + 1, true); }, { timeout: 3000 });
      assert_m1.equal(document.querySelector(".form-error")?.textContent, "Wrong email or password");
    }
  });

  it_m1("opens the sign-up form from the Sign up link after a refused login", async () => {
    window.history.replaceState(null, "", "/");
    const client = { ...appClient(), readProfileSession: async () => ({ state: "refused" as const, code: "PROFILE_SIGN_IN_REFUSED" as const }) };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay"); }, { timeout: 3000 });
    await act_m1(async () => { [...document.querySelectorAll("a")].find(link => link.textContent === "Sign up")?.click(); });
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Create your profile"); }, { timeout: 3000 });
    await act_m1(async () => { [...document.querySelectorAll("a")].find(link => link.textContent === "Log in")?.click(); });
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay"); }, { timeout: 3000 });
  });

  it_m1.each([false, true])("opens login from a stale signup URL and shows served unfinished logout=%s", async logoutIncomplete => {
    window.history.replaceState(null, "", "/?onboarding=signup");
    const client = { ...appClient(), readProfileSession: async () => ({ state: "signed-out" as const, signUpRequired: false,
      ...(logoutIncomplete ? { logoutIncomplete: true as const } : {}) }) };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay"); }, { timeout: 3000 });
    assert_m1.equal(document.body.textContent?.includes(operatorFailureSentence("PROFILE_LOGOUT_INCOMPLETE")), logoutIncomplete);
    await act_m1(async () => { [...document.querySelectorAll("a")].find(link => link.textContent === "Sign up")?.click(); });
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Create your profile"); }, { timeout: 3000 });
  });

  it_m1("opens sign-up on a computer with no profiles", async () => {
    window.history.replaceState(null, "", "/");
    const client = { ...appClient(), readProfileSession: async () => ({ state: "signed-out" as const, signUpRequired: true }) };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Create your profile"); }, { timeout: 3000 });
  });

  it_m1("moves to login when the published sign-up cannot start the dashboard", async () => {
    const method = { state: "complete" as const, ceremonyObserved: true, portalAccepted: true, operatorConfirmed: false, exactCredentialRequestObserved: false };
    const ready = { browser: { state: "open" as const, generation: 1 }, state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", step: "ready" as const, methods: { key: method } };
    let finished = false;
    const client = { ...appClient(), readProfileSession: async () => finished ? { state: "signed-out" as const, signUpRequired: false } : ready,
      completeProfileOnboarding: async () => { finished = true; return PublicProfileStateSchema.parse({ state: "error", code: "INTERNAL_FAILURE" }); } };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await act_m1(async () => { [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Finish setup")?.click(); });
    assert_m1.equal(finished, true);
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay"); }, { timeout: 3000 });
  });
});

describe_m1("ds/TakeoverFrame — entering a takeover moves focus into it", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("focuses its own labelled section on mount", async () => {
    await mountTakeover("Activity report", [
      createElement_m1("button", { key: "b", type: "button" }, "Export"),
    ]);
    assert_m1.equal(document.activeElement === frameOf("Activity report"), true);
  });

  it_m1("leaves the door it was opened from — focus does not stay on the trigger", async () => {

    const door = document.createElement("button");
    door.type = "button";
    door.id = "the-door";
    document.body.append(door);
    door.focus();
    assert_m1.equal(document.activeElement === door, true, "the fixture must start with the door focused");

    await mountTakeover("Archive", [createElement_m1("button", { key: "b", type: "button" }, "Back")]);
    assert_m1.equal(document.activeElement !== door, true);
    assert_m1.equal(document.activeElement === frameOf("Archive"), true);
  });

  it_m1("is a focus target, not a tab stop", async () => {
    await mountTakeover("Workflow explorer", []);
    assert_m1.equal(frameOf("Workflow explorer").getAttribute("tabindex"), "-1");
  });

  it_m1("paints no focus ring — the UA's included", async () => {
    await mountTakeover("Workflow explorer", []);
    const cls = frameOf("Workflow explorer").className.split(/\s+/u);
    // Chromium applies focus-visible to programmatic focus; suppress the frame outline.
    assert_m1.ok(cls.includes("outline-none"), `the frame must suppress the UA ring: ${cls.join(" ")}`);
    // And it must not have opted INTO the product ring by accident.
    assert_m1.ok(!cls.includes("ds-focus"), "the frame is not an interactive control");
  });

  it_m1("does not steal focus from a descendant that took it in the same commit", async () => {
    // React autoFocus commits before passive effects; preserve a child control that already took focus.
    await mountTakeover("Settings", [
      createElement_m1("input", { key: "q", type: "search", autoFocus: true, "aria-label": "Search settings" }),
    ]);
    const focused = document.activeElement;
    assert_m1.ok(focused instanceof HTMLInputElement, `expected the search input to keep focus, got ${String(focused?.tagName)}`);
    assert_m1.equal(focused.getAttribute("aria-label"), "Search settings");
    assert_m1.equal(focused !== frameOf("Settings"), true);
  });
});

describe_m1("the two remaining takeovers use the shared focus boundary (UF-FU-1)", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("the retired UI catalog URL opens the first section without mounting its reader", async () => {
    await mountDashboard("?settings=ui-catalog");

    const frame = frameOf("Settings");
    assert_m1.equal(document.activeElement === frame, true);
    assert_m1.equal(
      document.querySelector('section[aria-label="UI catalog"]') === null, true,
      "the catalog must no longer mount a frame of its own",
    );
    assert_m1.doesNotMatch(frame.textContent ?? "", /UI catalog|No such settings section/u);
    assert_m1.match(frame.textContent ?? "", /General/u);
    assert_m1.equal([...frame.querySelectorAll("a")].some(link => link.textContent?.trim() === "UI catalog"), false);
    assert_m1.equal(takeFirstTab(frame).getAttribute("aria-label"), "Close settings");
    assert_m1.equal(
      document.querySelector('[aria-label="Close the UI catalog"]') === null, true,
      "a section may not carry a second exit from the page that contains it",
    );
  });
});

describe_m1("closing a route-backed takeover restores its toolbar door", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("returns intake focus to Start a run after the route unmounts", async () => {
    await mountDashboard("?intake=e1f2a3b4-0000-4000-8000-000000000001");
    await press(buttonNamed("Close"));

    const door = document.getElementById(RUN_START_DOOR_ID_m1);
    assert_m1.ok(door instanceof HTMLButtonElement, "the toolbar Start run door is missing");
    assert_m1.equal(door.getAttribute("aria-label"), "Start run");
    assert_m1.equal(document.activeElement === door, true);
    assert_m1.equal(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Import spreadsheet",
      ) === undefined, true,
      "the toolbar's Import spreadsheet door is retired — the Run Modal carries the handoff",
    );
  });
});

describe_m1("Settings exits share the page-owned draft guard", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("retains the draft when a Settings section switch is declined and restores focus after cancelled exits", async () => {
    await mountDashboard("?settings=general");
    const { input, value } = await dirtyBrowserSettings();
    const frame = frameOf("Settings");
    const themeRadios = [...document.querySelectorAll<HTMLInputElement>('[data-settings-path="appearance.theme"] input[type="radio"]')];
    const initialTheme = themeRadios.find(radio => radio.checked)?.value;
    const otherTheme = themeRadios.find(radio => !radio.checked);
    assert_m1.ok(otherTheme);
    await act_m1(async () => otherTheme.click());
    assert_m1.equal(themeRadios.find(radio => radio.checked)?.value, initialTheme === "light" ? "dark" : "light");
    const notifications = document.querySelector(".notice-bell");
    assert_m1.ok(notifications instanceof HTMLButtonElement);
    assert_m1.match(notifications.getAttribute("aria-label") ?? "", /^Notifications, \d+ unread$/u);
    await press(notifications);
    assert_m1.equal(frameOf("Settings") === frame, true, "opening notifications preserves the runtime draft owner");
    assert_m1.equal(input.value, value, "appearance and notification controls preserve runtime edits");
    await press(notifications);
    const sectionLink = (label: string): HTMLAnchorElement => {
      const link = [...document.querySelectorAll("nav[aria-label='Settings sections'] a")]
        .find(candidate => candidate.textContent?.trim() === label);
      assert_m1.ok(link instanceof HTMLAnchorElement, `missing section ${label}`);
      return link;
    };
    const editorLabel = sectionLink("General").textContent?.trim();
    assert_m1.equal(editorLabel, "General");
    const keyboard = sectionLink("Keyboard");
    await act_m1(async () => { keyboard.focus(); keyboard.click(); });
    await press(buttonNamed("Keep editing"));
    assert_m1.match(window.location.search, /settings=general/u);
    assert_m1.equal(document.activeElement?.isSameNode(keyboard), true);
    assert_m1.equal(document.querySelectorAll('section[aria-label="Settings"]').length, 1);
    const dashboard = buttonNamed("Close settings");
    await press(dashboard);
    await press(buttonNamed("Keep editing"));
    assert_m1.equal(document.activeElement === dashboard, true, "cancelling the shell exit restores focus to its persistent navigation control");
    assert_m1.match(window.location.search, /settings=general/u);
    await press(dashboard);
    await act_m1(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    assert_m1.equal(document.querySelector('[role="dialog"]') === null, true, "Escape closes the pending dirty-exit dialog");
    assert_m1.equal(document.activeElement === dashboard, true, "Escape restores focus to the persistent navigation control");
    const restored = document.querySelector<HTMLInputElement>(JOB_END_DATE);
    assert_m1.ok(restored instanceof HTMLInputElement);
    assert_m1.equal(restored.value, value);
    await press(buttonNamed("Close settings"));
    await press(buttonNamed("Discard changes"));
    assert_m1.equal(document.querySelector('section[aria-label="Settings"]') === null, true);
    assert_m1.equal(window.location.search.includes("catalog"), false);
    assert_m1.equal(document.activeElement?.id, "settings-gear");
  });

  it_m1("requires a discard before persistent rail navigation unmounts a dirty Settings draft", async () => {
    await mountDashboard("?settings=display");
    await dirtyBrowserSettings();

    await press(buttonNamed("Close settings"));
    assert_m1.ok(frameOf("Settings"), "a dirty rail navigation must leave Settings mounted for confirmation");
    assert_m1.match(document.body.textContent ?? "", /Discard changes\?/u);
    const discard = buttonNamed("Discard changes");
    await press(discard);
    assert_m1.equal(document.querySelector('section[aria-label="Settings"]') === null, true);
    assert_m1.ok(document.getElementById("dashboard-main-region"));
  });

  it_m1("allows persistent rail navigation immediately when the Settings draft is clean", async () => {
    await mountDashboard("?settings=display");
    await press(buttonNamed("Close settings"));
    assert_m1.equal(document.querySelector('section[aria-label="Settings"]') === null, true);
    assert_m1.equal(document.body.textContent?.includes("Discard changes?"), false);
    assert_m1.ok(document.getElementById("dashboard-main-region"));
  });

  it_m1("reconciles a dirty native popstate until the operator chooses an exit", async () => {
    await mountSettingsAtThirdHistoryEntry();
    await dirtyBrowserSettings();

    await moveHistory("back");
    assert_m1.ok(frameOf("Settings"));
    assert_m1.equal(window.location.search, "?settings=display", "the dirty route is restored before confirmation");
    await press(buttonNamed("Keep editing"));
    assert_m1.ok(frameOf("Settings"));
    assert_m1.equal(window.location.search, "?settings=display");
    await moveHistory("back");
    await press(buttonNamed("Discard changes"));
    await settleHistory();
    assert_m1.equal(window.location.search, "?day=2026-08-26", "discard replays the original destination rather than skipping it");

    await moveHistory("forward");
    assert_m1.equal(window.location.search, "?settings=display", "the cancellation preserves the entry ahead of the original destination");
  });

  it_m1("accepts a clean native popstate immediately", async () => {
    await mountSettingsAtThirdHistoryEntry();
    await moveHistory("back");
    assert_m1.equal(document.querySelector('section[aria-label="Settings"]') === null, true);
    assert_m1.equal(window.location.search, "?day=2026-08-26");
  });

  it_m1("preserves both native history entries when a dirty Settings exit is cancelled", async () => {
    await mountSettingsAtThirdHistoryEntry();
    await dirtyBrowserSettings();
    const cursor = window.history.state as { hrDashboardRouteCursor: number };
    await moveHistory("back");
    await press(buttonNamed("Keep editing"));
    assert_m1.ok(frameOf("Settings"));
    assert_m1.deepEqual(window.history.state, cursor, "cancelled navigation keeps the stable history cursor");
    await moveHistory("back");
    await press(buttonNamed("Discard changes"));
    await settleHistory();
    assert_m1.equal(window.location.search, "?day=2026-08-26");
    await moveHistory("forward");
    assert_m1.equal(window.location.search, "?settings=display", "cancelled navigation preserves the forward entry");
  });

  it_m1("accepts clean browser history navigation and preserves its forward destination", async () => {
    await mountSettingsAtThirdHistoryEntry();
    await moveHistory("back");
    assert_m1.equal(document.querySelector('section[aria-label="Settings"]') === null, true);
    await moveHistory("forward");
    assert_m1.equal(window.location.search, "?settings=display");
    assert_m1.ok(frameOf("Settings"));
  });
});
}

{


Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
Reflect.set(globalThis, 'ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let root: Root_m2 | undefined;
const disposers: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => {
  await act_m2(async () => {
    root?.unmount(); root = undefined;
    for (const dispose of disposers.splice(0)) await dispose();
  });
  document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, '', '/');
};
afterEach_m2(_afterEachFixture0);
async function settle() { await act_m2(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
const liveToasts = () => [...document.querySelectorAll('[data-slot="toast"]')].filter(node => !node.hasAttribute("data-ending-style"));
/** Waits for the read-back that settles an unknown outcome; nothing is shown before it ends. */
async function settledToast(text: RegExp) { await vi_m1.waitFor(async () => { await settle(); assert_m2.ok(liveToasts().some(node => text.test(node.textContent ?? "")), `no toast ${text}`); }, { timeout: 8000, interval: 50 }); }

function servedSessionMocks(workflows: Parameters<typeof MOCK_WORKFLOW_COMPOSITION_m2>[0]) {
  const composition = MOCK_WORKFLOW_COMPOSITION_m2(workflows);
  const registered = new Set(workflows.map(flow => flow.workflowId));
  for (const id of Object.keys(WORKFLOW_SOURCES)) assert_m2.equal(composition.sources[id], registered.has(id) ? "served" : "hidden", id);
  return Object.freeze({ ...composition, sessionsHarness: undefined });
}
async function mount(options: { boot?: Promise<Response>; bootFailure?: boolean; delayDay?: boolean; search?: string; settingsRead?: () => unknown; command?: (body: unknown) => Promise<Response>; workflowComposition?: typeof MOCK_WORKFLOW_COMPOSITION_m2; accountless?: boolean; preferences?: ReturnType<typeof createPersonPreferences> } = {}) {
  const { app } = createFixtureBff_m2();
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const requests: { url: string; resume?: string | null }[] = [];
  let open = true;
  const publish = (stream: ReadableStreamDefaultController<Uint8Array>, message: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`));
  let cursor = 0;
  const snapshot = (stream: ReadableStreamDefaultController<Uint8Array>, day: DashboardDayWire_m2) => {
    cursor = Number(String(day.snapshotCursor).slice('pc:'.length));
    publish(stream, { type: 'hello', wireVersion: 1, descriptorHash: day.descriptorHash, projectionGeneration: day.projectionGeneration, cursor: day.snapshotCursor });
    publish(stream, { type: 'snapshot', topic: 'dashboard-day', rows: [], cursor: day.snapshotCursor, position: 0, payload: day });
  };
  const client = createDashboardClient_m2({ baseUrl: 'http://fault.test', fetchImpl: async (url, init) => {
    const headers = new Headers(init?.headers);
    requests.push({ url, resume: headers.get('last-event-id') });
    if (url.endsWith('/bootstrap')) {
      if (options.boot) return options.boot;
      if (options.bootFailure) return Response.json({ code: 'FIXTURE_UNAVAILABLE', message: 'Synthetic boot unavailable' }, { status: 503 });
    }
    if (options.accountless === true && url.endsWith("/profile/state")) return Response.json({ ...FIXTURE_ACTIVE_PROFILE_STATE, account: undefined });
    if (url.endsWith("/settings/editable") && options.settingsRead !== undefined) return Response.json(options.settingsRead());
    if (url.includes('/events/v1?')) {
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        streams.push(controller);
        if (!options.delayDay) snapshot(controller, FIXTURE_DAY_WIRE_m2);
        const abort = () => { try { controller.close(); } catch { /* The fixture may already be disconnected. */ } };
        init?.signal?.addEventListener('abort', abort, { once: true });
        disposers.push(() => init?.signal?.removeEventListener('abort', abort));
      } });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }
    assert_m2(open, 'no request after fixture disposal');
    if (url.endsWith('/commands') && options.command !== undefined) {
      if (typeof init?.body !== "string") throw new Error("fixture command body missing");
      return options.command(JSON.parse(init.body) as unknown);
    }
    return app.request(url, init);
  } });
  window.history.replaceState(null, '', `/?day=${FIXTURE_DAY_WIRE_m2.day}${options.search ? `&${options.search}` : ""}`);
  const preview = options.preferences ?? createPersonPreferences("preview", { ...NEUTRAL_PERSON_PREFERENCES, workflowPanelMode: "sidebar" });
  const host = document.createElement('div'); document.body.append(host); root = createRoot_m2(host);
  const workflowComposition = options.workflowComposition ?? MOCK_WORKFLOW_COMPOSITION_m2;
  await act_m2(async () => root?.render(createElement_m2(DashboardClientProvider_m2, { client, children: createElement_m2(DashboardApp_m2, { workflowComposition, previewPreferences: preview }) })));
  await settle(); disposers.push(() => { open = false; });
  return { host, requests, streams,
    deliver: async (day: DashboardDayWire_m2, index = streams.length - 1) => { await act_m2(async () => snapshot(streams[index], day)); await settle(); },
    /** A malformed envelope stops the subscription for good. */
    stop: async () => { await act_m2(async () => publish(streams.at(-1)!, "malformed")); await settle(); },
    disconnect: async () => { await act_m2(async () => streams.at(-1)!.error(new Error('Synthetic disconnect'))); await settle(); },
    /** The settings row the hub sends after an ordinary commit, as a rows-only change. */
    settingsRow: (value: unknown) => {
      const stream = streams.at(-1); assert_m2(stream, 'no stream to carry the settings row');
      cursor += 1;
      publish(stream, { type: 'change', topic: 'dashboard-day', after: `pc:${String(cursor - 1)}`, cursor: `pc:${String(cursor)}`, position: 0,
        rows: [{ model: 'settings', key: 'editable', value: { state: 'available', value } }] });
    },
    stale: async (day: DashboardDayWire_m2) => { await act_m2(async () => publish(streams.at(-1)!, { type: 'snapshot', topic: 'dashboard-day', rows: [], cursor: day.snapshotCursor, position: 0, payload: day })); await settle(); },
  };
}
it_m2("renders an authenticated child workflow without a public launch source", async () => {
  const parent = FIXTURE_DAY_WIRE_m2.queueSurfaces.find(row => row.surfaceKind === "operation");
  assert_m2.ok(parent?.surfaceKind === "operation");
  const member = FIXTURE_DAY_WIRE_m2.queueSurfaces.find(row => row.runId === parent.memberRunIds[0]);
  assert_m2.ok(member);
  // A lone member that repeats its parent's status draws no row of its own, so this child differs from it.
  const rows = [parent, { ...member, workflowId: "ocr-page", status: member.status === "queued" ? "blocked" as const : "queued" as const }];
  const day = DashboardDayWireSchema_m2.parse({ ...FIXTURE_DAY_WIRE_m2, snapshotCursor: "pc:201",
    queueSurfaces: rows, attemptHistory: undefined });
  const h = await mount();
  await h.deliver(day);
  assert_m2.ok(h.host.textContent?.includes(parent.title));
  assert_m2.ok(h.host.textContent?.includes(member.title));
  const memberLine = h.host.querySelector(`[data-demo-row-id="${member.runId}"]`);
  assert_m2.ok(memberLine instanceof HTMLElement);
  await act_m2(async () => memberLine.click());
  await settle();
  assert_m2.ok(h.host.querySelector(`[data-demo-row-id="${parent.runId}"]`));
  assert_m2.ok(h.host.querySelector(`[data-demo-row-id="${member.runId}"]`));
});
function withTitle(title: string, cursor: string, revision: number): DashboardDayWire_m2 {
  return DashboardDayWireSchema_m2.parse({ ...FIXTURE_DAY_WIRE_m2, snapshotCursor: cursor,
    queueSurfaces: FIXTURE_DAY_WIRE_m2.queueSurfaces.map(row => row.surfaceKind === 'single' ? { ...row, title, rowRevision: revision, actions: row.actions.map(action => action.kind === "command" ? { ...action, expectedVersion: revision } : action) } : row) });
}

describe_m2('real mounted dashboard through the typed mock transport', () => {

  for (const stored of [false, true]) it_m2(`settles an ordinary save whose reply was lost from its read-back (${stored ? "stored" : "not stored"})`, async () => {
    const commands: unknown[] = [];
    const authority = await syntheticSettingsAuthority(); disposers.push(authority.close);
    const h = await mount({ search: "settings=performance", settingsRead: authority.read, command: body => {
      commands.push(body);
      if (stored) authority.execute(CommandRequestSchema.parse(body));
      return Promise.reject(new Error("private-transport-sentinel"));
    } });
    const label = [...h.host.querySelectorAll("label")].find(candidate => candidate.textContent?.trim() === "Task");
    assert_m2.ok(label, "missing Task label");
    const input = document.getElementById(label.htmlFor);
    assert_m2.ok(input instanceof HTMLInputElement);
    const original = input.value;
    assert_m2.notEqual(original, "240");
    await act_m2(async () => {
      input.focus();
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (typeof descriptor?.set !== "function") throw new Error("fixture input setter missing");
      descriptor.set.call(input, "240");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act_m2(async () => input.blur()); await settle();
    assert_m2.equal(liveToasts().length, 0, "nothing is shown while the save is read back");
    if (stored) await act_m2(async () => { await new Promise(resolve => setTimeout(resolve, 3000)); });
    else await settledToast(/Settings weren't saved/u);
    const toasts = liveToasts();
    assert_m2.equal(toasts.length, stored ? 0 : 1, stored ? "a save found by reading back shows no message" : "one failure toast");
    if (!stored) assert_m2.match(toasts[0]?.textContent ?? "", /The previous value is back\./u);
    assert_m2.doesNotMatch(document.body.textContent ?? "", /unconfirmed|outcome is uncertain|Command result|private-transport-sentinel/u);
    assert_m2.equal([...document.querySelectorAll("button")].some(candidate => candidate.textContent === "Retry exact attempt"), false);
    assert_m2.equal(input.value, stored ? "240" : original);
    assert_m2.equal(input.disabled, false, "the field works again without a reload");
    await settle(); assert_m2.equal(commands.length, 1, "a lost reply is read back, never resent");
  });

  for (const settlement of ["confirmed", "conflict", "refused"] as const) it_m2(`settles an ordinary Settings save on a ${settlement} reply with one toast`, async () => {
    const commands: unknown[] = [];
    const authority = await syntheticSettingsAuthority(); disposers.push(authority.close);
    const h = await mount({ search: "settings=performance", settingsRead: authority.read, command: body => {
      commands.push(body);
      const command = CommandRequestSchema.parse(body);
      if (settlement === "confirmed") {
        const reply = authority.execute(command);
        h.settingsRow(authority.read());
        return Promise.resolve(Response.json(reply));
      }
      return Promise.resolve(Response.json(settlement === "conflict"
        ? { state: "conflict", commandId: command.commandId, currentVersion: 0, message: "Synthetic conflict" }
        : { state: "rejected", commandId: command.commandId, code: "invalid-value", message: "Synthetic refusal" }));
    } });
    const label = [...h.host.querySelectorAll("label")].find(candidate => candidate.textContent?.trim() === "Task");
    assert_m2.ok(label, "missing Task label");
    const input = document.getElementById(label.htmlFor);
    assert_m2.ok(input instanceof HTMLInputElement);
    const original = input.value;
    assert_m2.notEqual(original, "240");
    await act_m2(async () => {
      input.focus();
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (typeof descriptor?.set !== "function") throw new Error("fixture input setter missing");
      descriptor.set.call(input, "240");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert_m2.equal(input.value, "240", "the new value shows at once");
    await act_m2(async () => input.blur()); await settle();
    assert_m2.equal(commands.length, 1);
    const toasts = [...document.querySelectorAll('[data-slot="toast"]')].filter(node => !node.hasAttribute("data-ending-style"));
    assert_m2.equal(toasts.length, 1);
    assert_m2.doesNotMatch(toasts[0]?.textContent ?? "", /save unconfirmed|Command result|Synthetic/u);
    if (settlement === "confirmed") {
      assert_m2.match(toasts[0]?.textContent ?? "", /Saved Task/u);
      assert_m2.equal(input.value, "240");
    } else {
      assert_m2.match(toasts[0]?.textContent ?? "", /Settings weren't saved/u);
      assert_m2.match(toasts[0]?.textContent ?? "", /The previous value is back\./u);
      assert_m2.equal(input.value, original);
    }
    assert_m2.equal([...document.querySelectorAll("button")].some(candidate => candidate.textContent === "Retry exact attempt"), false);
    await settle(); assert_m2.equal(commands.length, 1, "a settled save is never retried");
  });

  it_m2("ends a display preference save at once when the stream stops while it waits for its row", async () => {
    const authority = await syntheticSettingsAuthority(); disposers.push(authority.close);
    const preferences = createPersonPreferences("person");
    let commands = 0;
    const h = await mount({ preferences, settingsRead: authority.read, command: body => {
      commands += 1;
      return Promise.resolve(Response.json(authority.execute(CommandRequestSchema.parse(body))));
    } });
    assert_m2.equal(preferences.snapshot().state, "ready");
    let saving: ReturnType<typeof preferences.change> | undefined;
    await act_m2(async () => { saving = preferences.change({ "preferences.animations": { set: !preferences.snapshot().value.animations } }); });
    await settle();
    assert_m2.equal(commands, 1); assert_m2.equal(preferences.snapshot().state, "saving");
    await h.stop();
    assert_m2.equal(preferences.snapshot().state, "ready", "the stop ends the wait, not its bound");
    assert_m2.equal(await saving, false);
    assert_m2.ok(liveToasts().some(node => /Settings weren't saved/u.test(node.textContent ?? "")));
  });

  for (const landed of [true, false]) it_m2(`reads a lost credentials save back without resending it (${landed ? "landed" : "not landed"}) and the next save reaches Relay`, async () => {
    const commands: unknown[] = [];
    const authority = await syntheticSettingsAuthority(); disposers.push(authority.close);
    const h = await mount({ accountless: true, search: "settings=credentials", settingsRead: authority.read, command: body => {
      commands.push(body);
      const command = ProtectedSettingsCommandRequestSchema.parse(body);
      if (landed || commands.length > 1) {
        const applied = authority.credentials.apply(ProtectedSettingsApplyInputSchema.parse({
          ...command.payload,
          commandId: command.commandId,
          commandFingerprint: deriveSettingsCommandFingerprint(command),
          expectedRevision: command.target.expectedRevision,
          updatedAt: command.requestedAt,
        }));
        assert_m2.equal(applied.state, "applied");
      }
      if (commands.length > 1) return Promise.resolve(Response.json(authority.execute(command)));
      return Promise.reject(new Error("private-transport-sentinel"));
    } });
    const type = async (value: string) => {
      const label = [...h.host.querySelectorAll("label")].find(candidate => candidate.textContent?.trim() === "UCPath username");
      assert_m2.ok(label, "missing UCPath username label");
      const input = document.getElementById(label.htmlFor);
      assert_m2.ok(input instanceof HTMLInputElement);
      await act_m2(async () => {
        input.focus();
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        if (typeof descriptor?.set !== "function") throw new Error("fixture input setter missing");
        descriptor.set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act_m2(async () => input.blur()); await settle();
    };
    await type("private-credential-sentinel");
    assert_m2.equal(liveToasts().length, 0, "nothing is shown while the save is read back");
    if (landed) await act_m2(async () => { await new Promise(resolve => setTimeout(resolve, 3000)); });
    else await settledToast(/Credentials weren't saved/u);
    assert_m2.equal(liveToasts().length, landed ? 0 : 1, landed ? "a save found by reading back shows no message" : "one failure toast");
    assert_m2.equal(commands.length, 1, "a lost reply is read back, never resent");
    assert_m2.doesNotMatch(document.body.textContent ?? "", /unconfirmed|outcome is uncertain|Command result|private-credential-sentinel|private-transport-sentinel/u);
    assert_m2.equal([...document.querySelectorAll("button")].some(candidate => candidate.textContent === "Retry exact attempt"), false);
    await type("Synthetic credential");
    await settledToast(/Saved UCPath username/u);
    assert_m2.equal(commands.length, 2, "the read-back freed the lock: the next save reaches Relay");
  });
  it_m2("settles a lost ordinary save and a lost credentials save independently, each with its own result", async () => {
    const commands: ReturnType<typeof CommandRequestSchema.parse>[] = [];
    const authority = await syntheticSettingsAuthority(); disposers.push(authority.close);
    const h = await mount({ accountless: true, search: "settings=performance", settingsRead: authority.read, command: body => {
      const command = CommandRequestSchema.parse(body); commands.push(command);
      const attempts = commands.filter(candidate => candidate.commandId === command.commandId).length;
      if (attempts === 1) return Promise.reject(new Error("Synthetic lost response"));
      return Promise.resolve(Response.json(authority.execute(command)));
    } });
    const edit = async (field: string, value: string) => {
      const find = () => [...h.host.querySelectorAll("label")].find(candidate => candidate.textContent?.trim() === field);
      for (let tries = 0; find() === undefined && tries < 20; tries++) await settle();
      const label = find();
      assert_m2.ok(label);
      const input = document.getElementById(label.htmlFor); assert_m2.ok(input instanceof HTMLInputElement);
      await act_m2(async () => {
        input.focus();
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        if (typeof descriptor?.set !== "function") throw new Error("fixture input setter missing");
        descriptor.set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act_m2(async () => input.blur()); await settle();
    };
    await edit("Task", "240");
    await settledToast(/Settings weren't saved/u);
    const credentials = [...h.host.querySelectorAll<HTMLAnchorElement>("a")].find(button => button.textContent?.trim() === "Account");
    assert_m2.ok(credentials); await act_m2(async () => credentials.click()); await settle();
    await edit("UCPath username", "Synthetic credential");
    await settledToast(/Credentials weren't saved/u);
    assert_m2.equal(commands.length, 2, "each lost save is read back, never resent");
    assert_m2.notEqual(commands[0]?.commandId, commands[1]?.commandId);
    assert_m2.doesNotMatch(document.body.textContent ?? "", /unconfirmed|Retry exact attempt|outcome is uncertain/u);
  });
  it_m2("retains the served Delete run label when its original row disappears", async () => {
    const candidate = FIXTURE_DAY_WIRE_m2.queueSurfaces.find(row => row.surfaceKind === "single" && row.actions.some(action => action.kind === "command" && action.command === "delete"));
    assert_m2.ok(candidate);
    const action = candidate.actions.find(entry => entry.kind === "command" && entry.command === "delete");
    assert_m2.ok(action);
    assert_m2.equal(action.label, "Delete run");
    const commands: unknown[] = [];
    const h = await mount({ command: body => { commands.push(body); return Promise.reject(new Error("lost-response")); } });
    const row = h.host.querySelector(`[data-demo-row-id="${candidate.runId}"]`);
    assert_m2.ok(row);
    const button = [...row.querySelectorAll("button")].find(entry => entry.getAttribute("aria-label")?.startsWith(action.label));
    assert_m2.ok(button);
    await act_m2(async () => button.click());
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(entry => entry.textContent?.trim() === action.label);
    assert_m2.ok(confirm instanceof HTMLButtonElement);
    await act_m2(async () => confirm.click()); await settle();
    assert_m2.equal(commands.length, 1);
    await h.deliver(DashboardDayWireSchema_m2.parse({ ...FIXTURE_DAY_WIRE_m2, snapshotCursor: "pc:200", queueSurfaces: FIXTURE_DAY_WIRE_m2.queueSurfaces.filter(entry => entry.runId !== candidate.runId) }));
    assert_m2.equal(h.host.querySelector(`[data-demo-row-id="${candidate.runId}"]`) === null, true);
    assert_m2.ok([...document.querySelectorAll('[data-slot="toast"]')].some(toast => toast.textContent?.includes("Delete run: outcome unknown")), "the lost response stays visible as a sticky toast");
    const bell = h.host.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert_m2.ok(bell);
    await act_m2(async () => bell.click()); await settle();
    const review = [...document.querySelectorAll<HTMLButtonElement>("button.notice-main")].find(entry => entry.textContent?.includes("Delete run: outcome unknown"));
    assert_m2.ok(review, "the Priority notification offers the original request for review");
    await act_m2(async () => review.click());
    assert_m2.ok([...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.textContent?.includes("Recover previous Delete run")));
    assert_m2.equal(commands.length, 1, "reviewing recovery must not dispatch a second command");
  });
  it_m2('serves registered workflows, mocks the other previews, and serves Sessions', async () => {
    const h = await mount({ workflowComposition: servedSessionMocks });
    assert_m2.equal(h.streams.length, 1);
    assert_m2.equal(h.requests.some(request => request.url.includes(`/events/v1?topics=dashboard-day:${FIXTURE_DAY_WIRE_m2.day}`)), true);
    assert_m2.match(h.host.textContent ?? '', /Person Lookup/u);
    assert_m2(h.host.querySelector('[data-mock-ready="true"]'));
  });
  it_m2('keeps an unknown launch workflow in the explicit unavailable destination', async () => {
    const view = encodeURIComponent(JSON.stringify({ launchWorkflow: 'unregistered-workflow' }));
    const h = await mount({ workflowComposition: servedSessionMocks, search: `start=1&view=${view}` });
    assert_m2.match(h.host.textContent ?? '', /Destination unavailable/u);
    assert_m2.match(h.host.textContent ?? '', /This launch workflow is not registered/u);
    assert_m2.equal(h.streams.length, 1);
    const recover = [...h.host.querySelectorAll('button')].find(button => button.textContent === 'Open dashboard'); assert_m2(recover);
    await act_m2(async () => recover.click());
    assert_m2.equal(h.host.querySelectorAll('[aria-label="Session Panel"]').length, 1);
    assert_m2.equal(h.host.querySelectorAll('button[data-assistant-launcher]').length, 1);
  });
  it_m2('keeps slow bootstrap in loading geometry until a parsed response arrives', async () => {
    let resolve!: (response: Response) => void;
    const boot = new Promise<Response>(done => { resolve = done; });
    const h = await mount({ boot });
    assert_m2(h.host.querySelector('[aria-busy="true"]'));
    assert_m2.doesNotMatch(h.host.textContent ?? '', /No workflows|No .* runs|Could not load/u);
    const { app } = createFixtureBff_m2();
    await act_m2(async () => resolve(await app.request('/api/v1/bootstrap'))); await settle();
    assert_m2(h.host.querySelector('[aria-label="Queue"]'));
  });
  it_m2('shows an unavailable bootstrap without fixture success or a misleading empty queue', async () => {
    const h = await mount({ bootFailure: true });
    assert_m2(h.host.querySelector('[data-mock-ready="failed"]'));
    assert_m2.equal(h.host.querySelector('[aria-label="Queue"]') === null, true);
    assert_m2.equal(h.streams.length, 0);
  });
  it_m2('keeps an initially slow stream distinct from a loaded empty day', async () => {
    const h = await mount({ delayDay: true });
    assert_m2(h.host.querySelector('[aria-busy="true"]'));
    assert_m2.doesNotMatch(h.host.textContent ?? '', /No Person Lookup runs/u);
    await h.deliver(FIXTURE_DAY_WIRE_m2);
    assert_m2(h.host.querySelector('[aria-label="Queue"]'));
  });
  it_m2('ignores an older cursor after the current exact queue snapshot', async () => {
    const h = await mount();
    await h.deliver(withTitle('Current synthetic record', 'pc:200', 200));
    assert_m2.match(h.host.textContent ?? '', /Current synthetic record/u);
    await h.stale(withTitle('Stale synthetic record', 'pc:199', 199));
    assert_m2.doesNotMatch(h.host.textContent ?? '', /Stale synthetic record/u);
    assert_m2.match(h.host.textContent ?? '', /Current synthetic record/u);
  });
  it_m2('retains the last queue during reconnect and resumes with its exact cursor', async () => {
    const h = await mount();
    await h.deliver(withTitle('Before disconnect', 'pc:200', 200)); await h.disconnect();
    assert_m2.match(h.host.textContent ?? '', /Before disconnect/u);
    for (let count = 0; count < 100 && h.streams.length < 2; count++) await settle();
    assert_m2.equal(h.streams.length, 2);
    assert_m2.equal(h.requests.filter(request => request.url.includes('/events/v1?')).at(-1)?.resume, 'pc:200');
    await h.deliver(withTitle('After reconnect', 'pc:201', 201));
    assert_m2.match(h.host.textContent ?? '', /After reconnect/u);
    assert_m2.doesNotMatch(h.host.textContent ?? '', /Before disconnect/u);
  });
});
}

{

const APP = readFileSync_m3(new FileURL("../../../src/dashboard/app/dashboard-app.tsx", import.meta.url), "utf8");
const LAUNCHER_MODEL = readFileSync_m3(new FileURL("../../../src/dashboard/surfaces/assistant/assistant-controller-model.ts", import.meta.url), "utf8");
const OVERLAY = readFileSync_m3(new FileURL("../../../src/dashboard/ds/primitives/base-toast.tsx", import.meta.url), "utf8");

function sourceSlice(source: string, start: string, end: string, label: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert_m3.ok(from >= 0 && to > from, `could not read ${label} from its source boundary`);
  return source.slice(from, to);
}

describe_m3("shell and queue structural fidelity", () => {

  it_m3("places the floor-bearing root outside both providers", () => {
    const rootStart = APP.indexOf("<div\n      data-app-root=\"\"");
    const tooltipStart = APP.indexOf("<TooltipProvider delayDuration={200}>", rootStart);
    const toastStart = APP.indexOf("<ToastProvider>", tooltipStart);
    const toastEnd = APP.indexOf("</ToastProvider>", toastStart);
    const tooltipEnd = APP.indexOf("</TooltipProvider>", toastEnd);
    const rootEnd = APP.indexOf("</div>", tooltipEnd);

    assert_m3.ok(rootStart >= 0, "the app root must be a real outer DOM node");
    assert_m3.ok(rootStart < tooltipStart && tooltipStart < toastStart, "providers must be descendants of the root");
    assert_m3.ok(toastEnd < tooltipEnd && tooltipEnd < rootEnd, "the root must close after both providers");
    assert_m3.match(
      APP.slice(rootStart, tooltipStart),
      /"--ds-toast-inset-bottom": "calc\(2 \* \(var\(--ds-h-bar\) \+ var\(--ds-space-loose\)\)\)"/u,
      "the outer root is the one place that sets the floor above the Sessions bar and the Logs footer",
    );
    assert_m3.match(
      OVERLAY,
      /fixed bottom-\[max\(var\(--ds-toast-inset-bottom,0\.75rem\),calc\(var\(--session-dock-h,0px\)\+1\.25rem\)\)\] left-1\/2/u,
      "the fixed toast viewport is bottom-centred on the Sessions bar floor or above the open Sessions panel, whichever is higher, with the whole stack growing upward from there",
    );
    assert_m3.match(
      LAUNCHER_MODEL,
      /var\(--ds-toast-inset-bottom\)/u,
      "the docked assistant launcher consumes the shell-owned floor",
    );
  });

  it_m3("retains the desktop canvas floor and internal viewport clip", () => {
    const root = sourceSlice(APP, "<div\n      data-app-root=\"\"", ">\n    <TooltipProvider", "the app root opening tag");
    for (const token of ["h-screen", "min-h-[var(--ds-h-desktop-min)]", "min-w-[var(--ds-w-desktop-min)]", "overflow-hidden"]) {
      assert_m3.ok(root.includes(token), `the desktop canvas must retain ${token}`);
    }
    assert_m3.doesNotMatch(root, /min-h-0/u, "min-h-0 belongs to the root's flex child, not the demo root");
  });
});
}
