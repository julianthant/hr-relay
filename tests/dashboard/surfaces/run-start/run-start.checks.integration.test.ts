// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { FIXTURE_BOOTSTRAP } from "../../../support/fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../../support/fixtures/dashboard/fixture-settings.js";
import { PreflightRerunCommandRequestSchema } from "../../../../src/models/preflight/preflight-contract.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";

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
async function reachChecks(dialog: Awaited<ReturnType<typeof h.openDialog>>) {
  await dialog.type(h.TYPED);
  await dialog.press("Continue");
  await dialog.press("Continue");
  for (let wait = 0; wait < 6; wait += 1) await h.settle();
  assert.equal(dialog.stage(), "Checks");
}
const fixButton = (name: string) => h.buttons().find(button => h.buttonName(button) === name);

describe("the Run dialog's Checks step", () => {
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
    await slow.press("Continue");
    await slow.press("Continue");
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

  it("holds the list's place while checking: one Checking indicator over eight placeholder rows", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof h.readiness>>();
    const slow = await h.openDialog(h.stubClient({ readPreflight: () => pending.promise }));
    await slow.type(h.TYPED);
    await slow.press("Continue");
    await slow.press("Continue");
    const section = document.body.querySelector('section[aria-label="Checks"]');
    assert.equal(((section?.textContent ?? "").match(/Checking/gu) ?? []).length, 1, "the Checks section says Checking once");
    assert.equal(document.body.querySelectorAll('[aria-label="Checking"] .ds-run-row').length, 8);
    await act(async () => { pending.resolve(h.readiness([PASSING])); });
    assert.equal(document.body.querySelector('[aria-label="Checking"]'), null);
  });

  it("draws a failed check's fix as a button beside a Failed status, with its whole summary readable", async () => {
    const { client } = served(h.readiness([FIXABLE, PASSING]));
    const dialog = await h.openDialog(client);
    await dialog.rerender({ onFixCheck: () => undefined });
    await reachChecks(dialog);
    const row = document.body.querySelector('[aria-label="Check results"] .ds-run-row');
    assert.ok(row?.textContent?.includes("Failed"), "the status stays beside the button");
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
    assert.equal(document.body.querySelector('[role="dialog"]'), null, "the dialog is not drawn behind Settings");
    assert.deepEqual(h.closed, [], "hiding is not closing");
    await dialog.rerender({ onFixCheck: () => undefined, hidden: false });
    assert.equal(reads.length, 2, "the checks run again after Settings");
    assert.equal(dialog.stage(), "Checks");
    assert.equal(dialog.disabled("Start run"), false, "the fixed check no longer blocks Start");
    await dialog.press("Back");
    await dialog.press("Back");
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
    assert.equal(document.activeElement, fixButton("Add password"));
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
    await slow.press("Continue");
    await slow.press("Continue");
    const region = document.body.querySelector('section[aria-label="Checks"] [role="status"]');
    assert.ok(region?.textContent?.includes("Checking"));
    await act(async () => { pending.resolve(h.readiness([PASSING, UNFIXABLE])); });
    const after = document.body.querySelector('section[aria-label="Checks"] [role="status"]');
    assert.equal(after, region, "the same live region is updated, not replaced");
    assert.match(after?.textContent ?? "", /1 check needs fixing/u);
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
    await dialog.press("Back");
    await dialog.press("Continue");
    for (let wait = 0; wait < 6; wait += 1) await h.settle();
    assert.equal(served.reruns(), 1, "a second visit to Checks only reads");
  });

  it("does not ask again after switching workflow or returning from Settings, and asks once more after a reopen", async () => {
    const served = missing(async () => { throw new Error("refused"); });
    const separations = DESCRIPTORS.find(flow => flow.id === "separations");
    assert.ok(separations?.surfaces.inputRun);
    const other = { ...h.WORKFLOWS[0], workflowId: separations.id, label: separations.label, version: separations.version,
      steps: projectStartSteps(separations), inputRun: { state: "present" as const, surface: separations.surfaces.inputRun } };
    const dialog = await h.openDialog(served.client, { workflows: [h.WORKFLOWS[0], other], panelWorkflowId: h.WORKFLOW_ID });
    await reachChecks(dialog);
    assert.equal(served.reruns(), 1);
    const pick = async (label: string) => {
      const button = [...document.body.querySelectorAll<HTMLButtonElement>('nav[aria-label="Workflow"] button')].find(node => node.textContent?.includes(label));
      assert.ok(button, label);
      await act(async () => button.click());
      for (let wait = 0; wait < 6; wait += 1) await h.settle();
    };
    await pick(other.label);
    await pick(h.WORKFLOWS[0].label);
    assert.equal(served.reruns(), 1, "switching workflow asks for no second re-check");
    await dialog.rerender({ hidden: true });
    await dialog.rerender({ hidden: false });
    assert.equal(served.reruns(), 1, "returning from Settings asks for no second re-check");
    await dialog.rerender({ open: false });
    await dialog.rerender({ open: true });
    await reachChecks(dialog);
    assert.equal(served.reruns(), 2, "a reopened dialog may ask once more");
  });

  it("shows one message and Check again when the re-check is refused", async () => {
    const served = missing(async () => { throw new Error("refused"); });
    const dialog = await reachChecksWith(served.client);
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent ?? "");
    assert.deepEqual(alerts, ["Relay could not check this run.Check again"]);
    assert.doesNotMatch(dialog.text(), /Checks are unavailable/u);
    assert.equal(dialog.disabled("Start run"), true);
  });
});
async function reachChecksWith(client: Parameters<typeof h.openDialog>[0]) {
  const dialog = await h.openDialog(client);
  await reachChecks(dialog);
  return dialog;
}
