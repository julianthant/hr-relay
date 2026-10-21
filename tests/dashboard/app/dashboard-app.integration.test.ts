import { launchWorkflows } from "../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows } from "../../../src/dashboard/surfaces/shell/shell-model.js";
import { FIXTURE_EXPLORER_WIRE } from "../../parity/helpers/fixture-explorer.js";
import { servedFixtureSources } from "../../parity/helpers/workflow-composition.js";
import { workflowComposition as servedWorkflowComposition } from "../../../src/dashboard/app/workflow-sources.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { vi } from "vitest";
import { PARITY_WORKFLOW_COMPOSITION as PARITY_WORKFLOW_COMPOSITION_m0 } from "../../parity/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert_m0 from "node:assert/strict";
import { act as act_m0,createElement as createElement_m0,Fragment as Fragment_m0 } from "react";
import { createRoot as createRoot_m0,type Root as Root_m0 } from "react-dom/client";
import { it as it_m0 } from "vitest";
import { RUN_START_DOOR_ID as RUN_START_DOOR_ID_m0 } from "../../../src/dashboard/app/dashboard-app-model.js";
import { DashboardApp as DashboardApp_m0 } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient as createDashboardClient_m0,type DashboardClient as DashboardClient_m0 } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider as DashboardClientProvider_m0 } from "../../../src/dashboard/state/client-context.js";
import { importSpreadsheet as importSpreadsheet_m0 } from "../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js";
import { registeredSpreadsheetWorkbook as registeredSpreadsheetWorkbook_m0,resetSpreadsheetMocks as resetSpreadsheetMocks_m0,useSpreadsheetMocks as useSpreadsheetMocks_m0,type RegisteredSpreadsheet as RegisteredSpreadsheet_m0 } from "../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js";
import { PARITY_WORKFLOW_COMPOSITION as PARITY_WORKFLOW_COMPOSITION_m1 } from "../../parity/helpers/workflow-composition.js";
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m0 } from "../../support/fixtures/dashboard/fixture-queue.js";
import { createFixtureBff as createFixtureBff_m0 } from "../../support/helpers/dashboard/served-fixtures/fixture-bff.js";
// @vitest-environment jsdom
import assert_m1 from "node:assert/strict";
import { act as act_m1,createElement as createElement_m1 } from "react";
import { createRoot as createRoot_m1,type Root as Root_m1 } from "react-dom/client";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { DashboardApp as DashboardApp_m1 } from "../../../src/dashboard/app/dashboard-app.js";
import { parseRoute as parseRoute_m1 } from "../../../src/dashboard/app/navigation/url-state.js";
import { createDashboardClient as createDashboardClient_m1,type DashboardClient as DashboardClient_m1 } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider as DashboardClientProvider_m1 } from "../../../src/dashboard/state/client-context.js";
import { DashboardDayWireSchema } from "../../../src/models/dashboard/projection.js";
import { LocalDateSchema as LocalDateSchema_m1 } from "../../../src/rules/identity/ids.js";
import { FIXTURE_BOOTSTRAP as FIXTURE_BOOTSTRAP_m1 } from "../../support/fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m1,FIXTURE_IDS as FIXTURE_IDS_m1 } from "../../support/fixtures/dashboard/fixture-queue.js";
import { createFixtureBff as createFixtureBff_m1 } from "../../support/helpers/dashboard/served-fixtures/fixture-bff.js";


{


Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root_m0 | undefined;
let registeredFiles: readonly RegisteredSpreadsheet_m0[] = [];
function RegistryProbe() { registeredFiles = useSpreadsheetMocks_m0().files; return null; }
const _afterEachFixture0 = async () => {
  await act_m0(async () => root?.unmount()); root = undefined;
  resetSpreadsheetMocks_m0(); vi.unstubAllGlobals();
  document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, "", "/");
};
async function settle() { await act_m0(async () => { await new Promise(resolve => setTimeout(resolve, 35)); }); }
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === name || node.textContent?.trim() === name);
  assert_m0.ok(found, `missing ${name}`); return found;
}
async function click(node: HTMLElement) { await act_m0(async () => { node.focus(); node.click(); }); await settle(); }
async function key(value: string) {
  await act_m0(async () => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", {key:value,bubbles:true,cancelable:true})); });
  await settle();
}
async function mount(overrides: Partial<DashboardClient_m0> = {}) {
  window.history.replaceState(null, "", `/?day=${FIXTURE_DAY_WIRE_m0.day}`);
  localStorage.setItem("hr-dashboard.workflow-panel", "icon");
  const { app } = createFixtureBff_m0();
  const client: DashboardClient_m0 = {
    ...createDashboardClient_m0({baseUrl:"http://fixture",fetchImpl:async (url,init) => app.request(String(url),init)}),
    subscribeDay(input) { input.onDay(FIXTURE_DAY_WIRE_m0); input.onState({state:"live"}); return {close() {}}; },
    ...overrides,
  };
  const host=document.createElement("div"); document.body.append(host); root=createRoot_m0(host);
  await act_m0(async () => root?.render(createElement_m0(DashboardClientProvider_m0,{client,children:createElement_m0(Fragment_m0, null, createElement_m0(DashboardApp_m0, { workflowComposition: PARITY_WORKFLOW_COMPOSITION_m0 }), createElement_m0(RegistryProbe))})));
  await settle();
}
it_m0("command binding never renders implementation comment text", async () => {
  try {
    await mount();
    assert_m0.doesNotMatch(document.body.textContent ?? "", /Keep the theme above providers|portalled toast surfaces inherit/u);
  } finally {
    await _afterEachFixture0();
  }
});

async function chooseSpreadsheet() {
  vi.stubGlobal("Worker", class {
    onmessage?: (event: MessageEvent) => void;
    terminate() {}
    postMessage(request: { kind: string; name: string; data: ArrayBuffer }) {
      assert_m0.equal(request.kind, "import");
      void importSpreadsheet_m0(request.name, request.data).then(value => this.onmessage?.(new MessageEvent("message", { data: { state: "ready", value } })));
    }
  });
  const bytes = new TextEncoder().encode("Name,Employee ID\nJordan Lee,10800000\n");
  const file = new File([bytes], "Focus roster.csv", { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Open XLSX or CSV"]'); assert_m0.ok(input);
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act_m0(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
  assert_m0.ok(document.querySelector('[role="dialog"]'));
}
for (const launch of ["external button", "keyboard shortcut"] as const) {
  for (const dismissal of ["Cancel", "Escape", "Close"] as const) {
    it_m0(`${launch}: ${dismissal} restores the Run launch control after the real dialog unmounts`,async () => {
try {


      await mount();
      const door=button("Start a run"); assert_m0.equal(door.id,RUN_START_DOOR_ID_m0);
      if(launch === "external button") await click(door);
      else { button("Settings").focus(); await key("r"); }
      const dialog=document.querySelector('[role="dialog"]'); assert_m0.ok(dialog);
      assert_m0.ok(dialog.contains(document.activeElement),"opening must move focus into the dialog");
      if(dismissal === "Escape") await key("Escape"); else await click(button(dismissal));
      assert_m0.ok(document.querySelector('[role="dialog"]') === null);
      assert_m0.ok(document.activeElement === door, `focus returned to ${document.activeElement?.tagName}, not the Run door`);

} finally {
await _afterEachFixture0();
}
});
  }
}

it_m0("spreadsheet import is a Settings destination and leaves the Run launch focus intact", async () => {
try {


  let uploads = 0;
  await mount({ uploadIntakeFile: async () => { uploads++; throw new Error("unexpected intake"); } });
  await click(button("Start a run"));
  const launch = document.querySelector('[role="dialog"]'); assert_m0.ok(launch);
  assert_m0.equal(launch.querySelectorAll('input[type="file"]').length, 0);
  assert_m0.equal(document.querySelectorAll('#hub-panel-assistant input[type="file"]').length, 1);
  await key("Escape"); assert_m0.ok(document.activeElement === button("Start a run"));
  await click(button("Settings"));
  const link = [...document.querySelectorAll("a")].find(node => node.textContent?.trim() === "Spreadsheets"); assert_m0.ok(link);
  await click(link);
  await click(button("Import spreadsheet"));
  await chooseSpreadsheet();
  await click(button("Import selected columns"));
  assert_m0.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert_m0.ok(document.body.textContent?.includes("Spreadsheet imported"));
  const imported = registeredFiles.find(file => file.name === "Focus roster.csv"); assert_m0.ok(imported);
  const workbook = registeredSpreadsheetWorkbook_m0(imported);
  assert_m0.equal(workbook.sheets[0].rows[1].cells[0].value, "Jordan Lee");
  assert_m0.equal(String(workbook.sheets[0].rows[1].cells[1].value), "10800000");
  assert_m0.equal(uploads, 0); assert_m0.equal(new URLSearchParams(location.search).has("intake"), false);

} finally {
await _afterEachFixture0();
}
});
it_m0.each(["Cancel", "Escape", "Close"])("standalone spreadsheet import: %s closes without registering or starting a run", async dismissal => {
try {


  let starts = 0;
  await mount({ submitStartPlan: async () => { starts++; throw new Error("unexpected start"); } }); await click(button("Settings"));
  const link = [...document.querySelectorAll("a")].find(node => node.textContent?.trim() === "Spreadsheets"); assert_m0.ok(link); await click(link);
  const before = registeredFiles.map(file => file.id);
  await click(button("Import spreadsheet"));
  await chooseSpreadsheet();
  if (dismissal === "Escape") await key("Escape"); else await click(button(dismissal === "Cancel" ? "Cancel import" : dismissal));
  assert_m0.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert_m0.deepEqual(registeredFiles.map(file => file.id), before);
  assert_m0.equal(starts, 0);
  assert_m0.equal(document.activeElement, button(dismissal === "Cancel" ? "Import spreadsheet" : "Review import"));
  assert_m0.equal(new URLSearchParams(location.search).has("intake"), false);

} finally {
await _afterEachFixture0();
}
});
}

{


Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root_m1 | undefined;
const _afterEachFixture0 = async () => {
  await act_m1(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  localStorage.clear();
  window.history.replaceState(null, "", "/");
};
async function settle() { await act_m1(async () => { await new Promise(resolve => setTimeout(resolve, 35)); }); }
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === name || node.textContent?.trim() === name);
  assert_m1.ok(found, `button ${name}`);
  return found;
}
function workflowButton(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Workflows"] button')]
    .find(node => node.textContent?.trim().startsWith(name));
  assert_m1.ok(found, `workflow ${name}`);
  return found;
}
async function click(node: HTMLElement) { await act_m1(async () => node.click()); await settle(); }
async function mount(search: string, overrides: Partial<DashboardClient_m1> = {}, panelMode: "icon" | "sidebar" = "icon", workflowComposition = PARITY_WORKFLOW_COMPOSITION_m1) {
  window.history.replaceState(null, "", `/${search}`);
  localStorage.setItem("hr-dashboard.workflow-panel", panelMode);
  const { app } = createFixtureBff_m1();
  const client: DashboardClient_m1 = {
    ...createDashboardClient_m1({baseUrl:"http://fixture",fetchImpl: async (url, init) => app.request(String(url), init)}),
    subscribeDay(input) { input.onDay(FIXTURE_DAY_WIRE_m1); input.onState({state:"live"}); return {close() {}}; },
    ...overrides,
  };
  const host = document.createElement("div"); document.body.append(host); root = createRoot_m1(host);
  await act_m1(async () => root?.render(createElement_m1(DashboardClientProvider_m1,{client,children:createElement_m1(DashboardApp_m1, { workflowComposition })})));
  await settle();
  return client;
}
async function historyMove(direction: "back" | "forward") { window.history[direction](); await settle(); await settle(); }

describe_m1("mounted shell navigation", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("remembers the selected workflow across navigation and remount, then falls back if it is no longer served", async () => {
    const first = FIXTURE_BOOTSTRAP_m1.workflows[0]; assert_m1.ok(first);
    const workflows = [first, { ...first, id: "separations", code: "sp", label: "Separations" }];
    const bootstrap = async () => ({ ...FIXTURE_BOOTSTRAP_m1, workflows });
    await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}`, { bootstrap }, "sidebar");
    await click(workflowButton("Separations"));
    assert_m1.equal(workflowButton("Separations").getAttribute("aria-current"), "page");
    assert_m1.ok(workflowButton("Separations").querySelector('[aria-label="0 active of 0 in Separations"]'));
    assert_m1.doesNotMatch(document.querySelector('nav[aria-label="Workflows"]')?.textContent ?? "", /active\s*│\s*all/iu);
    assert_m1.equal(localStorage.getItem("hr-dashboard.selected-workflow"), "separations");
    await click(button("Settings"));
    await historyMove("back");
    assert_m1.equal(workflowButton("Separations").getAttribute("aria-current"), "page");

    await act_m1(async () => root?.unmount()); root = undefined; document.body.innerHTML = "";
    await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}`, { bootstrap }, "sidebar");
    assert_m1.equal(workflowButton("Separations").getAttribute("aria-current"), "page");

    await act_m1(async () => root?.unmount()); root = undefined; document.body.innerHTML = "";
    await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}`, {}, "sidebar");
    assert_m1.equal(workflowButton("Person Lookup").getAttribute("aria-current"), "page");
  });
  it_m1("refuses a linked mock workflow outside the served selection without throwing or navigating", async () => {
    const linkedDay = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE_m1,
      queueSurfaces: FIXTURE_DAY_WIRE_m1.queueSurfaces.map(surface => surface.runId === FIXTURE_IDS_m1.queuedRun ? { ...surface,
        linkedRuns: [{ runId: "11111111-1111-4111-8111-111111111111", partitionDay: FIXTURE_DAY_WIRE_m1.day,
          workflowId: "separations", label: "Unavailable mock link", panelKind: "run", status: "queued" }] } : surface) });
    await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}`, {
      subscribeDay(input) { input.onDay(linkedDay); input.onState({ state: "live" }); return { close() {} }; },
    }, "sidebar");
    const link = document.querySelector<HTMLButtonElement>(`[data-demo-row-id="${FIXTURE_IDS_m1.queuedRun}"] button[data-demo-row-link]`);
    assert_m1.ok(link);
    const before = window.location.search;
    const preference = localStorage.getItem("hr-dashboard.selected-workflow");
    await click(link);
    assert_m1.match(document.body.textContent ?? "", /Workflow unavailable/);
    assert_m1.equal(window.location.search, before);
    assert_m1.equal(localStorage.getItem("hr-dashboard.selected-workflow"), preference);
    assert_m1.equal(workflowButton("Person Lookup").getAttribute("aria-current"), "page");
  });
  it_m1.each(["search", "notification"])("refused %s destination preserves a dirty Settings draft without asking to discard", async surface => {
    const title = "Unavailable served destination";
    const row = FIXTURE_DAY_WIRE_m1.queueSurfaces.find(item => item.status === "done"); assert_m1.ok(row);
    const linkedDay = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE_m1,
      queueSurfaces: FIXTURE_DAY_WIRE_m1.queueSurfaces.map(item => item === row ? { ...item, workflowId: "separations", title } : item) });
    await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}&settings=general`, {
      subscribeDay(input) { input.onDay(linkedDay); input.onState({ state: "live" }); return { close() {} }; },
    }, "sidebar", workflows => {
      const composition = PARITY_WORKFLOW_COMPOSITION_m1(workflows);
      return { ...composition, dataSources: { ...composition.dataSources, separations: "served" } };
    });
    await editHeadlessPreference();
    if (surface === "search") await click(button("Search runs"));
    else {
      const notifications = document.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert_m1.ok(notifications);
      await click(notifications);
    }
    const before = location.search;
    const preference = localStorage.getItem("hr-dashboard.selected-workflow");
    const target = surface === "search"
      ? [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes(title))
      : [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Notification updates"] button')].find(item => item.textContent === title);
    assert_m1.ok(target);
    await click(target);
    assert_m1.equal(document.body.textContent?.includes("Discard unsaved settings?"), false);
    assert_m1.match(document.body.textContent ?? "", /This workflow is not available for selection in the current catalog/);
    assert_m1.equal(location.search, before);
    assert_m1.equal(localStorage.getItem("hr-dashboard.selected-workflow"), preference);
    assert_m1.equal(document.querySelector<HTMLInputElement>('input[name="browser.headless"]')?.checked, false);
    if (surface === "notification") {
      const notifications = document.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert_m1.ok(notifications);
      await click(notifications);
    }
    assert_m1.equal(workflowButton("Person Lookup").getAttribute("aria-current"), "page");
  });
  it_m1("reports detail failure and never calls it an empty selection", async () => {
    await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}&run=missing-run`);
    assert_m1.match(document.body.textContent ?? "", /Run unavailable/);
    assert_m1.doesNotMatch(document.body.textContent ?? "", /No run open/);
  });
  it_m1("joins a deep-linked run to its served workflow even when it is not the first workflow", async () => {
    const first = FIXTURE_BOOTSTRAP_m1.workflows[0]; assert_m1.ok(first);
    await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}&run=${FIXTURE_IDS_m1.runningRun}`, {
      bootstrap: async () => ({...FIXTURE_BOOTSTRAP_m1,workflows:[{...first,id:"another-workflow",label:"Another workflow"},first]}),
    });
    const selected = document.querySelector(`[data-demo-row-id="${FIXTURE_IDS_m1.runningRun}"]`);
    assert_m1.ok(selected, "selected run must belong to the visible queue");
  });
  it_m1("Settings gear toggles the surface and competing keys resolve one takeover", async () => {
    await mount("?settings=keyboard&archive=&explore=missing");
    assert_m1.ok(document.querySelector('[aria-label="Settings"]'));
    const cursor = Number(Reflect.get(Object(window.history.state), "hrDashboardRouteCursor"));
    await click(button("Settings"));
    assert_m1.equal(new URLSearchParams(location.search).has("settings"), false);
    await click(button("Settings"));
    assert_m1.equal(new URLSearchParams(location.search).has("settings"), true);
    assert_m1.equal(Reflect.get(Object(window.history.state), "hrDashboardRouteCursor"), cursor + 2);
    await historyMove("back");
    assert_m1.equal(new URLSearchParams(location.search).has("settings"), false);
    await historyMove("forward");
    assert_m1.equal(new URLSearchParams(location.search).has("settings"), true);
    await click(button("Settings"));
    assert_m1.equal(new URLSearchParams(location.search).has("archive"),false);
    assert_m1.equal(new URLSearchParams(location.search).has("explore"),false);
  });
});

async function editHeadlessPreference() {
  const control = document.querySelector<HTMLElement>('[data-settings-path="browser.headless"] .ds-switch-control'); assert_m1.ok(control);
  await act_m1(async () => control.click());
}
it_m1("keeps the Settings editor and draft across ordinary-section native history", async () => {
try {


  await mount("?settings=general");
  await editHeadlessPreference();
  const general = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Settings sections"] a')].find(link => link.textContent?.trim() === "Paths"); assert_m1.ok(general);
  await click(general);
  await historyMove("back");
  assert_m1.equal(document.querySelector<HTMLInputElement>('input[name="browser.headless"]')?.checked,false);
  assert_m1.equal(document.body.textContent?.includes("Discard unsaved settings?"),false);
  const analytics = document.querySelector<HTMLAnchorElement>('nav[aria-label="Settings sections"] a[href="?settings=activity"]'); assert_m1.ok(analytics);
  await click(analytics);
  assert_m1.equal(document.querySelector("h1")?.textContent, "Analytics");
  assert_m1.equal(document.body.textContent?.includes("Discard unsaved settings?"), false);
  await historyMove("back");
  assert_m1.equal(document.querySelector<HTMLInputElement>('input[name="browser.headless"]')?.checked,false);
  await click(button("Settings"));
  await click(button("Discard changes"));
  assert_m1.equal(new URLSearchParams(location.search).has("settings"),false);

} finally {
await _afterEachFixture0();
}
});
it_m1.each(["?settings=archive", "?archive=", "?archive=archive-demo-run-48216&archiveView=versions"])("keeps retired Archive URL %s explicit and returns to the queue", async search => {
try {


  await mount(search);
  assert_m1.match(document.body.textContent ?? "", /Archive page removed/u);
  assert_m1.equal(document.querySelector('[aria-label="Archive"]'), null);
  assert_m1.equal(document.querySelector('a[href="?settings=archive"]'), null);
  assert_m1.equal(document.querySelectorAll('nav[aria-label="Settings sections"] a').length, 10);
  await click(button("Return to dashboard"));
  assert_m1.equal(parseRoute_m1(location.search).archive, undefined);
  assert_m1.equal(parseRoute_m1(location.search).settings, undefined);
  assert_m1.ok(document.querySelector('[data-demo-row-id]'));

} finally {
await _afterEachFixture0();
}
});
it_m1("hidden queue shortcuts do not open a run behind Settings",async()=>{
try {


  await mount("?settings=keyboard");
  const before=location.search;
  for(const key of ["j","k","n","r","w","1"]){
    await act_m1(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true})));
  }
  assert_m1.equal(location.search,before);
  assert_m1.equal(document.querySelector('[role="dialog"][aria-label="Workflow Panel"]'),null);

} finally {
await _afterEachFixture0();
}
});
it_m1("passes canonical Queue outcomes through the mounted app and refreshes outcome-only changes", async () => {
  try {
    const original = FIXTURE_DAY_WIRE_m1.queueSurfaces.find(row => row.surfaceKind === "single"); assert_m1.ok(original);
    const canonical = { ...original, status: "done", endedAt: { state: "present", value: original.updatedAt }, gateOpenedAt: { state: "absent", reason: "No gate" }, outcome: { label: "Active", tone: "success" } };
    let current: Parameters<DashboardClient_m1["subscribeDay"]>[0] | undefined;
    const publish = async (overrides: Record<string, unknown>) => {
      const day = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE_m1, queueSurfaces: [{ ...canonical, ...overrides }] });
      await act_m1(async () => current?.onDay(day));
      await settle();
    };
    await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}`, {
      subscribeDay(input) {
        current = input;
        input.onDay(DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE_m1, queueSurfaces: [canonical] }));
        input.onState({ state: "live" }); return { close() {} };
      },
    });
    const text = () => {
      const row = document.querySelector(`[data-demo-row-id="${original.runId}"]`); assert_m1.ok(row);
      return row.textContent ?? "";
    };
    assert_m1.match(text(), /Active/u);
    await publish({ outcome: { label: "Inactive", tone: "neutral" } });
    assert_m1.match(text(), /Inactive/u); assert_m1.doesNotMatch(text(), /Active/u);
    await publish({ outcome: undefined });
    assert_m1.doesNotMatch(text(), /Inactive|Active/u); assert_m1.match(text(), /Done/u);
    for (const [status, label] of [["running", "Running"], ["awaiting-approval", "Review"], ["failed", "Failed"], ["cancelled", "Cancelled"]]) {
      await publish({ status,
        endedAt: status === "running" || status === "awaiting-approval" ? { state: "absent", reason: "Run is active" } : canonical.endedAt,
        gateOpenedAt: status === "awaiting-approval" ? { state: "present", value: original.updatedAt } : canonical.gateOpenedAt,
      });
      assert_m1.doesNotMatch(text(), /Active/u); assert_m1.match(text(), new RegExp(label, "iu"));
    }
  } finally { await _afterEachFixture0(); }
});
it_m1("keeps served Logs failures while explicit parity composition selects mock Logs for the same run", async () => {
  try {
    const { DashboardClientError } = await import("../../../src/dashboard/client/index.js");
    let reads = 0;
    const search = `?day=${FIXTURE_DAY_WIRE_m1.day}&run=${FIXTURE_IDS_m1.openGateRun}&section=logs`;
    const client = await mount(search, {
      runDetail: async () => { reads++; throw new DashboardClientError({ kind: "network", message: "private transport detail" }); },
    }, "icon", workflows => servedWorkflowComposition(servedFixtureSources(workflows)));
    assert_m1.ok(reads > 0);
    assert_m1.ok(document.body.textContent?.includes("The dashboard could not load this from the local service. Try again."));
    assert_m1.match(document.body.textContent ?? "", /Could not load logs|Logs unavailable/);
    assert_m1.doesNotMatch(document.body.textContent ?? "", /Confirm the employee match|private transport detail/);
    const failedReads = reads;
    await act_m1(async () => root?.render(createElement_m1(DashboardClientProvider_m1, { client,
      children: createElement_m1(DashboardApp_m1, { workflowComposition: PARITY_WORKFLOW_COMPOSITION_m1 }) })));
    await settle();
    assert_m1.equal(reads, failedReads);
    assert_m1.match(document.body.textContent ?? "", /Confirm the employee match/);
    assert_m1.doesNotMatch(document.body.textContent ?? "", /Could not load logs|Logs unavailable|cross-source chronology unavailable/);
    const workflow = launchWorkflows(parseWorkflows(FIXTURE_BOOTSTRAP_m1.workflows))[0];
    assert_m1.ok(workflow);
    const composition = PARITY_WORKFLOW_COMPOSITION_m1([{ ...workflow, workflowId: "generic-served-workflow" }]);
    assert_m1.equal(composition.sources["person-lookup"], "mock");
    assert_m1.equal(composition.logsSources?.["person-lookup"], "mock");
    assert_m1.equal(composition.logsSources?.["generic-served-workflow"], "served");
  } finally { await _afterEachFixture0(); }
});
it_m1("passes the app client to a served Explorer read while parity explicitly retains mock Explorer", async () => {
  try {
    let calls = 0;
    await mount("?explore=person-lookup&view=%7B%22explorerWorkflow%22%3A%22person-lookup%22%7D", {
      workflowExplorer: async () => { calls++; return { ...FIXTURE_EXPLORER_WIRE, workflows: FIXTURE_EXPLORER_WIRE.workflows.map(workflow => workflow.id === "person-lookup" ? { ...workflow, version: parseWorkflows(FIXTURE_BOOTSTRAP_m1.workflows).find(entry => entry.id === workflow.id)!.start.version } : workflow) }; },
    }, "icon", workflows => servedWorkflowComposition(servedFixtureSources(workflows)));
    assert_m1.equal(calls, 1);
    assert_m1.ok(document.body.textContent?.includes(FIXTURE_EXPLORER_WIRE.workflows.find(workflow => workflow.id === "person-lookup")!.nodes[0].label), document.body.textContent ?? "");
    assert_m1.ok(document.body.textContent?.includes("No run values are available."));
    assert_m1.equal(document.body.textContent?.includes("Separation filed and Kuali document verified"), false);
    await _afterEachFixture0();
    calls = 0;
    const client = await mount("?explore=person-lookup&view=%7B%22explorerWorkflow%22%3A%22fixture-person-lookup%22%7D", {
      workflowExplorer: async () => { calls++; throw new Error("mock Explorer must not read served definitions"); },
    });
    assert_m1.equal(calls, 0);
    assert_m1.ok(document.body.textContent?.includes("Browse workflows, their steps and field sources."));
    assert_m1.equal(document.body.textContent?.includes("Fictional preview data"), false);
    assert_m1.equal(document.body.textContent?.includes("No run values are available."), false);
    const select = document.querySelector('[aria-label="Explorer workflow"]');
    assert_m1.ok(select instanceof HTMLButtonElement);
    await click(select);
    const separation = document.querySelector('[role="option"][data-value="fixture-separations"]');
    assert_m1.ok(separation instanceof HTMLElement);
    await click(separation);
    const identity = document.querySelector('[aria-label="Identity check preview"]');
    assert_m1.ok(identity instanceof HTMLButtonElement);
    await click(identity);
    const rejected = document.querySelector('[role="option"][data-value="rejected"]');
    assert_m1.ok(rejected instanceof HTMLElement);
    await click(rejected);
    assert_m1.ok((document.querySelector('[data-step-number="16"]') as HTMLElement).hidden);
    const replacement = { ...client };
    await act_m1(async () => root?.render(createElement_m1(DashboardClientProvider_m1, { client: replacement, children: createElement_m1(DashboardApp_m1, { workflowComposition: PARITY_WORKFLOW_COMPOSITION_m1 }) })));
    await settle();
    assert_m1.equal((document.querySelector('[data-step-number="16"]') as HTMLElement).hidden, false);
    assert_m1.equal(calls, 0);
  } finally { await _afterEachFixture0(); }
});
it_m1("failed and delayed day snapshots never render an empty or stale queue",async()=>{
try {


  let current: Parameters<DashboardClient_m1["subscribeDay"]>[0] | undefined;
  let old: Parameters<DashboardClient_m1["subscribeDay"]>[0] | undefined;
  await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}&run=${FIXTURE_IDS_m1.runningRun}`,{
    subscribeDay(input){old=current;current=input;if(input.day===FIXTURE_DAY_WIRE_m1.day) input.onDay(FIXTURE_DAY_WIRE_m1);return{close(){}};},
  });
  await act_m1(async()=>{
    window.history.pushState({hrDashboardRouteCursor:1},"","/?day=2026-08-02");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  assert_m1.ok(document.querySelector('[role="status"][aria-label="Loading queue"][aria-busy="true"]'));
  await act_m1(async()=>old?.onDay(FIXTURE_DAY_WIRE_m1));
  assert_m1.equal(document.querySelector(`[data-demo-row-id="${FIXTURE_IDS_m1.runningRun}"]`) === null, true, "the prior day row must not remain mounted");
  await act_m1(async()=>current?.onDay({...FIXTURE_DAY_WIRE_m1,day:LocalDateSchema_m1.parse("2026-08-02"),queueSurfaces:[],statusCounts:[],workflowCounts:[],monthCounts:[]}));
  assert_m1.equal(document.querySelector('[role="status"][aria-label="Loading queue"]') === null, true, "the current loaded day must clear its loading skeleton");

} finally {
await _afterEachFixture0();
}
});
it_m1("an empty catalog is not a fabricated workflow queue",async()=>{
try {


  await mount("?sessionsPreview=empty",{bootstrap:async()=>({...FIXTURE_BOOTSTRAP_m1,workflows:[]})}, "icon", workflows => ({ ...PARITY_WORKFLOW_COMPOSITION_m1(workflows), catalogIncludesMocks: false, servedDay: true }));
  assert_m1.match(document.body.textContent??"",/No workflows available/);

} finally {
await _afterEachFixture0();
}
});
it_m1("a failed day displays its error, with no zero-count status controls",async()=>{
try {


  const {DashboardClientError}=await import("../../../src/dashboard/client/index.js");
  await mount(`?day=${FIXTURE_DAY_WIRE_m1.day}`,{subscribeDay(input){input.onState({state:"stopped",error:new DashboardClientError({kind:"network",message:"Queue transport failed"})});return{close(){}};}});
  assert_m1.match(document.body.textContent??"",/Could not load queue/);
  assert_m1.ok(document.body.textContent?.includes(formatErrorCatalogFailure(createErrorCatalogFailure("TASK_UNHANDLED_FAILURE", {})).text));
  assert_m1.doesNotMatch(document.body.textContent ?? "", /Queue transport failed/);
  assert_m1.equal(document.querySelector('[aria-label="Filter the queue by status"]') === null, true, "failed authority must not expose zero-count status controls");

} finally {
await _afterEachFixture0();
}
});

it_m1("native date history preserves a dirty Settings draft, then restores the accepted date", async () => {
try {


  await mount("?day=2026-08-02", {
    subscribeDay(input) {
      input.onDay({ ...FIXTURE_DAY_WIRE_m1, day: LocalDateSchema_m1.parse(input.day), queueSurfaces: [], statusCounts: [], workflowCounts: [], monthCounts: [] });
      input.onState({ state: "live" }); return { close() {} };
    },
  });
  await click(button("Settings"));
  await editHeadlessPreference();
  const paths = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(node => node.textContent === "Paths"); assert_m1.ok(paths);
  await click(paths);
  await historyMove("back"); // Settings root retains its editor.
  await historyMove("back");
  await click(button("Keep editing"));
  assert_m1.equal(document.querySelector<HTMLInputElement>('input[name="browser.headless"]')?.checked, false);
  assert_m1.equal(new URLSearchParams(location.search).has("settings"), true);
  await historyMove("back"); await click(button("Discard changes")); await settle();
  assert_m1.equal(new URLSearchParams(location.search).get("day"), "2026-08-02");
  assert_m1.equal(new URLSearchParams(location.search).has("settings"), false);

} finally {
await _afterEachFixture0();
}
});
}
