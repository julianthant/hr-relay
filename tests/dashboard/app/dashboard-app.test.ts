import { chatGptStatusFixture } from "../../support/helpers/chatgpt-status-fixture.js";
import { createPersonPreferences } from "../../../src/dashboard/state/person-preferences-model.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../src/models/config/person-preferences.js";
import { syntheticSettingsAuthority } from "../../support/helpers/dashboard/settings-harness.js";
import { ApplicationLifecycleSchema } from "../../../src/models/dashboard/application-lifecycle.js";
import { FixtureCommandBinding } from "../../support/helpers/dashboard/command-binding.js";
import { useDashboardCommandBinding } from "../../../src/dashboard/state/client-context.js";
import { QueueToolbar, ConfirmBulkCommandDialog, type PendingBulkCommand } from "../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { CommandRecovery } from "../../../src/dashboard/surfaces/shared/actions/command-recovery.js";
import { composeBulkRunCommand, planBulkVerb } from "../../../src/dashboard/app/commands/bulk-dispatch.js";
import { verifyShellCommandEffect } from "../../../src/dashboard/app/commands/command-dispatch.js";
import type { CommandOutcome, CommandExecutionOptions } from "../../../src/dashboard/app/commands/command-executor.js";
import { CommandRequestSchema, BulkRunCommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { deriveBulkChildCommandId } from "../../../src/rules/commands/command-groups.js";
import { URL as FileURL } from "node:url";
// @vitest-environment jsdom
import { FIXTURE_EDITABLE_SETTINGS as FIXTURE_EDITABLE_SETTINGS_m1 } from "../../mocks/helpers/fixture-settings.js";
import { MOCK_WORKFLOW_COMPOSITION as MOCK_WORKFLOW_COMPOSITION_m1 } from "../../mocks/helpers/workflow-composition.js";
// @vitest-environment jsdom

import assert_m1 from "node:assert/strict";
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
import { act as act_m2,createElement as createElement_m2, useState, Fragment } from 'react';
import { createRoot as createRoot_m2,type Root as Root_m2 } from 'react-dom/client';
import { afterEach as afterEach_m2,describe as describe_m2,describe as describe_m3,it as it_m2,it as it_m3 } from 'vitest';
import { DashboardApp as DashboardApp_m2 } from '../../../src/dashboard/app/dashboard-app.js';
import { createDashboardClient as createDashboardClient_m2 } from '../../../src/dashboard/client/index.js';
import { DashboardClientProvider as DashboardClientProvider_m2 } from '../../../src/dashboard/state/client-context.js';
import { DashboardDayWireSchema as DashboardDayWireSchema_m2,type DashboardDayWire as DashboardDayWire_m2 } from '../../../src/models/dashboard/projection.js';
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m2 } from '../../mocks/helpers/fixture-queue.js';
import { MOCK_WORKFLOW_COMPOSITION as MOCK_WORKFLOW_COMPOSITION_m2 } from "../../mocks/helpers/workflow-composition.js";
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
    subscribeProfileSessionStale: () => () => undefined,
    bootstrap: () => Promise.resolve(APP_BOOTSTRAP),
    applicationLifecycle: () => Promise.resolve(ApplicationLifecycleSchema.parse({ runtimeGeneration: 1, state: "ready", pause: "running", targets: [], update: "installer-unavailable" })),
    chatGptAccount: async () => chatGptStatusFixture(await (Promise.resolve({ state: "signed-out" }))),
    subscribeDay: (input: Parameters<DashboardClient_m1["subscribeDay"]>[0]) => {
      input.onDay(APP_DAY);
      input.onState({ state: "live" });
      return { close: () => undefined };
    },
    calendar: (input: Parameters<DashboardClient_m1["calendar"]>[0]) => Promise.resolve(CALENDAR(input)),

    intakeSession: () => new Promise<never>(() => undefined),
    editableSettings: () => Promise.resolve(EDITABLE_SETTINGS),
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
  await mountSurface(appClient(), createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
  await act_m1(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountDashboardAtCurrentHistoryEntry(): Promise<void> {
  await mountSurface(appClient(), createElement_m1(DashboardApp_m1, { workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
  await act_m1(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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

async function dirtyBrowserSettings(): Promise<{ input: HTMLButtonElement; value: string }> {
  const input = document.querySelector('[data-settings-path="browser.headless"] button[aria-label="Browser window"]');
  assert_m1.ok(input instanceof HTMLButtonElement, "Settings browser window control did not mount");
  assert_m1.notEqual(input.dataset.value, "Small");
  await act_m1(async () => input.click());
  const option = document.querySelector('[role="option"][data-value="Small"]');
  assert_m1.ok(option instanceof HTMLElement);
  await act_m1(async () => option.click());
  assert_m1.equal(input.dataset.value, "Small");
  return { input, value: "Small" };
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
        await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served",
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
      if (path.endsWith("/resume")) { resumes++; return Response.json(active(1 + resumes)); }
      if (path.endsWith("/bootstrap")) {
        if (defer) { defer = false; dispatched.resolve(); return old.promise; }
        if (restarted && resumes === 0 || invalidateFresh) return stale();
        return Response.json(APP_BOOTSTRAP);
      }
      throw new Error(`unexpected draft-preservation request ${path}`);
    } });
    const client: DashboardClient_m1 = { ...appClient(), bootstrap: () => live.bootstrap(), readProfileSession: () => live.readProfileSession(),
      resumeProfile: () => live.resumeProfile(), subscribeProfileSessionStale: listener => live.subscribeProfileSessionStale(listener) };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => assert_m1.ok(document.querySelector(".dashboard-shell")));
    defer = true; const pending = assert_m1.rejects(client.bootstrap()); await dispatched.promise;
    try {
      restarted = true;
      await act_m1(async () => { await assert_m1.rejects(client.bootstrap()); });
      await vi_m1.waitFor(() => { assert_m1.equal(resumes, 1); assert_m1.ok(document.querySelector(".dashboard-shell")); });
      await act_m1(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Start run"]')?.click(); });
      const dialog = document.querySelector('[role="dialog"]'); assert_m1.ok(dialog);
      const workflow = [...dialog.querySelectorAll("button")].find(button => button.textContent?.includes("Person Lookup"));
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
      if (path.endsWith("/resume")) { resumes++; return Response.json({ ...active, epoch: 1 + resumes }); }
      if (path.endsWith("/bootstrap")) {
        if (restarted && resumes === 0) { refusedReads++; return Response.json({ state: "refused", code: "PROFILE_SESSION_STALE" }, { status: 401 }); }
        return Response.json(APP_BOOTSTRAP);
      }
      throw new Error(`unexpected restart fixture request ${path}`);
    } });
    const client: DashboardClient_m1 = { ...appClient(), bootstrap: () => live.bootstrap(), readProfileSession: () => live.readProfileSession(),
      resumeProfile: () => live.resumeProfile(), subscribeProfileSessionStale: listener => live.subscribeProfileSessionStale(listener) };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => assert_m1.ok(document.querySelector(".dashboard-shell")));
    restarted = true;
    await act_m1(async () => { await assert_m1.rejects(client.bootstrap()); });
    await vi_m1.waitFor(() => {
      assert_m1.equal(resumes, 1); assert_m1.ok(document.querySelector(".dashboard-shell"));
      assert_m1.equal(document.querySelector(".hub-onboarding"), null);
    });
    assert_m1.equal(refusedReads, 1);
    assert_m1.deepEqual(await client.readProfileSession(), { ...active, epoch: 2 });
  });

  it_m1("resumes the profile still signed in and shows the normal login form if that is refused", async () => {
    window.history.replaceState(null, "", "/?onboarding=signup");
    let resumed = 0;
    const client = { ...appClient(), readProfileSession: async () => ({ state: "signed-out" as const, signUpRequired: false, resumable: true as const }),
      resumeProfile: async () => { resumed++; return { state: "refused" as const, code: "PROFILE_TRANSITION_BLOCKED" as const }; } };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
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
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
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
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
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
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
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
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
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
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
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
      assert_m1.equal(document.querySelector(".form-error")?.textContent, operatorFailureSentence("PROFILE_SIGN_IN_REFUSED"));
    }
  });

  it_m1("opens the sign-up form from the Sign up link after a refused login", async () => {
    window.history.replaceState(null, "", "/");
    const client = { ...appClient(), readProfileSession: async () => ({ state: "refused" as const, code: "PROFILE_SIGN_IN_REFUSED" as const }) };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
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
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Log in to Relay"); }, { timeout: 3000 });
    assert_m1.equal(document.body.textContent?.includes(operatorFailureSentence("PROFILE_LOGOUT_INCOMPLETE")), logoutIncomplete);
    await act_m1(async () => { [...document.querySelectorAll("a")].find(link => link.textContent === "Sign up")?.click(); });
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Create your profile"); }, { timeout: 3000 });
  });

  it_m1("opens sign-up on a computer with no profiles", async () => {
    window.history.replaceState(null, "", "/");
    const client = { ...appClient(), readProfileSession: async () => ({ state: "signed-out" as const, signUpRequired: true }) };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
    await vi_m1.waitFor(() => { assert_m1.equal(document.querySelector("h1")?.textContent, "Create your profile"); }, { timeout: 3000 });
  });

  it_m1("moves to login when the published sign-up cannot start the dashboard", async () => {
    const method = { state: "complete" as const, ceremonyObserved: true, portalAccepted: true, operatorConfirmed: false, exactCredentialRequestObserved: false };
    const ready = { browser: { state: "open" as const, generation: 1 }, state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", step: "ready" as const, methods: { key: method, touch: method } };
    let finished = false;
    const client = { ...appClient(), readProfileSession: async () => finished ? { state: "signed-out" as const, signUpRequired: false } : ready,
      completeProfileOnboarding: async () => { finished = true; return PublicProfileStateSchema.parse({ state: "error", code: "INTERNAL_FAILURE" }); } };
    await mountSurface(client, createElement_m1(DashboardApp_m1, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION_m1 }));
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


  it_m1("the retired UI catalog URL shows an explicit removal notice without mounting its reader", async () => {
    await mountDashboard("?settings=ui-catalog");

    const frame = frameOf("Settings");
    assert_m1.equal(document.activeElement === frame, true);
    assert_m1.equal(
      document.querySelector('section[aria-label="UI catalog"]'),
      null,
      "the catalog must no longer mount a frame of its own",
    );
    assert_m1.match(frame.textContent ?? "", /UI catalog removed/u);
    assert_m1.equal([...frame.querySelectorAll("a")].some(link => link.textContent?.trim() === "UI catalog"), false);
    assert_m1.equal(takeFirstTab(frame).getAttribute("aria-label"), "Back to dashboard");
    assert_m1.equal(
      document.querySelector('[aria-label="Close the UI catalog"]'),
      null,
      "a section may not carry a second exit from the page that contains it",
    );
  });
});

describe_m1("closing a route-backed takeover restores its toolbar door", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("returns intake focus to Start a run after the route unmounts", async () => {
    await mountDashboard("?intake=e1f2a3b4-0000-4000-8000-000000000001");
    await press(buttonNamed("Close"));

    const door = buttonNamed("Start run");
    assert_m1.equal(door.id, RUN_START_DOOR_ID_m1);
    assert_m1.equal(document.activeElement === door, true);
    assert_m1.equal(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Import spreadsheet",
      ),
      undefined,
      "the toolbar's Import spreadsheet door is retired — the Run Modal carries the handoff",
    );
  });
});

describe_m1("Settings exits share the page-owned draft guard", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("retains the same draft across catalog subroutes, restores cancelled-dialog focus and exits to gear", async () => {
    await mountDashboard("?settings=general");
    const { input, value } = await dirtyBrowserSettings();
    const frame = frameOf("Settings");
    const themeRadios = [...document.querySelectorAll<HTMLInputElement>('[data-settings-path="appearance.theme"] input[type="radio"]')];
    const initialTheme = themeRadios.find(radio => radio.checked)?.value;
    const otherTheme = themeRadios.find(radio => !radio.checked);
    assert_m1.ok(otherTheme);
    await act_m1(async () => otherTheme.click());
    assert_m1.equal(themeRadios.find(radio => radio.checked)?.value, initialTheme === "light" ? "dark" : "light");
    const notifications = document.querySelector(".rail-notification-toggle");
    assert_m1.ok(notifications instanceof HTMLButtonElement);
    assert_m1.match(notifications.getAttribute("aria-label") ?? "", /^Notifications, \d+ unread$/u);
    await press(notifications);
    assert_m1.equal(frameOf("Settings"), frame, "opening notifications preserves the runtime draft owner");
    assert_m1.equal(input.dataset.value, value, "browser appearance and notification controls preserve runtime edits");
    await press(notifications);
    const sectionLink = (label: string): HTMLAnchorElement => {
      const link = [...document.querySelectorAll("nav[aria-label='Settings sections'] a")]
        .find(candidate => candidate.textContent?.trim() === label);
      assert_m1.ok(link instanceof HTMLAnchorElement, `missing section ${label}`);
      return link;
    };
    const editorLabel = sectionLink("General").textContent?.trim();
    assert_m1.equal(editorLabel, "General");
    await act_m1(async () => sectionLink("Keyboard").click());
    assert_m1.match(window.location.search, /settings=keyboard/u);
    assert_m1.equal(document.querySelectorAll('section[aria-label="Settings"]').length, 1);
    const dashboard = buttonNamed("Back to dashboard");
    await press(dashboard);
    await press(buttonNamed("Keep editing"));
    assert_m1.equal(document.activeElement === dashboard, true, "cancelling the shell exit restores focus to its persistent navigation control");
    assert_m1.match(window.location.search, /settings=keyboard/u);
    await press(dashboard);
    await act_m1(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    assert_m1.equal(document.querySelector('[role="dialog"]') === null, true, "Escape closes the pending dirty-exit dialog");
    assert_m1.equal(document.activeElement === dashboard, true, "Escape restores focus to the persistent navigation control");
    await act_m1(async () => sectionLink("General").click());
    const restored = document.querySelector('[data-settings-path="browser.headless"] button[aria-label="Browser window"]');
    assert_m1.ok(restored instanceof HTMLButtonElement);
    assert_m1.equal(restored.dataset.value, value);
    await press(buttonNamed("Back to dashboard"));
    await press(buttonNamed("Discard changes"));
    assert_m1.equal(document.querySelector('section[aria-label="Settings"]') === null, true);
    assert_m1.equal(window.location.search.includes("catalog"), false);
    assert_m1.equal(document.activeElement?.id, "settings-gear");
  });

  it_m1("requires a discard before persistent rail navigation unmounts a dirty Settings draft", async () => {
    await mountDashboard("?settings=display");
    await dirtyBrowserSettings();

    await press(buttonNamed("Back to dashboard"));
    assert_m1.ok(frameOf("Settings"), "a dirty rail navigation must leave Settings mounted for confirmation");
    assert_m1.match(document.body.textContent ?? "", /Discard unsaved settings\?/u);
    const discard = buttonNamed("Discard changes");
    await press(discard);
    assert_m1.equal(document.querySelector('section[aria-label="Settings"]') === null, true);
    assert_m1.ok(document.getElementById("dashboard-main-region"));
  });

  it_m1("allows persistent rail navigation immediately when the Settings draft is clean", async () => {
    await mountDashboard("?settings=display");
    await press(buttonNamed("Back to dashboard"));
    assert_m1.equal(document.querySelector('section[aria-label="Settings"]') === null, true);
    assert_m1.equal(document.body.textContent?.includes("Discard unsaved settings?"), false);
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

function servedSessionMocks(workflows: Parameters<typeof MOCK_WORKFLOW_COMPOSITION_m2>[0]) {
  const composition = MOCK_WORKFLOW_COMPOSITION_m2(workflows);
  const registered = new Set(workflows.map(flow => flow.workflowId));
  for (const id of Object.keys(WORKFLOW_SOURCES)) assert_m2.equal(composition.sources[id], WORKFLOW_SOURCES[id] === "hidden" ? "hidden" : registered.has(id) ? "served" : "mock", id);
  return Object.freeze({ ...composition, sessions: "served" as const });
}
async function mount(options: { boot?: Promise<Response>; bootFailure?: boolean; delayDay?: boolean; search?: string; settingsRead?: () => unknown; command?: (body: unknown) => Promise<Response>; workflowComposition?: typeof MOCK_WORKFLOW_COMPOSITION_m2 } = {}) {
  const { app } = createFixtureBff_m2();
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const requests: { url: string; resume?: string | null }[] = [];
  let open = true;
  const publish = (stream: ReadableStreamDefaultController<Uint8Array>, message: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`));
  const snapshot = (stream: ReadableStreamDefaultController<Uint8Array>, day: DashboardDayWire_m2) => {
    publish(stream, { type: 'hello', wireVersion: 1, descriptorHash: day.descriptorHash, projectionGeneration: day.projectionGeneration, cursor: day.snapshotCursor });
    publish(stream, { type: 'snapshot', topic: 'dashboard-day', cursor: day.snapshotCursor, payload: day });
  };
  const client = createDashboardClient_m2({ baseUrl: 'http://fault.test', fetchImpl: async (url, init) => {
    const headers = new Headers(init?.headers);
    requests.push({ url, resume: headers.get('last-event-id') });
    if (url.endsWith('/bootstrap')) {
      if (options.boot) return options.boot;
      if (options.bootFailure) return Response.json({ code: 'FIXTURE_UNAVAILABLE', message: 'Synthetic boot unavailable' }, { status: 503 });
    }
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
  const preview = createPersonPreferences("preview", { ...NEUTRAL_PERSON_PREFERENCES, workflowPanelMode: "sidebar" });
  const host = document.createElement('div'); document.body.append(host); root = createRoot_m2(host);
  const workflowComposition = options.workflowComposition ?? MOCK_WORKFLOW_COMPOSITION_m2;
  await act_m2(async () => root?.render(createElement_m2(DashboardClientProvider_m2, { client, children: createElement_m2(DashboardApp_m2, { workflowComposition, previewPreferences: preview }) })));
  await settle(); disposers.push(() => { open = false; });
  return { host, requests, streams,
    deliver: async (day: DashboardDayWire_m2, index = streams.length - 1) => { await act_m2(async () => snapshot(streams[index], day)); await settle(); },
    disconnect: async () => { await act_m2(async () => streams.at(-1)!.error(new Error('Synthetic disconnect'))); await settle(); },
    stale: async (day: DashboardDayWire_m2) => { await act_m2(async () => publish(streams.at(-1)!, { type: 'snapshot', topic: 'dashboard-day', cursor: day.snapshotCursor, payload: day })); await settle(); },
  };
}
it_m2("renders an authenticated child workflow without a public launch source", async () => {
  const parent = FIXTURE_DAY_WIRE_m2.queueSurfaces.find(row => row.surfaceKind === "operation");
  assert_m2.ok(parent?.surfaceKind === "operation");
  const member = FIXTURE_DAY_WIRE_m2.queueSurfaces.find(row => row.runId === parent.memberRunIds[0]);
  assert_m2.ok(member);
  const rows = [parent, { ...member, workflowId: "ocr-page" }];
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
describe_m2("dispatchBulk's rejection arm (the selection band's bulk post)", () => {
  it_m2("preserves uncertainty from a post-dispatch throw", async () => {
    const bytes: string[] = [];
    let day = FIXTURE_DAY_WIRE_m2;
    const client = createDashboardClient_m2({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
      if (url.includes("/dashboard?day=")) return Response.json(day);
      if (typeof init?.body !== "string") throw new Error("missing bulk body");
      const body = init.body; bytes.push(body);
      const request = BulkRunCommandRequestSchema.parse(JSON.parse(body));
      if (bytes.length === 1) throw new Error("private transport sentinel");
      const ids = new Set(request.targets.map(target => target.runId));
      day = DashboardDayWireSchema_m2.parse({ ...day, queueSurfaces: day.queueSurfaces.map(row => ids.has(row.runId)
        ? { ...row, status: "cancelled", rowRevision: row.rowRevision + 1, actions: [], endedAt: { state: "present", value: row.updatedAt }, gateOpenedAt: { state: "absent", reason: "No open gate after cancellation" } } : row) });
      return Response.json({ state: "vector", bulkCommandId: request.bulkCommandId, type: request.type, requestedCount: request.targets.length,
        results: request.targets.map(target => ({ outcome: "applied", commandId: deriveBulkChildCommandId(request.bulkCommandId, target.runId), runId: target.runId, replayed: true, detail: "private server sentinel" })) });
    } });
    const published: CommandOutcome[] = [];
    function BulkHarness() {
      const binding = useDashboardCommandBinding();
      if (binding === undefined) throw new Error("missing fixture binding");
      const [selectMode, setSelectMode] = useState(false);
      const [selected, setSelected] = useState(false);
      const [pending, setPending] = useState<PendingBulkCommand | null>(null);
      const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
      const [, update] = useState(0);
      const candidates = FIXTURE_DAY_WIRE_m2.queueSurfaces.filter(row => row.parent === null).map(row => ({ runId: row.runId, title: row.title, actions: row.actions }));
      const plan = planBulkVerb(candidates, "cancel", candidates.map(row => row.runId));
      const options: CommandExecutionOptions = { scope: binding.scope, readback: (request, reply) => verifyShellCommandEffect(client, FIXTURE_DAY_WIRE_m2.day, request, reply),
        publish: outcome => { published.push(outcome); binding.feedback(outcome); update(value => value + 1); } };
      const entries = binding.executor.retainedAttempts().flatMap(attempt => attempt.outcome?.kind === "uncertain" && "targets" in attempt.request
        ? [{ inFlightKey: attempt.request.commandId, label: "cancel", targets: plan.eligible }] : []);
      return createElement_m2(Fragment, null,
        createElement_m2(QueueToolbar, { sort: "attention", onSort: () => undefined, selectMode, onSelectMode: setSelectMode, selectedCount: selected ? candidates.length : 0,
          visibleIds: candidates.map(row => row.runId), onSelectAll: () => setSelected(true), onClearSelection: () => setSelected(false), bulkPlans: selected ? [plan] : [], bulkUnavailable: [],
          onBulk: next => setPending({ plan: next }), bulkOutcome: null, onDismissBulkOutcome: () => undefined, onSelectRun: () => undefined }),
        createElement_m2(ConfirmBulkCommandDialog, { pending, onCancel: () => setPending(null), onConfirm: confirmed => {
          setPending(null);
          const composed = composeBulkRunCommand(confirmed.plan, { actorId: binding.scope.actorId, source: "queue", requestedAt: binding.authority.nowIso });
          if (composed.state !== "ready") throw new Error("bulk fixture composition refused");
          void binding.executor.execute(composed.request, options);
        } }),
        entries.map(entry => createElement_m2("button", { key: entry.inFlightKey, onClick: () => setRecoveryKey(entry.inFlightKey) }, `Review ${entry.label}`)), // stands in for the Priority notification's Review action
        createElement_m2(CommandRecovery, { entries, pendingKey: recoveryKey, onReview: setRecoveryKey, onReplay: entry => { setRecoveryKey(null); void binding.executor.replay(entry.inFlightKey, options); } }),
      );
    }
    const host = document.createElement("div"); document.body.append(host); root = createRoot_m2(host);
    await act_m2(async () => root?.render(createElement_m2(DashboardClientProvider_m2, { client, children: createElement_m2(FixtureCommandBinding, { actorId: "local-operator", children: createElement_m2(BulkHarness) }) })));
    const click = async (name: string) => {
      const button = [...document.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === name || candidate.textContent?.startsWith(name));
      assert_m2.ok(button, `missing ${name} action`);
      await act_m2(async () => button.click()); await settle();
    };
    await click("Select"); await click("Select all"); await click("Cancel");
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent?.startsWith("Cancel"));
    assert_m2.equal(confirm instanceof HTMLButtonElement, true, "missing bulk confirmation action");
    if (!(confirm instanceof HTMLButtonElement)) throw new Error("missing bulk confirmation action");
    await act_m2(async () => confirm.click()); await settle();
    assert_m2.equal(bytes.length, 1);
    assert_m2.match(document.body.textContent ?? "", /cancel: outcome unknown/u);
    assert_m2.doesNotMatch(document.body.textContent ?? "", /private transport sentinel|Command confirmed/u);
    await settle(); assert_m2.equal(bytes.length, 1, "uncertainty never automatically retries");
    await click("Review cancel"); await click("Resend original request");
    assert_m2.deepEqual(bytes, [bytes[0], bytes[0]], "recovery preserves the full parent envelope bytes");
    assert_m2.doesNotMatch(document.body.textContent ?? "", /cancel: outcome unknown/u, "confirmed replay clears recovery");
    assert_m2.doesNotMatch(document.body.textContent ?? "", /private server sentinel/u);
    assert_m2.equal(published[0]?.kind, "uncertain");
    assert_m2.equal(published.at(-1)?.kind, "confirmed", "success requires matching authoritative readback");
  });
});

function withTitle(title: string, cursor: string, revision: number): DashboardDayWire_m2 {
  return DashboardDayWireSchema_m2.parse({ ...FIXTURE_DAY_WIRE_m2, snapshotCursor: cursor,
    queueSurfaces: FIXTURE_DAY_WIRE_m2.queueSurfaces.map(row => row.surfaceKind === 'single' ? { ...row, title, rowRevision: revision, actions: row.actions.map(action => action.kind === "command" ? { ...action, expectedVersion: revision } : action) } : row) });
}

describe_m2('real mounted dashboard through the typed mock transport', () => {

  for (const save of [
    { section: "performance", field: "Task", value: "240", title: "Settings save unconfirmed" },
    { section: "credentials", field: "UCPath username", value: "private-credential-sentinel", title: "Credentials save unconfirmed" },
  ]) for (const replacement of ["confirmed", "conflict", "refused"] as const) it_m2(`replaces one ${save.title} warning on ${replacement} exact replay`, async () => {
    const commands: unknown[] = [];
    const authority = await syntheticSettingsAuthority(); disposers.push(authority.close);
    const h = await mount({ search: `settings=${save.section}`, settingsRead: authority.read, command: body => {
      commands.push(body);
      if (commands.length <= 2) return Promise.reject(new Error("private-transport-sentinel"));
      const command = CommandRequestSchema.parse(body);
      return Promise.resolve(replacement === "confirmed" ? Response.json(authority.execute(command)) : Response.json(replacement === "conflict"
        ? { state: "conflict", commandId: command.commandId, currentVersion: 0, message: "Synthetic conflict" }
        : { state: "rejected", commandId: command.commandId, code: "invalid-value", message: "Synthetic refusal" }));
    } });
    const label = [...h.host.querySelectorAll("label")].find(candidate => candidate.textContent?.trim() === save.field);
    assert_m2.ok(label, `missing ${save.field} label`);
    const input = document.getElementById(label.htmlFor);
    assert_m2.ok(input instanceof HTMLInputElement);
    await act_m2(async () => {
      input.focus();
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (typeof descriptor?.set !== "function") throw new Error("fixture input setter missing");
      descriptor.set.call(input, save.value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act_m2(async () => input.blur()); await settle();
    assert_m2.equal(commands.length, 1);
    const toasts = document.querySelectorAll('[data-slot="toast"]');
    assert_m2.equal(toasts.length, 1);
    assert_m2.equal(toasts[0]?.getAttribute("role"), "status");
    assert_m2.match(toasts[0]?.textContent ?? "", new RegExp(save.title, "u"));
    assert_m2.match(toasts[0]?.textContent ?? "", /Your draft is retained\. Retry the exact attempt to confirm the result\./u);
    assert_m2.doesNotMatch(toasts[0]?.textContent ?? "", /Command result|private-credential-sentinel|private-transport-sentinel/u);
    assert_m2.equal(input.value, save.value);
    await settle(); assert_m2.equal(commands.length, 1, "uncertainty must not retry automatically");
    const retry = async () => {
      const button = [...document.querySelectorAll("button")].find(candidate => candidate.textContent === "Retry exact attempt");
      assert_m2.ok(button, "missing exact retry");
      await act_m2(async () => button.click()); await settle();
    };
    await retry();
    assert_m2.equal(commands.length, 2);
    assert_m2.equal([...document.querySelectorAll('[data-slot="toast"]')].filter(node => !node.hasAttribute("data-ending-style")).length, 1, "repeated uncertainty shows one warning");
    await retry();
    assert_m2.equal(commands.length, 3);
    assert_m2.deepEqual(commands, [commands[0], commands[0], commands[0]], "all retries keep the original command identity and bytes");
    assert_m2.equal(toasts[0]?.isConnected === false || toasts[0]?.hasAttribute("data-ending-style"), true, "known replacement dismisses the exact original warning");
    const activeToasts = [...document.querySelectorAll('[data-slot="toast"]')].filter(node => !node.hasAttribute("data-ending-style"));
    assert_m2.equal(activeToasts.length, 1);
    assert_m2.doesNotMatch(activeToasts[0]?.textContent ?? "", /save unconfirmed/u);
    assert_m2.match(activeToasts[0]?.textContent ?? "", replacement === "confirmed" ? /Saved|Already saved/u : replacement === "conflict" ? /changed/u : /weren't saved/u);
  });
  it_m2("withdraws a section's warning when it is left and dismisses a replayed command's own warning", async () => {
    const commands: ReturnType<typeof CommandRequestSchema.parse>[] = [];
    const authority = await syntheticSettingsAuthority(); disposers.push(authority.close);
    const h = await mount({ search: "settings=performance", settingsRead: authority.read, command: body => {
      const command = CommandRequestSchema.parse(body); commands.push(command);
      const attempts = commands.filter(candidate => candidate.commandId === command.commandId).length;
      if (attempts === 1) return Promise.reject(new Error("Synthetic lost response"));
      return Promise.resolve(Response.json(authority.execute(command)));
    } });
    const edit = async (field: string, value: string) => {
      const label = [...h.host.querySelectorAll("label")].find(candidate => candidate.textContent?.trim() === field);
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
    assert_m2.match(document.querySelector('[data-slot="toast"]')?.textContent ?? "", /Settings save unconfirmed/u);
    const credentials = [...h.host.querySelectorAll<HTMLAnchorElement>("a")].find(button => button.textContent?.trim() === "Account");
    assert_m2.ok(credentials); await act_m2(async () => credentials.click()); await settle();
    await edit("UCPath username", "Synthetic credential");
    assert_m2.equal(commands.length, 2);
    assert_m2.notEqual(commands[0]?.commandId, commands[1]?.commandId);
    const shown = () => [...document.querySelectorAll('[data-slot="toast"]')].filter(node => !node.hasAttribute("data-ending-style"));
    assert_m2.equal(shown().length, 1, "each section shows only its own warning");
    assert_m2.match(shown()[0]?.textContent ?? "", /Credentials save unconfirmed/u);
    const retry = [...document.querySelectorAll("button")].find(button => button.textContent === "Retry exact attempt"); assert_m2.ok(retry);
    await act_m2(async () => retry.click()); await settle();
    assert_m2.equal(commands.length, 3); assert_m2.deepEqual(commands[2], commands[1]);
    assert_m2.equal(shown().filter(node => node.textContent?.includes("Credentials save unconfirmed")).length, 0, "the replayed command's warning is dismissed");
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
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(entry => entry.textContent?.trim() === "Delete");
    assert_m2.ok(confirm instanceof HTMLButtonElement);
    await act_m2(async () => confirm.click()); await settle();
    assert_m2.equal(commands.length, 1);
    await h.deliver(DashboardDayWireSchema_m2.parse({ ...FIXTURE_DAY_WIRE_m2, snapshotCursor: "pc:200", queueSurfaces: FIXTURE_DAY_WIRE_m2.queueSurfaces.filter(entry => entry.runId !== candidate.runId) }));
    assert_m2.equal(h.host.querySelector(`[data-demo-row-id="${candidate.runId}"]`) === null, true);
    assert_m2.ok([...document.querySelectorAll('[data-slot="toast"]')].some(toast => toast.textContent?.includes("Delete run: outcome unknown")), "the lost response stays visible as a sticky toast");
    const bell = h.host.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert_m2.ok(bell);
    await act_m2(async () => bell.click()); await settle();
    const review = [...h.host.querySelectorAll<HTMLButtonElement>("button.notification-item")].find(entry => entry.textContent?.includes("Delete run: outcome unknown"));
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
    assert_m2.equal(h.host.querySelectorAll('button[aria-label="Assistant"]').length, 1);
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
      /fixed top-3 left-1\/2/u,
      "the fixed toast viewport is top-centred, so it sits clear of the Sessions bar floor",
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
