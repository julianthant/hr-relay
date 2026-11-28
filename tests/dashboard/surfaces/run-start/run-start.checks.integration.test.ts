// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it, vi } from "vitest";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { FIXTURE_BOOTSTRAP } from "../../../support/fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../support/fixtures/dashboard/fixture-start.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../../support/fixtures/dashboard/fixture-settings.js";
import { healthyDashboardPreflightReport } from "../../../support/fixtures/preflight-seams.js";
import { PreflightRerunCommandRequestSchema } from "../../../../src/models/preflight/preflight-contract.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

const PLAN_ID = "5a000000-0000-4000-8000-000000000001";
const FIXABLE = { check: "secrets.ucpath-sso", status: "fail", summary: "The UCPath password is missing." } as const;
const UNFIXABLE = { check: "browser.assets", status: "fail", summary: "Relay is missing files." } as const;
const WARNING = { check: "fiscal.current", status: "warning", summary: "The fiscal year ends soon." } as const;
const PASSING = { check: "config.valid", status: "pass" } as const;

function served(...reports: ReturnType<typeof h.readiness>[]) {
  const reads: unknown[] = [];
  return { reads, client: h.stubClient({
    readPreflight: async selection => { reads.push(selection); return reports[Math.min(reads.length, reports.length) - 1] ?? h.READY; },
    submitStartPlan: async () => h.planResponse(PLAN_ID),
    executeCommand: async () => h.APPLIED,
  }) };
}
async function reachChecks(dialog: Awaited<ReturnType<typeof h.openDialog>>, input = h.TYPED) {
  await dialog.type(input);
  await dialog.press("Next");
  for (let wait = 0; wait < 6; wait += 1) await h.settle();
  assert.equal(dialog.stage(), "Start");
}
const fixButton = (name: string) => h.buttons().find(button => h.buttonName(button) === name);

describe("the Run dialog's Checks section", () => {
  it("reads the selected workflow's readiness when the dialog opens, before Checks is reached", async () => {
    const { reads, client } = served(h.readiness([PASSING]));
    await h.openDialog(client);
    assert.deepEqual(reads, [{ workflowId: h.WORKFLOW_ID }]);
  });

  it("lists only the checks that are not ready, problems first, in readable words and no check ids", async () => {
    const { client } = served(h.readiness([PASSING, WARNING, FIXABLE]));
    const dialog = await h.openDialog(client);
    await reachChecks(dialog);
    const rows = [...document.body.querySelectorAll('[aria-label="Check results"] .ds-run-row')].map(row => (row.textContent ?? "").trim());
    assert.equal(rows.length, 2, "the two problems only");
    assert.match(rows[0] ?? "", /UCPath sign-in.*The UCPath password is missing\..*Add password/u);
    assert.match(rows[1] ?? "", /Current fiscal year.*The fiscal year ends soon\..*Warning/u);
    assert.ok(!dialog.text().includes("Relay settings"), "a ready check is not listed");
    assert.ok(!/\d of \d ready|checks? ready/u.test(dialog.text()), "no count of ready checks is drawn");
    assert.ok(!/secrets\.|config\.valid|fiscal\.current/u.test(dialog.text()), "no check id is drawn");
  });

  it("keeps Start off while a check fails, and on while only warnings stand", async () => {
    const failing = served(h.readiness([PASSING, UNFIXABLE]));
    const blocked = await h.openDialog(failing.client);
    await reachChecks(blocked);
    assert.equal(blocked.disabled("Start run"), true);
    assert.equal(blocked.enter !== undefined && (await blocked.enter({ on: document.body })), false, "Enter does not start past a failed check");
    assert.deepEqual(h.closed, []);
    await h.cleanup();
    const warned = served(h.readiness([PASSING, WARNING]));
    const open = await h.openDialog(warned.client);
    await reachChecks(open);
    assert.equal(open.disabled("Start run"), false);
    await open.press("Start run");
    assert.deepEqual(h.closed, [false], "a warning does not stop the run");
  });

  it("keeps Start off while checking and when readiness cannot be read", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof h.readiness>>();
    const slow = await h.openDialog(h.stubClient({ readPreflight: () => pending.promise }));
    await slow.type(h.TYPED);
    await slow.press("Next");
    assert.equal(slow.disabled("Start run"), true);
    assert.ok(slow.text().includes("Checking"));
    await act(async () => { pending.resolve(h.readiness([PASSING])); });
    assert.equal(slow.disabled("Start run"), false);
    await h.cleanup();
    const down = await h.openDialog(h.stubClient({
      readPreflight: async () => ({ state: "unavailable", reason: "The runtime is restarting." }),
      editableSettings: async () => FIXTURE_EDITABLE_SETTINGS,
      preflightScopes: async () => WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_BOOTSTRAP.workflows),
      rerunPreflight: async request => {
        const command = PreflightRerunCommandRequestSchema.parse(request);
        if (h.READY.state !== "present") throw new Error("fixture readiness report required");
        return { state: "completed", commandId: command.commandId, report: h.READY.report };
      },
    }));
    await reachChecks(down);
    assert.equal(down.disabled("Start run"), true);
    assert.ok(down.text().includes("The runtime is restarting."));
    assert.ok(fixButton("Check again"));
  });

  it("gives a fixable failed check a button named for it, and an unfixable one only a message", async () => {
    const fixes: (readonly [string, string | undefined])[] = [];
    const { client } = served(h.readiness([FIXABLE, UNFIXABLE, PASSING]));
    const dialog = await h.openDialog(client);
    await dialog.rerender({ onFixCheck: (section, target) => fixes.push([section, target]) });
    await reachChecks(dialog);
    assert.equal(dialog.text().includes("Failed"), true);
    assert.equal(h.buttons().filter(button => button.hasAttribute("data-run-check-fix")).length, 1, "only the fixable check has a button");
    await dialog.press("Add password");
    assert.deepEqual(fixes, [["account", "protected.ucpathPassword"]]);
  });

  it("blocks Start for a missing Duo key and sends Fix to Account Security", async () => {
    const fixes: (readonly [string, string | undefined])[] = [];
    const { client } = served(h.readiness([PASSING, { check: "browser.duo-key", status: "fail",
      summary: "Duo isn't set up. Set it up in Settings." }]));
    const dialog = await h.openDialog(client);
    await dialog.rerender({ onFixCheck: (section, target) => fixes.push([section, target]) });
    await reachChecks(dialog);
    assert.equal(dialog.disabled("Start run"), true);
    assert.match(dialog.text(), /Duo isn't set up\. Set it up in Settings\./u);
    await dialog.press("Fix");
    assert.deepEqual(fixes, [["account", "security.duo"]]);
  });

  it("checks again on return from Fix when the Duo evidence changed", async () => {
    const blocked = h.readiness([{ check: "browser.duo-key", status: "fail", summary: "Duo isn't set up. Set it up in Settings." }]);
    const stale = { state: "unavailable", reason: "Duo evidence needs a fresh check." } as const;
    let evidence: ReturnType<typeof h.readiness> = stale;
    let reruns = 0;
    const client = h.stubClient({
      readPreflight: async () => evidence,
      editableSettings: async () => FIXTURE_EDITABLE_SETTINGS,
      preflightScopes: async () => WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_BOOTSTRAP.workflows),
      rerunPreflight: async request => {
        evidence = ++reruns === 1 ? blocked : h.READY;
        if (evidence.state !== "present") throw new Error("fixture readiness report required");
        return { state: "completed", commandId: PreflightRerunCommandRequestSchema.parse(request).commandId, report: evidence.report };
      },
    });
    const dialog = await h.openDialog(client);
    await dialog.rerender({ onFixCheck: () => undefined });
    await reachChecks(dialog);
    assert.equal(dialog.disabled("Start run"), true);
    assert.equal(reruns, 1);
    await dialog.press("Fix");
    await dialog.rerender({ hidden: true });
    evidence = stale;
    await dialog.rerender({ hidden: false });
    for (let wait = 0; wait < 6; wait += 1) await h.settle();
    assert.equal(reruns, 2);
    assert.equal(dialog.disabled("Start run"), false);
  });

  it("says on a failed check with no Fix button what is wrong and what to do, in one sentence", async () => {
    const files = { check: "filesystem.health", status: "fail", summary: "Relay is out of disk space." } as const;
    const address = { check: "endpoint.crm.prod", status: "fail", summary: "The CRM address is invalid." } as const;
    const { client } = served(h.readiness([files, address, PASSING]));
    const dialog = await h.openDialog(client);
    await reachChecks(dialog);
    assert.equal(h.buttons().filter(button => button.hasAttribute("data-run-check-fix")).length, 0);
    assert.match(dialog.text(), /This computer is low on disk space\. Free up space, then check again\./u);
    assert.match(dialog.text(), /Relay can't reach CRM\. Check again in a moment\./u);
    assert.ok(!/Node\.js|dependenc|configuration|data store|scope/iu.test(dialog.text()), "no developer words");
  });

  it("shows only spinners while checking: one beside Checks, one in Start, and no rows", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof h.readiness>>();
    const slow = await h.openDialog(h.stubClient({ readPreflight: () => pending.promise }));
    await slow.type(h.TYPED);
    await slow.press("Next");
    const section = document.body.querySelector('section[aria-label="Checks"]');
    assert.equal(section?.querySelectorAll('[aria-label="Checking"]').length, 1);
    assert.equal(section?.querySelectorAll('.ds-run-row, [data-slot="skeleton"]').length, 0);
    assert.equal(h.buttons().find(button => h.buttonName(button) === "Start run")?.getAttribute("aria-busy"), "true");
    await act(async () => { pending.resolve(h.readiness([PASSING])); });
    assert.equal(section?.querySelector('[aria-label="Checking"]') === null, true);
  });

  it("draws a failed check's fix as the row's one button, with its whole summary readable", async () => {
    const { client } = served(h.readiness([FIXABLE, PASSING]));
    const dialog = await h.openDialog(client);
    await dialog.rerender({ onFixCheck: () => undefined });
    await reachChecks(dialog);
    const row = document.body.querySelector('[aria-label="Check results"] .ds-run-row');
    assert.equal(row?.textContent?.includes("Failed"), false, "the button replaces the status");
    assert.match(dialog.text(), /1 check failed/u);
    const fix = fixButton("Add password");
    assert.ok(fix && fix.tagName === "BUTTON" && fix.querySelector("svg") === null, "a plain button, not a status pill with an icon");
    const summary = [...(row?.querySelectorAll("div") ?? [])].find(node => node.textContent === FIXABLE.summary);
    assert.equal(summary?.getAttribute("title"), FIXABLE.summary);
    assert.ok(!summary?.className.includes("truncate"), "the summary wraps instead of cutting");
  });

  it("keeps everything typed and the stage while Settings is open over it, and reads the checks again on return", async () => {
    const { reads, client } = served(h.readiness([FIXABLE, PASSING]), h.readiness([PASSING, { ...FIXABLE, status: "pass" }]));
    const dialog = await h.openDialog(client);
    await dialog.rerender({ onFixCheck: () => undefined });
    await reachChecks(dialog);
    assert.equal(reads.length, 1);
    await dialog.press("Add password");
    await dialog.rerender({ onFixCheck: () => undefined, hidden: true });
    assert.equal(document.body.querySelector('[role="dialog"]') === null, true, "the dialog is not drawn behind Settings");
    assert.deepEqual(h.closed, [], "hiding is not closing");
    await dialog.rerender({ onFixCheck: () => undefined, hidden: false });
    assert.equal(reads.length, 2, "the checks run again after Settings");
    assert.equal(dialog.stage(), "Start");
    assert.equal(dialog.disabled("Start run"), false, "the fixed check no longer blocks Start");
    await dialog.press("1 Input");
    assert.equal(dialog.typedInput().value, h.TYPED);
    assert.equal(window.sessionStorage.length, 0);
  });

  it("moves focus back to the check's row once the checks are read again", async () => {
    const { client } = served(h.readiness([FIXABLE, PASSING]), h.readiness([FIXABLE, PASSING]));
    const dialog = await h.openDialog(client);
    await dialog.rerender({ onFixCheck: () => undefined });
    await reachChecks(dialog);
    await dialog.press("Add password");
    await dialog.rerender({ onFixCheck: () => undefined, hidden: true });
    await dialog.rerender({ onFixCheck: () => undefined, hidden: false });
    assert.equal(document.activeElement === fixButton("Add password"), true);
  });

  it("shows one Ready to start line when every check is ready", async () => {
    const { client } = served(h.readiness([PASSING, { check: "browser.assets", status: "pass" }]));
    const dialog = await h.openDialog(client);
    await reachChecks(dialog);
    const rows = [...document.body.querySelectorAll('[aria-label="Check results"] .ds-run-row')].map(row => (row.textContent ?? "").trim());
    assert.deepEqual(rows, ["Ready to start"]);
    assert.ok(!/\d of \d ready|checks? ready/u.test(dialog.text()), "no count of ready checks is drawn");
  });

  it("announces the result through one status region that holds Checking and then the result", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof h.readiness>>();
    const slow = await h.openDialog(h.stubClient({ readPreflight: () => pending.promise }));
    await slow.type(h.TYPED);
    await slow.press("Next");
    const region = document.body.querySelector('section[aria-label="Checks"] [role="status"]');
    assert.ok(region?.textContent?.includes("Checking"));
    await act(async () => { pending.resolve(h.readiness([PASSING, UNFIXABLE])); });
    const after = document.body.querySelector('section[aria-label="Checks"] [role="status"]');
    assert.equal(after === region, true, "the same live region is updated, not replaced");
    assert.match(after?.textContent ?? "", /1 check failed/u);
  });
});

describe("asking for a re-check", () => {
  const missing = (rerun: () => Promise<never>) => {
    let reruns = 0;
    const client = h.stubClient({
      readPreflight: async () => ({ state: "unavailable", reason: "The runtime is restarting." }),
      editableSettings: async () => FIXTURE_EDITABLE_SETTINGS,
      preflightScopes: async () => WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_BOOTSTRAP.workflows),
      rerunPreflight: async () => { reruns += 1; return rerun(); },
    });
    return { client, reruns: () => reruns };
  };

  it("asks once per open dialog, only from Checks, and not again on a return to Checks", async () => {
    const served = missing(async () => { throw new Error("refused"); });
    const dialog = await h.openDialog(served.client);
    for (let wait = 0; wait < 6; wait += 1) await h.settle();
    assert.equal(served.reruns(), 0, "opening the dialog asks for no re-check");
    await reachChecks(dialog);
    assert.equal(served.reruns(), 1);
    await dialog.press("1 Input");
    await dialog.press("Next");
    for (let wait = 0; wait < 6; wait += 1) await h.settle();
    assert.equal(served.reruns(), 1, "a second visit to Checks only reads");
  });

  it("checks Separations on the first visit after Person Lookup was checked in the same dialog", async () => {
    const reruns: string[] = [];
    const prepared = new Set<string>();
    const ready = h.READY;
    assert.ok(ready.state === "present");
    const client = h.stubClient({
      readPreflight: async selection => selection !== undefined && prepared.has(selection.workflowId) ? ready
        : { state: "unavailable", code: "PREFLIGHT_EVIDENCE_MISSING", reason: "This workflow has no readiness report yet." },
      editableSettings: async () => FIXTURE_EDITABLE_SETTINGS,
      preflightScopes: async () => WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_START_PICKER_BOOTSTRAP.workflows),
      rerunPreflight: async request => {
        const command = PreflightRerunCommandRequestSchema.parse(request);
        const workflowId = command.target.selection?.workflowId;
        assert.ok(workflowId);
        reruns.push(workflowId);
        prepared.add(workflowId);
        return { state: "completed", commandId: command.commandId, report: ready.report };
      },
    });
    const separations = DESCRIPTORS.find(flow => flow.id === "separations");
    assert.ok(separations?.surfaces.inputRun);
    const other = { ...h.WORKFLOWS[0], workflowId: separations.id, label: separations.label, version: separations.version,
      steps: projectStartSteps(separations), inputRun: { state: "present" as const, surface: separations.surfaces.inputRun } };
    const dialog = await h.openDialog(client, { workflows: [h.WORKFLOWS[0], other], panelWorkflowId: h.WORKFLOW_ID });
    await reachChecks(dialog);
    assert.match(dialog.text(), /Ready to start/u);
    const pick = async (label: string) => {
      const button = [...document.body.querySelectorAll<HTMLButtonElement>('nav[aria-label="Workflow"] button')].find(node => node.textContent?.includes(label));
      assert.ok(button, label);
      await act(async () => button.click());
      for (let wait = 0; wait < 6; wait += 1) await h.settle();
    };
    await pick(other.label);
    await reachChecks(dialog, "4502");
    assert.match(dialog.text(), /Ready to start/u);
    assert.deepEqual(reruns, [h.WORKFLOW_ID, separations.id]);

    prepared.delete(h.WORKFLOW_ID);
    await pick(h.WORKFLOWS[0].label);
    await reachChecks(dialog);
    assert.match(dialog.text(), /This workflow has no readiness report yet/u);
    await dialog.rerender({ hidden: true });
    await dialog.rerender({ hidden: false });
    assert.deepEqual(reruns, [h.WORKFLOW_ID, separations.id], "an already checked workflow gets no second automatic check");
    await dialog.press("1 Input");
    await dialog.rerender({ open: false });
    await dialog.rerender({ open: true });
    await reachChecks(dialog);
    assert.deepEqual(reruns, [h.WORKFLOW_ID, separations.id, h.WORKFLOW_ID], "a reopened dialog can check the workflow again");
  });

  it("shows one message and Check again when the re-check is refused", async () => {
    const served = missing(async () => { throw new Error("refused"); });
    const dialog = await reachChecksWith(served.client);
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent ?? "");
    assert.deepEqual(alerts, ["Relay could not finish checking this run.Check again"]);
    assert.doesNotMatch(dialog.text(), /Checks are unavailable/u);
    assert.equal(dialog.disabled("Start run"), true);
  });

  it("reports a real readiness read failure without automatically running checks", async () => {
    let reruns = 0;
    const dialog = await reachChecksWith(h.stubClient({
      readPreflight: async () => ({ state: "unavailable", code: "PREFLIGHT_READ_FAILED", reason: "Protected settings presence could not be verified." }),
      editableSettings: async () => FIXTURE_EDITABLE_SETTINGS,
      preflightScopes: async () => WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_BOOTSTRAP.workflows),
      rerunPreflight: async () => { reruns += 1; throw new Error("Readiness report could not be read"); },
    }));
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /Protected settings presence could not be verified/u);
    assert.equal(dialog.disabled("Start run"), true);
    assert.equal(reruns, 0);
  });
});
async function reachChecksWith(client: Parameters<typeof h.openDialog>[0]) {
  const dialog = await h.openDialog(client);
  await reachChecks(dialog);
  return dialog;
}

describe("a refused re-check through the real client", () => {
  const ACTIVE = { state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready" };
  async function served(rerunStatus: number, rerunBody?: unknown) {
    const reports: unknown[] = [];
    const real = createDashboardClient({ baseUrl: "http://relay.test", surface: () => "app", fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/profile/state") return Response.json(ACTIVE);
      if (path === "/api/v1/debug/errors") {
        assert.equal(typeof init?.body, "string");
        if (typeof init?.body !== "string") throw new Error("Expected a JSON error report");
        reports.push(JSON.parse(init.body));
        return Response.json({ state: "recorded" });
      }
      if (path === "/api/v1/preflight") return Response.json({ state: "unavailable", reason: "Not checked yet." });
      if (path === "/api/v1/settings/editable") return Response.json(FIXTURE_EDITABLE_SETTINGS);
      if (path === "/api/v1/bootstrap") return Response.json(FIXTURE_BOOTSTRAP);
      if (path === "/api/v1/preflight/rerun") {
        if (typeof rerunBody === "string") return new Response(rerunBody, { status: rerunStatus, headers: { "content-type": "application/json" } });
        return Response.json(rerunBody ?? { state: "error", code: rerunStatus === 429 ? "PREFLIGHT_RATE_LIMITED" : "PREFLIGHT_RERUN_FAILED",
          message: rerunStatus === 429 ? "Relay allows six readiness checks per minute." : "refused", retryable: true }, { status: rerunStatus });
      }
      throw new Error(`unexpected request ${path}`);
    } });
    await real.readProfileSession();
    const client = h.stubClient({ readPreflight: real.readPreflight.bind(real), editableSettings: real.editableSettings.bind(real),
      preflightScopes: real.preflightScopes?.bind(real), rerunPreflight: real.rerunPreflight.bind(real) });
    return { reports, client };
  }
  /** Opens the dialog and lets its evidence read settle, so the count after it is what reaching Checks adds. */
  async function openSettled(client: Parameters<typeof h.openDialog>[0], reports: readonly unknown[]) {
    const dialog = await h.openDialog(client);
    await dialog.type(h.TYPED);
    for (let wait = 0; wait < 6; wait += 1) await h.settle();
    await new Promise(resolve => setTimeout(resolve, 50));
    return { dialog, before: reports.length };
  }
  async function toChecks(dialog: Awaited<ReturnType<typeof h.openDialog>>) {
    await dialog.press("Next");
    for (let wait = 0; wait < 6; wait += 1) await h.settle();
    assert.equal(dialog.stage(), "Start");
  }

  it("shows one notice and sends no error report when the server turns the re-check away (429)", async () => {
    const { reports, client } = await served(429);
    const { dialog, before } = await openSettled(client, reports);
    await toChecks(dialog);
    await new Promise(resolve => setTimeout(resolve, 50));
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent ?? "");
    assert.deepEqual(alerts, ["Relay allows six readiness checks per minute.Check again"]);
    assert.equal(dialog.disabled("Start run"), true);
    assert.equal(reports.length, before, "the turned-away re-check sends no report");
  });

  it("still reports an unexpected re-check failure (500)", async () => {
    const { reports, client } = await served(500);
    const { dialog, before } = await openSettled(client, reports);
    await toChecks(dialog);
    await vi.waitFor(() => assert.equal(reports.length, before + 1));
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /The readiness service returned HTTP 500/u);
  });

  it("explains a mismatched rerun response and keeps Start disabled", async () => {
    const workflow = WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_BOOTSTRAP.workflows).find(candidate => candidate.id === h.WORKFLOW_ID);
    assert.ok(workflow);
    const { client, reports } = await served(200, {
      state: "completed", commandId: "00000000-0000-4000-8000-000000000002",
      report: { ...healthyDashboardPreflightReport(manualClock(new Date("2026-11-17T12:00:00Z"))),
        configFingerprint: FIXTURE_EDITABLE_SETTINGS.activeConfigFingerprint, descriptorFingerprint: workflow.descriptorFingerprint },
    });
    const { dialog } = await openSettled(client, reports);
    await toChecks(dialog);
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /The response did not match the request\./u);
    assert.equal(dialog.disabled("Start run"), true);
  });

  it.each([
    { problem: "schema-invalid JSON", body: { state: "completed", commandId: "00000000-0000-4000-8000-000000000002", report: {} } },
    { problem: "malformed JSON", body: '{"state":' },
  ])("explains an HTTP 200 rerun response with $problem and keeps Start disabled", async ({ body }) => {
    const { client, reports } = await served(200, body);
    const { dialog } = await openSettled(client, reports);
    await toChecks(dialog);
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent ?? "");
    assert.deepEqual(alerts, ["Relay received an invalid readiness response.Check again"]);
    assert.equal(dialog.disabled("Start run"), true);
  });
});
