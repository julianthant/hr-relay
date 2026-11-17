// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

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

  it("lists every check with problems first, in readable words and no check ids", async () => {
    const { client } = served(h.readiness([PASSING, WARNING, FIXABLE]));
    const dialog = await h.openDialog(client);
    await reachChecks(dialog);
    const rows = [...document.body.querySelectorAll('[aria-label="Check results"] .ds-run-row')].map(row => (row.textContent ?? "").trim());
    assert.equal(rows.length, 3);
    assert.match(rows[0] ?? "", /UCPath sign-in.*The UCPath password is missing\..*Add password/u);
    assert.match(rows[1] ?? "", /Current fiscal year.*The fiscal year ends soon\..*Warning/u);
    assert.match(rows[2] ?? "", /Runtime settings.*Ready/u);
    assert.ok(dialog.text().includes("1 of 3 ready"));
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
    const down = await h.openDialog(h.stubClient({ readPreflight: async () => ({ state: "unavailable", reason: "The runtime is restarting." }) }));
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

  it("says on a failed check with no Fix button that Settings cannot fix it and what to do", async () => {
    const files = { check: "filesystem.health", status: "fail", summary: "Relay is out of disk space." } as const;
    const address = { check: "endpoint.crm.prod", status: "fail", summary: "The CRM address is invalid." } as const;
    const { client } = served(h.readiness([files, address, PASSING]));
    const dialog = await h.openDialog(client);
    await reachChecks(dialog);
    assert.equal(h.buttons().filter(button => button.hasAttribute("data-run-check-fix")).length, 0);
    assert.match(dialog.text(), /Cannot be fixed in Settings\. Free up disk space, then check again\. Relay is out of disk space\./u);
    assert.match(dialog.text(), /Cannot be fixed in Settings\. Tell the operator to change this address\. The CRM address is invalid\./u);
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
});
