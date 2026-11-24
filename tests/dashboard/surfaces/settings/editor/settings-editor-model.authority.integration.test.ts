import { afterAll,afterEach,it,vi } from "vitest";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement,StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { useEditableSettings } from "../../../../../src/dashboard/surfaces/settings/editor/settings-editor-model.js";
import { EditableSettingsWireSchema,type EditableSettingsWire } from "../../../../../src/models/dashboard/settings-editor.js";
import { createErrorCatalogFailure,formatErrorCatalogFailure } from "../../../../../src/models/failures/error-catalog.js";
import { FixtureCommandBinding } from "../../../../support/helpers/dashboard/command-binding.js";
import { dropKeptResults } from "../../../../../src/dashboard/state/async-resource.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const authority = await syntheticSettingsAuthority(profileFixtures.create); cleanups.push(authority.close);
  const initial = authority.read();
  authority.apply({ "actor.label": { set: "Newer saved values" } });
  const newer = authority.read();
  let read = () => Promise.resolve(newer);
  const writes: unknown[] = [];
  const client = { editableSettings: () => read(),
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
    setRead(value: typeof read) { read = value; } };
}

for (const replacement of ["client", "actor", "descriptor"] as const) {
  it(`requires new ${replacement} reads before ordinary, protected, or relocation writes and ignores old replies`, async () => {
    const h = await setup();
    await act(async () => {
      h.controller().update("actor.label", "Retained ordinary draft");
      h.controller().protectedEditor.update("ucpathUserId", "Retained credential draft");
    });
    const draft = structuredClone(h.controller().draft);
    const protectedDraft = structuredClone(h.controller().protectedEditor.draft);
    let settleOld: ((value: EditableSettingsWire) => void) | undefined;
    h.setRead(() => new Promise(resolve => { settleOld = resolve; }));
    await act(async () => h.controller().reload());
    let settleNew: ((value: EditableSettingsWire) => void) | undefined;
    h.setRead(() => new Promise(resolve => { settleNew = resolve; }));
    await h.render(replacement === "client" ? { ...h.client } : h.client,
      replacement === "actor" ? "other-operator" : "local-operator", replacement === "descriptor" ? "e".repeat(64) : "d".repeat(64));
    assert.equal(h.controller().locked, true); assert.equal(h.controller().protectedEditor.locked, true);
    assert.deepEqual(h.writes, []);
    assert.ok(settleNew);
    await act(async () => { settleNew?.(h.initial); });
    assert.equal(h.controller().locked, false); assert.equal(h.controller().protectedEditor.locked, false);
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
    assert.ok(h.controller().readProblem);
    assert.equal(h.controller().readProblem, formatErrorCatalogFailure(createErrorCatalogFailure("SETTINGS_REFRESH_UNAVAILABLE", {})).text);
    assert.equal(h.controller().locked, true); assert.equal(h.controller().protectedEditor.locked, true);
    const editor = h.controller().editor; assert.ok(editor.state === "loaded"); assert.deepEqual(editor.document, h.newer);
    assert.deepEqual(h.writes, []);
  });
}

it("reads back an unknown protected save across actor replacement without resending it", async () => {
  const h = await setup();
  const control = () => h.controller().protectedEditor;
  const value = "https://example.test/saved-roster";
  const applied: string[] = [];
  const client = { ...h.client, executeCommand: (request: unknown) => {
    h.writes.push(request);
    applied.push(h.authority.execute(request).state);
    throw new Error("reply lost after save");
  } };
  await h.render(client);
  await act(async () => control().update("sharepointOnboardingRosterUrl", value));
  const readback = Promise.withResolvers<EditableSettingsWire>();
  h.setRead(() => readback.promise);
  await act(async () => control().submit());
  assert.equal(control().save.state, "unconfirmed");
  assert.deepEqual(applied, ["applied"]);
  assert.equal(h.writes.length, 1);
  const draft = structuredClone(control().draft);
  await h.render(client, "other-operator");
  assert.equal(control().save.state, "unconfirmed"); assert.equal(control().locked, true);
  assert.deepEqual(control().draft, draft);
  await act(async () => readback.resolve(h.authority.read()));
  await vi.waitFor(async () => { await act(async () => undefined); assert.equal(control().locked, false); });
  const editor = h.controller().editor; assert.ok(editor.state === "loaded");
  assert.ok(editor.document.protectedSettings.state === "available");
  assert.equal(editor.document.protectedSettings.entries.sharepointOnboardingRosterUrl?.value, value);
  assert.equal(control().dirtyCount, 0); assert.equal(control().save.state, "idle");
  assert.equal(h.writes.length, 1);
  assert.equal("retry" in control(), false, "the protected editor offers no replay action");
});

it("hides old authority and retains drafts while blocking writes when replacement reads fail", async () => {
  const h = await setup();
  await act(async () => {
    h.controller().update("actor.label", "Retained ordinary draft");
    h.controller().protectedEditor.update("ucpathUserId", "Retained protected draft");
  });
  const draft = structuredClone(h.controller().draft);
  const protectedDraft = structuredClone(h.controller().protectedEditor.draft);
  h.setRead(() => Promise.reject(new Error("replacement unavailable")));
  await h.render({ ...h.client });
  assert.equal(h.controller().locked, true); assert.equal(h.controller().protectedEditor.locked, true);
  const editor = h.controller().editor; assert.equal(editor.state, "failed");
  assert.deepEqual(h.controller().draft, draft); assert.deepEqual(h.controller().protectedEditor.draft, protectedDraft);
  assert.deepEqual(h.writes, []);
});

it("refuses protected revision rollback independently of an unchanged ordinary revision", async () => {
  const h = await setup();
  h.authority.protectedApply({ sharepointOnboardingRosterUrl: { set: "https://example.test/current-credential" } });
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

it("reopens from the exact verified document while sharing a pending refresh and keeps writes locked until it settles", async () => {
  const authority = await syntheticSettingsAuthority(profileFixtures.create); cleanups.push(authority.close);
  const original = authority.read();
  const held = Promise.withResolvers<EditableSettingsWire>();
  let calls = 0;
  const client = { editableSettings: () => ++calls === 1 ? Promise.resolve(original) : held.promise,
    } as unknown as DashboardClient;
  let controller: ReturnType<typeof useEditableSettings> | undefined;
  const seen: ReturnType<typeof useEditableSettings>["editor"][] = [];
  function Probe() { controller = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64) }); seen.push(controller.editor); return null; }
  const host = document.createElement("div"), root = createRoot(host);
  cleanups.push(() => { act(() => root.unmount()); });
  const render = async (open: boolean) => { await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: open ? createElement(Probe) : null }) }))); };
  await render(true); const verified = controller?.editor; assert.ok(verified?.state === "loaded");
  await render(false); seen.length = 0; await render(true);
  assert.equal(calls, 2); assert.ok(seen.every(state => state.state === "loaded" && state.document === verified.document));
  assert.ok(controller); assert.equal(controller.locked, true);
  await act(async () => controller?.reload()); assert.equal(calls, 2);
  await act(async () => held.resolve(original)); assert.equal(controller.locked, false);
});

for (const outcome of ["success", "failure"] as const) it(`settles editable and relocation ${outcome} after the production StrictMode effect replay`, async () => {
  const authority = await syntheticSettingsAuthority(profileFixtures.create); cleanups.push(authority.close);
  const client = { editableSettings: () => outcome === "success" ? Promise.resolve(authority.read()) : Promise.reject(new Error("synthetic editable unavailable")) } as unknown as DashboardClient;
  let state: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { state = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64) }); return null; }
  const root = createRoot(document.createElement("div")); cleanups.push(() => { act(() => root.unmount()); });
  await act(async () => root.render(createElement(StrictMode, { children: createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: createElement(Probe) }) }) })));
  assert.equal(state?.editor.state, outcome === "success" ? "loaded" : "failed");
  if (state?.editor.state === "failed") assert.equal(state.editor.message, formatErrorCatalogFailure(createErrorCatalogFailure("SETTINGS_INITIAL_READ_UNAVAILABLE", {})).text);
});

it("does not let an older refresh poison a newer authoritative command readback", async () => {
  const h = await setup();
  await h.render({ ...h.client, executeCommand: (request: unknown) => Promise.resolve(h.authority.execute(request)) });
  const old = Promise.withResolvers<EditableSettingsWire>(); let reads = 0;
  h.setRead(() => ++reads === 1 ? old.promise : Promise.resolve(h.authority.read()));
  await act(async () => h.controller().update("actor.label", "New authoritative value"));
  await act(async () => { h.controller().submit(); h.controller().reload(); });
  assert.equal(h.controller().dirtyCount, 0); assert.equal(h.controller().readProblem, undefined);
  await act(async () => old.resolve(h.newer));
  assert.equal(h.controller().readProblem, undefined); assert.equal(h.controller().locked, false);
  const editor = h.controller().editor; assert.ok(editor.state === "loaded"); assert.equal(editor.document.revision, h.authority.read().revision);
});

for (const trigger of ["section return", "stream reset"] as const) {
  it(`a ${trigger} locks the editor while it reads again, then settles on the fresh one`, async () => {
    const authority = await syntheticSettingsAuthority(profileFixtures.create); cleanups.push(authority.close);
    const first = authority.read();
    authority.apply({ "actor.label": { set: "Fresher saved values" } });
    const fresh = authority.read();
    let read = () => Promise.resolve(first);
    const client = { editableSettings: () => read(), executeCommand: () => { throw new Error("unexpected write"); } } as unknown as DashboardClient;
    let controller: ReturnType<typeof useEditableSettings> | undefined;
    function Harness({ view }: { view: string }) { controller = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64), view }); return null; }
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    cleanups.push(() => { act(() => root.unmount()); host.remove(); });
    const render = (view: string) => act(async () => root.render(createElement(DashboardClientProvider, { client,
      children: createElement(FixtureCommandBinding, { actorId: "local-operator", requestKey: 0, children: createElement(Harness, { view }) }) })));
    await render("general");
    await vi.waitFor(() => assert.equal(controller?.locked, false));
    const shown = controller?.editor.state === "loaded" ? controller.editor.document : undefined;
    assert.ok(shown);
    let settle!: (value: EditableSettingsWire) => void;
    read = () => new Promise(resolve => { settle = resolve; });
    if (trigger === "section return") await render("paths");
    else await act(async () => { dropKeptResults(client); });
    assert.equal(controller?.locked, true, "a kept document decides nothing");
    assert.equal(controller?.refreshing, true);
    if (trigger === "section return") assert.equal(controller?.editor.state === "loaded" ? controller.editor.document : undefined, shown, "a section return keeps the document on screen");
    else assert.equal(controller?.editor.state, "loading", "nothing read before a stream reset shows after it");
    await act(async () => { settle(fresh); });
    await vi.waitFor(() => assert.equal(controller?.locked, false));
    assert.equal(controller?.editor.state === "loaded" ? controller.editor.document.revision : undefined, fresh.revision);
    assert.equal(controller?.refreshing, false);
  });
}

for (const order of ["outgoing first", "incoming first"] as const) {
  it(`two overlapping section visits each settle only their own read (${order})`, async () => {
    const authority = await syntheticSettingsAuthority(profileFixtures.create); cleanups.push(authority.close);
    const shown = authority.read();
    authority.apply({ "actor.label": { set: "General's read" } });
    const general = authority.read();
    authority.apply({ "actor.label": { set: "Paths' read" } });
    const paths = authority.read();
    const settles: ((value: EditableSettingsWire) => void)[] = [];
    let read = () => Promise.resolve(shown);
    const client = { editableSettings: () => read(), executeCommand: () => { throw new Error("unexpected write"); } } as unknown as DashboardClient;
    let controller: ReturnType<typeof useEditableSettings> | undefined;
    function Harness({ view }: { view: string }) { controller = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64), view }); return null; }
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    cleanups.push(() => { act(() => root.unmount()); host.remove(); });
    const render = (view: string) => act(async () => root.render(createElement(DashboardClientProvider, { client,
      children: createElement(FixtureCommandBinding, { actorId: "local-operator", requestKey: 0, children: createElement(Harness, { view }) }) })));
    await render("paths");
    await vi.waitFor(() => assert.equal(controller?.locked, false));
    read = () => new Promise(resolve => { settles.push(resolve); });
    await render("general");
    await render("paths");
    assert.equal(settles.length, 2, "the return to Paths starts its own read instead of reusing General's");
    const label = () => controller?.leaves.find(leaf => leaf.path === "actor.label")?.settingsValue;
    if (order === "outgoing first") {
      await act(async () => { settles[0](general); });
      assert.equal(controller?.locked, true, "General's read does not unlock Paths");
      assert.notEqual(label(), "General's read");
      await act(async () => { settles[1](paths); });
    } else {
      await act(async () => { settles[1](paths); });
      await vi.waitFor(() => assert.equal(controller?.locked, false));
      await act(async () => { settles[0](general); });
    }
    await vi.waitFor(() => assert.equal(controller?.locked, false));
    assert.equal(label(), "Paths' read");
    assert.equal(controller?.editor.state === "loaded" ? controller.editor.document.revision : undefined, paths.revision);
  });
}

it("closing Settings mid-read retires that visit's read: a reopen reads again and settles only on its own reply", async () => {
  const authority = await syntheticSettingsAuthority(profileFixtures.create); cleanups.push(authority.close);
  const closed = authority.read();
  authority.apply({ "actor.label": { set: "Reopened read" } });
  const reopened = authority.read();
  const settles: ((value: EditableSettingsWire) => void)[] = [];
  const client = { editableSettings: () => new Promise<EditableSettingsWire>(resolve => { settles.push(resolve); }), executeCommand: () => { throw new Error("unexpected write"); } } as unknown as DashboardClient;
  let controller: ReturnType<typeof useEditableSettings> | undefined;
  function Harness() { controller = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64), view: "general" }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  const render = (open: boolean) => act(async () => root.render(createElement(DashboardClientProvider, { client,
    children: createElement(FixtureCommandBinding, { actorId: "local-operator", requestKey: 0, children: open ? createElement(Harness) : null }) })));
  await render(true);
  assert.equal(settles.length, 1);
  await render(false);
  await render(true);
  assert.equal(settles.length, 2, "the reopened Settings reads again instead of reusing the closed visit's read");
  await act(async () => { settles[0](closed); });
  assert.equal(controller?.locked, true, "the closed visit's reply unlocks nothing");
  assert.notEqual(controller?.editor.state === "loaded" ? controller.editor.document.revision : undefined, closed.revision);
  await act(async () => { settles[1](reopened); });
  await vi.waitFor(() => assert.equal(controller?.locked, false));
  assert.equal(controller?.editor.state === "loaded" ? controller.editor.document.revision : undefined, reopened.revision);
});

it("an unknown save reply that lands after a section switch is read back and frees the command lock", async () => {
  const authority = await syntheticSettingsAuthority(profileFixtures.create); cleanups.push(authority.close);
  const commands: unknown[] = [];
  let reply: (request: unknown) => Promise<unknown> = request => Promise.resolve(authority.execute(request));
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:43210", fetchImpl: async (url, init) => {
    if (url.endsWith("/settings/editable")) return new Response(JSON.stringify(authority.read()), { status: 200 });
    if (url.endsWith("/commands") && typeof init?.body === "string") {
      const request: unknown = JSON.parse(init.body); commands.push(request);
      return new Response(JSON.stringify(await reply(request)), { status: 200 });
    }
    throw new Error("unexpected-settings-test-request");
  } });
  let controller: ReturnType<typeof useEditableSettings> | undefined;
  function Harness({ view }: { view: string }) { controller = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64), view }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  const render = (view: string) => act(async () => root.render(createElement(DashboardClientProvider, { client,
    children: createElement(FixtureCommandBinding, { actorId: "local-operator", requestKey: 0, children: createElement(Harness, { view }) }) })));
  const label = () => controller?.leaves.find(leaf => leaf.path === "actor.label")?.settingsValue;
  await render("general");
  await vi.waitFor(() => assert.equal(controller?.locked, false));
  let lose!: () => void;
  reply = request => { authority.execute(request); return new Promise((_, reject) => { lose = () => reject(new Error("lost reply")); }); };
  await act(async () => { controller?.update("actor.label", "Sent from General"); });
  await act(async () => { controller?.submit(); });
  await vi.waitFor(() => assert.equal(commands.length, 1));
  await render("paths");
  await act(async () => { lose(); });
  await vi.waitFor(() => { assert.equal(label(), "Sent from General", "the read-back shows the stored write"); assert.equal(controller?.dirtyCount, 0); assert.equal(controller?.locked, false); }, { timeout: 5000, interval: 50 });
  reply = request => Promise.resolve(authority.execute(request));
  await act(async () => { controller?.update("actor.label", "Next edit", true); });
  await vi.waitFor(() => assert.equal(commands.length, 2, "the reservation was released, so the next edit reaches Relay"), { timeout: 5000, interval: 50 });
});
