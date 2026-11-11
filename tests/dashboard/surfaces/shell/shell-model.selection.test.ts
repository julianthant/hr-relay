import { CommandExecutor, type CommandExecutionScope } from "../../../../src/dashboard/app/commands/command-executor.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { CommandResultSchema, SettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { mergeSettingsPatch } from "../../../../src/models/config/settings.js";
import type { SettingsOverride } from "../../../../src/models/config/schema.js";
import { fixtureSettingsDocument } from "../../../support/fixtures/dashboard/fixture-settings.js";
import { FIXTURE_BOOTSTRAP } from "../../../support/fixtures/dashboard/fixture-bootstrap.js";
import { createPersonPreferences } from "../../../../src/dashboard/state/person-preferences-model.js";
import { PersonPreferencesContext } from "../../../../src/dashboard/lib/person-preferences.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { useSelectedWorkflow } from "../../../../src/dashboard/surfaces/shell/shell-model.js";

it("clears an unavailable selection on catalog replacement without selecting a substitute", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const preferences = createPersonPreferences("preview");
  const seen: ReturnType<typeof useSelectedWorkflow>[] = [];
  function Probe({ workflows }: { workflows: readonly { id: string }[] }) { seen.push(useSelectedWorkflow(workflows)); return null; }
  const root = createRoot(document.createElement("div"));
  const render = async (ids: string[]) => { await act(async () => root.render(createElement(PersonPreferencesContext.Provider, { value: preferences, children: createElement(Probe, { workflows: ids.map(id => ({ id })) }) }))); };
  try {
    await render(["a", "b"]);
    const preference = localStorage.getItem("hr-dashboard.selected-workflow");
    assert.equal(seen.at(-1)?.canSelectWorkflowId("b"), true);
    assert.equal(seen.at(-1)?.canSelectWorkflowId("missing"), false);
    assert.equal(localStorage.getItem("hr-dashboard.selected-workflow"), preference);
    assert.equal(seen.at(-1)?.selectedWorkflowId, "a");
    await act(async () => seen.at(-1)?.setSelectedWorkflowId("b"));
    const start = seen.length;
    await render(["a"]);
    assert.ok(seen.slice(start).every(value => value.selectedWorkflowId === ""));
    assert.equal(localStorage.getItem("hr-dashboard.selected-workflow"), null);
    await render(["a", "b"]);
    assert.equal(seen.at(-1)?.selectedWorkflowId, "");
    assert.equal(seen.at(-1)?.canSelectWorkflowId("b"), true);
    assert.equal(seen.at(-1)?.canSelectWorkflowId("missing"), false);
    assert.equal(seen.at(-1)?.setSelectedWorkflowId("missing"), false);
    assert.equal(seen.at(-1)?.selectedWorkflowId, "");
  } finally { await act(async () => root.unmount()); localStorage.clear(); }
});

it("uses the first served workflow when a remembered workflow is unavailable at mount", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const preferences = createPersonPreferences("preview");
  await preferences.change({ "preferences.selectedWorkflowId": { set: "missing" } });
  let selected = "";
  function Probe() { selected = useSelectedWorkflow([{ id: "a" }]).selectedWorkflowId; return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(PersonPreferencesContext.Provider, { value: preferences, children: createElement(Probe) })));
    assert.equal(selected, "a");
    assert.equal(preferences.snapshot().value.selectedWorkflowId, "missing");
  } finally { await act(async () => root.unmount()); }
});

it("sends no Settings command for the current workflow and canonically saves a different selection once", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  let settings: SettingsOverride = { preferences: { selectedWorkflowId: "a" } };
  let revision = 1;
  const commands: ReturnType<typeof SettingsCommandRequestSchema.parse>[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    if (url.endsWith("/settings/editable")) return Response.json(fixtureSettingsDocument(settings, revision));
    assert.ok(url.endsWith("/commands"));
    assert.ok(typeof init?.body === "string");
    const command = SettingsCommandRequestSchema.parse(JSON.parse(init.body));
    commands.push(command);
    assert.equal(command.target.expectedRevision, revision);
    settings = mergeSettingsPatch(settings, command.payload.patch);
    const document = fixtureSettingsDocument(settings, ++revision);
    return Response.json(CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
      affectedTargets: [{ family: "settings", revision }], settingsRevision: revision,
      settingsFingerprint: document.settingsFingerprint, restartRequired: false }));
  } });
  const epoch = { client, bootstrap: { ...FIXTURE_BOOTSTRAP } };
  const scope: CommandExecutionScope = { client, actorId: "local-operator", authority: epoch, dayRequest: {} };
  const binding = { scope, executor: new CommandExecutor(() => scope), authority: { epoch, nowIso: FIXTURE_BOOTSTRAP.serverClock.now } };
  const preferences = createPersonPreferences("person");
  const close = preferences.connect(client, binding, () => binding);
  const ready = () => preferences.snapshot().state === "ready" ? Promise.resolve() : new Promise<void>((resolve, reject) => {
    const unsubscribe = preferences.subscribe(() => {
      const snapshot = preferences.snapshot();
      if (snapshot.state !== "ready" && snapshot.state !== "failed" && snapshot.state !== "uncertain") return;
      unsubscribe();
      if (snapshot.state === "ready") resolve(); else reject(new Error(snapshot.problem));
    });
  });
  const selections: ReturnType<typeof useSelectedWorkflow>[] = [];
  function Probe() { selections.push(useSelectedWorkflow([{ id: "a" }, { id: "b" }])); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await ready();
    await act(async () => root.render(createElement(PersonPreferencesContext.Provider, { value: preferences, children: createElement(Probe) })));
    assert.equal(selections.at(-1)?.selectedWorkflowId, "a");
    await act(async () => { assert.equal(selections.at(-1)?.setSelectedWorkflowId("a"), true); await ready(); });
    assert.equal(commands.length, 0);
    assert.equal(revision, 1);
    await act(async () => { assert.equal(selections.at(-1)?.setSelectedWorkflowId("b"), true); await ready(); });
    assert.equal(selections.at(-1)?.selectedWorkflowId, "b");
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.source, "person-preferences");
    assert.equal(commands[0]?.type, "apply-settings");
    assert.deepEqual(commands[0]?.payload.patch, { "preferences.selectedWorkflowId": { set: "b" } });
    assert.equal(revision, 2);
    await act(async () => { assert.equal(selections.at(-1)?.setSelectedWorkflowId("b"), true); await ready(); });
    assert.equal(commands.length, 1);
    assert.equal(selections.at(-1)?.setSelectedWorkflowId("missing"), false);
    assert.equal(commands.length, 1);
  } finally { await act(async () => root.unmount()); close(); preferences.clear(); }
});
