// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { useEditableSettings } from "../../../../../src/dashboard/surfaces/settings/editor/settings-editor-model.js";
import { FixtureCommandBinding } from "../../../../support/helpers/dashboard/command-binding.js";
import { syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";
import { FIXTURE_STORAGE_RELOCATION } from "../../../../parity/helpers/fixture-settings.js";
import { EditableSettingsWireSchema, type EditableSettingsWire } from "../../../../../src/models/dashboard/settings-editor.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

async function setup() {
  const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
  const initial = authority.read();
  authority.apply({ "actor.label": { set: "Newer saved values" } });
  const newer = authority.read();
  let read = () => Promise.resolve(newer);
  let relocationRead = () => Promise.resolve({ ...FIXTURE_STORAGE_RELOCATION, revision: 2 });
  const writes: unknown[] = [];
  const client = { editableSettings: () => read(), storageRelocationPlans: () => relocationRead(),
    executeCommand: (request: unknown) => { writes.push(request); throw new Error("unexpected write"); } } as unknown as DashboardClient;
  let controller: ReturnType<typeof useEditableSettings> | undefined;
  function Harness({ actorId, descriptorFingerprint }: { actorId: string; descriptorFingerprint: string }) {
    controller = useEditableSettings({ actorId, descriptorFingerprint });
    return null;
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  const render = async (currentClient = client, actorId = "local-operator", descriptorFingerprint = "d".repeat(64), requestKey = 0) => {
    await act(async () => root.render(createElement(DashboardClientProvider, { client: currentClient,
      children: createElement(FixtureCommandBinding, { actorId, requestKey,
        children: createElement(Harness, { actorId, descriptorFingerprint }) }) })));
  };
  await render();
  return { authority, initial, newer, client, writes, render,
    controller: () => { assert.ok(controller); return controller; },
    setRead(value: typeof read) { read = value; }, setRelocationRead(value: typeof relocationRead) { relocationRead = value; } };
}

for (const replacement of ["client", "actor", "descriptor"] as const) {
  it(`requires new ${replacement} reads before ordinary, protected, or relocation writes and ignores old replies`, async () => {
    const h = await setup();
    await act(async () => {
      h.controller().update("actor.label", "Retained ordinary draft");
      h.controller().protectedEditor.update("ucpathUserId", "Retained credential draft");
      h.controller().relocationEditor.update("artifactRoot", "/tmp/retained-artifacts");
    });
    const draft = structuredClone(h.controller().draft);
    const protectedDraft = structuredClone(h.controller().protectedEditor.draft);
    let settleOld: ((value: EditableSettingsWire) => void) | undefined;
    h.setRead(() => new Promise(resolve => { settleOld = resolve; }));
    await act(async () => h.controller().reload());
    let settleNew: ((value: EditableSettingsWire) => void) | undefined;
    let settleRelocation: ((value: typeof FIXTURE_STORAGE_RELOCATION) => void) | undefined;
    h.setRead(() => new Promise(resolve => { settleNew = resolve; }));
    h.setRelocationRead(() => new Promise(resolve => { settleRelocation = resolve; }));
    await h.render(replacement === "client" ? { ...h.client } : h.client,
      replacement === "actor" ? "other-operator" : "local-operator", replacement === "descriptor" ? "e".repeat(64) : "d".repeat(64));
    assert.equal(h.controller().locked, true); assert.equal(h.controller().protectedEditor.locked, true);
    assert.equal(h.controller().relocationEditor.locked, true);
    await act(async () => { h.controller().submit(); h.controller().protectedEditor.submit(); h.controller().relocationEditor.submit(); });
    assert.deepEqual(h.writes, []);
    assert.ok(settleNew); assert.ok(settleRelocation);
    await act(async () => { settleNew?.(h.initial); settleRelocation?.(FIXTURE_STORAGE_RELOCATION); });
    assert.equal(h.controller().locked, false); assert.equal(h.controller().protectedEditor.locked, false);
    assert.equal(h.controller().relocationEditor.locked, false);
    assert.ok(settleOld);
    await act(async () => settleOld?.(h.newer));
    const editor = h.controller().editor; assert.ok(editor.state === "loaded");
    assert.equal(editor.document.revision, h.initial.revision);
    assert.deepEqual(h.controller().draft, draft); assert.deepEqual(h.controller().protectedEditor.draft, protectedDraft);
    assert.deepEqual(h.writes, []);
  });
}

for (const problem of ["rollback", "divergent-fingerprint", "divergent-values", "divergent-protected"] as const) {
  it(`retains verified values and blocks writes after same-authority ${problem}`, async () => {
    const h = await setup();
    let next = h.initial;
    if (problem === "divergent-fingerprint") {
      const hash = "e".repeat(64);
      next = EditableSettingsWireSchema.parse({ ...h.newer, settingsFingerprint: hash, runtimeStatus: { state: "current", identity: {
        ...(h.newer.runtimeStatus.state === "current" ? h.newer.runtimeStatus.identity : h.newer.runtimeStatus.persisted), settingsFingerprint: hash } } });
    } else if (problem === "divergent-values") {
      next = EditableSettingsWireSchema.parse({ ...h.newer, sections: h.newer.sections.map(section => ({ ...section, leaves: section.leaves.map(leaf => leaf.path === "actor.label"
        ? { ...leaf, settingsValue: "Divergent values", effectiveValue: "Divergent values", activeValue: "Divergent values" } : leaf) })) });
    } else if (problem === "divergent-protected") {
      assert.ok(h.newer.protectedSettings.state === "available");
      next = EditableSettingsWireSchema.parse({ ...h.newer, protectedSettings: { ...h.newer.protectedSettings,
        entries: { ...h.newer.protectedSettings.entries, ucpathUserId: { value: "Different credential", valueId: "11111111-1111-4111-8111-111111111111", updatedAt: "2026-09-13T12:00:00.000Z" } },
        readback: { ...h.newer.protectedSettings.readback, entries: { ...h.newer.protectedSettings.readback.entries,
          ucpathUserId: { present: true, valueId: "11111111-1111-4111-8111-111111111111", updatedAt: "2026-09-13T12:00:00.000Z" } } } } });
    }
    h.setRead(() => Promise.resolve(next));
    await act(async () => h.controller().reload());
    assert.ok(h.controller().readProblem); assert.equal(h.controller().locked, true); assert.equal(h.controller().protectedEditor.locked, true);
    const editor = h.controller().editor; assert.ok(editor.state === "loaded"); assert.deepEqual(editor.document, h.newer);
    assert.deepEqual(h.writes, []);
  });
}

for (const family of ["ordinary", "protected", "relocation"] as const) {
  it(`retains the unknown ${family} envelope across actor replacement without dispatching it as the new actor`, async () => {
    const h = await setup();
    const control = () => family === "ordinary" ? h.controller() : family === "protected" ? h.controller().protectedEditor : h.controller().relocationEditor;
    await act(async () => {
      if (family === "ordinary") h.controller().update("actor.label", "Retained draft");
      else if (family === "protected") h.controller().protectedEditor.update("ucpathUserId", "Retained draft");
      else h.controller().relocationEditor.update("artifactRoot", "/tmp/retained-artifacts");
    });
    await act(async () => control().submit());
    assert.equal(control().save.state, "unconfirmed"); const original = structuredClone(h.writes[0]);
    const draft = structuredClone(control().draft);
    await h.render(h.client, "other-operator");
    await act(async () => control().retry());
    assert.equal(control().save.state, "unconfirmed"); assert.equal(control().locked, true);
    assert.deepEqual(control().draft, draft); assert.deepEqual(h.writes, [original]);
    await h.render({ ...h.client });
    await act(async () => control().retry());
    assert.deepEqual(h.writes, [original, original]);
  });
}

it("retains old documents and drafts but blocks all writes when replacement reads fail", async () => {
  const h = await setup();
  await act(async () => {
    h.controller().update("actor.label", "Retained ordinary draft");
    h.controller().protectedEditor.update("ucpathUserId", "Retained protected draft");
    h.controller().relocationEditor.update("artifactRoot", "/tmp/retained-artifacts");
  });
  const draft = structuredClone(h.controller().draft);
  const protectedDraft = structuredClone(h.controller().protectedEditor.draft);
  h.setRead(() => Promise.reject(new Error("replacement unavailable")));
  h.setRelocationRead(() => Promise.reject(new Error("replacement unavailable")));
  await h.render({ ...h.client });
  assert.equal(h.controller().locked, true); assert.equal(h.controller().protectedEditor.locked, true);
  assert.equal(h.controller().relocationEditor.locked, true);
  await act(async () => { h.controller().submit(); h.controller().protectedEditor.submit(); h.controller().relocationEditor.submit(); });
  const editor = h.controller().editor; assert.ok(editor.state === "loaded"); assert.deepEqual(editor.document, h.newer);
  assert.deepEqual(h.controller().draft, draft); assert.deepEqual(h.controller().protectedEditor.draft, protectedDraft);
  assert.deepEqual(h.writes, []);
});

it("refuses protected revision rollback independently of an unchanged ordinary revision", async () => {
  const h = await setup();
  h.authority.protectedApply({ ucpathUserId: { set: "Current credential" } });
  const current = h.authority.read();
  assert.equal(current.revision, h.newer.revision);
  h.setRead(() => Promise.resolve(current));
  await act(async () => h.controller().reload());
  assert.equal(h.controller().locked, false);
  h.setRead(() => Promise.resolve(h.newer));
  await act(async () => h.controller().reload());
  assert.equal(h.controller().locked, true); assert.equal(h.controller().protectedEditor.locked, true);
  const editor = h.controller().editor; assert.ok(editor.state === "loaded"); assert.deepEqual(editor.document, current);
  assert.deepEqual(h.writes, []);
});
