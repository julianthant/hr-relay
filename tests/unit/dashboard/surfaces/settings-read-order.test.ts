// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useEditableSettings } from "../../../../src/dashboard/surfaces/settings-editor-model.js";
import { useProviderKeys } from "../../../../src/dashboard/surfaces/settings-provider-model.js";
import type { ConfirmedSettingsSave, DefinitiveSettingsRefusal, UnconfirmedSettingsSave } from "../../../../src/dashboard/surfaces/settings-save-feedback-model.js";
import { PROVIDER_KEYS_SCHEMA_HASH } from "../../../../src/models/config/provider-keys.js";
import { EditableSettingsWireSchema, type EditableSettingsWire } from "../../../../src/models/dashboard/settings-editor.js";
import { fixtureSettingsDocument } from "../../../support/fixtures/dashboard/fixture-settings.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
function documentWithProvider(token: string, value: string): EditableSettingsWire {
  return EditableSettingsWireSchema.parse({ ...fixtureSettingsDocument(), providerKeys: {
    state: "available", providerSchemaHash: PROVIDER_KEYS_SCHEMA_HASH, revision: 1, sourceVersionToken: token,
    slots: { GEMINI_API_KEY: value }, activeSlots: {}, parentSlotNames: [], fileSlotNamesAtBoot: [],
    bootFileRevision: 1, bootFileSourceVersionToken: A, overriddenSlots: [], restartRequired: true,
  } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root | undefined;
afterEach(() => { if (root !== undefined) act(() => root?.unmount()); root = undefined; });

it("keeps the latest provider read through A/B settlements and ignores an older failed read", async () => {
  const reads: ReturnType<typeof deferred<EditableSettingsWire>>[] = [];
  const client = { editableSettings: () => { const next = deferred<EditableSettingsWire>(); reads.push(next); return next.promise; },
    preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }),
  } as unknown as DashboardClient;
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: A }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })); });
    assert.equal(reads.length, 1);
    await act(async () => { reads[0]?.resolve(documentWithProvider(A, "first")); });
    assert.equal(editor?.editor.state, "loaded");
    await act(async () => { editor?.reload(); editor?.reload(); });
    assert.equal(reads.length, 3);
    await act(async () => { reads[2]?.resolve(documentWithProvider(C, "latest")); });
    await act(async () => { reads[1]?.resolve(documentWithProvider(B, "older")); });
    assert.equal(editor?.editor.state, "loaded");
    if (editor?.editor.state !== "loaded") throw new Error("settings editor did not load");
    assert.equal(editor.editor.document.providerKeys.state, "available");
    if (editor.editor.document.providerKeys.state !== "available") throw new Error("provider keys unavailable");
    assert.equal(editor.editor.document.providerKeys.sourceVersionToken, C);
    assert.equal(editor.readProblem, undefined);
    await act(async () => { editor?.reload(); editor?.reload(); });
    await act(async () => { reads[4]?.resolve(documentWithProvider(A, "newest")); });
    await act(async () => { reads[3]?.reject(new Error("older failure")); });
    if (editor?.editor.state !== "loaded" || editor.editor.document.providerKeys.state !== "available") throw new Error("provider keys unavailable");
    assert.equal(editor.editor.document.providerKeys.sourceVersionToken, A);
    assert.equal(editor.readProblem, undefined);
  } finally { host.remove(); }
});

it("rejects old client incarnations across A to B to A", async () => {
  const aReads: ReturnType<typeof deferred<EditableSettingsWire>>[] = [];
  const bReads: ReturnType<typeof deferred<EditableSettingsWire>>[] = [];
  const client = (reads: typeof aReads) => ({ editableSettings: () => {
    const next = deferred<EditableSettingsWire>(); reads.push(next); return next.promise;
  }, preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }) }) as unknown as DashboardClient;
  const a = client(aReads);
  const b = client(bReads);
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: A }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  const render = async (selected: DashboardClient) => act(async () => {
    if (root === undefined) root = createRoot(host);
    root.render(createElement(DashboardClientProvider, { client: selected, children: createElement(Probe) }));
  });
  try {
    await render(a);
    assert.equal(aReads.length, 1);
    await render(b);
    assert.equal(bReads.length, 1);
    await render(a);
    assert.equal(aReads.length, 2);
    await act(async () => { aReads[1]?.resolve(documentWithProvider(C, "latest")); });
    await act(async () => { aReads[0]?.resolve(documentWithProvider(A, "obsolete")); bReads[0]?.reject(new Error("obsolete failure")); });
    if (editor?.editor.state !== "loaded" || editor.editor.document.providerKeys.state !== "available") throw new Error("provider keys unavailable");
    assert.equal(editor.editor.document.providerKeys.sourceVersionToken, C);
    assert.equal(editor.readProblem, undefined);
  } finally { host.remove(); }
});

it("keeps a superseded ordinary draft unlocked and never resubmits it", async () => {
  const accepted = fixtureSettingsDocument({ actor: { label: "accepted" } }, 2);
  const later = fixtureSettingsDocument({ actor: { label: "later" } }, 3);
  let reads = 0;
  let submissions = 0;
  const onConfirmedSave = vi.fn<(receipt: ConfirmedSettingsSave) => void>();
  const onDefinitiveRefusal = vi.fn<(receipt: DefinitiveSettingsRefusal) => void>();
  const client = { editableSettings: async () => ++reads === 1 ? fixtureSettingsDocument() : later,
    applySettings: async (command: { commandId: string }) => {
      submissions += 1;
      return { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "settings", revision: 2 }],
        restartRequired: false, settingsRevision: 2, settingsFingerprint: accepted.settingsFingerprint };
    }, preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }),
  } as unknown as DashboardClient;
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: A, onConfirmedSave, onDefinitiveRefusal }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })); });
    await act(async () => { editor?.update("actor.label", "accepted"); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
    assert.equal(submissions, 1);
    assert.equal(editor?.save.state, "conflict");
    assert.equal(editor?.locked, false);
    assert.equal(editor?.dirtyCount, 1);
    assert.equal(onConfirmedSave.mock.calls.length, 0);
    assert.equal(onDefinitiveRefusal.mock.calls.length, 0);
    if (editor?.editor.state !== "loaded") throw new Error("settings editor did not load");
    assert.equal(editor.editor.document.revision, 3);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
    assert.equal(submissions, 1);
  } finally { host.remove(); }
});

it("emits one ordinary save receipt only after matching result and persisted readback", async () => {
  const saved = fixtureSettingsDocument({ actor: { label: "saved" } }, 2);
  let reads = 0;
  const onConfirmedSave = vi.fn<(receipt: ConfirmedSettingsSave) => void>();
  const client = { editableSettings: async () => ++reads === 1 ? fixtureSettingsDocument() : saved,
    applySettings: async (command: { commandId: string }) => ({ state: "applied", commandId: command.commandId,
      affectedTargets: [{ family: "settings", revision: 2 }], restartRequired: false, settingsRevision: 2,
      settingsFingerprint: saved.settingsFingerprint }),
    preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }),
  } as unknown as DashboardClient;
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: A, onConfirmedSave }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })); });
    await act(async () => { editor?.update("actor.label", "saved"); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
    assert.equal(editor?.save.state, "applied");
    assert.equal(onConfirmedSave.mock.calls.length, 1);
    assert.deepEqual(onConfirmedSave.mock.calls[0]?.[0], { actorId: "local-operator", commandId: onConfirmedSave.mock.calls[0]?.[0].commandId,
      kind: "ordinary", replayed: false });
  } finally { host.remove(); }
});

it("ordinary server revision conflict emits one chip receipt after refresh and keeps the edit", async () => {
  const current = fixtureSettingsDocument({ actor: { label: "other" } }, 2);
  let reads = 0;
  const onDefinitiveRefusal = vi.fn<(receipt: DefinitiveSettingsRefusal) => void>();
  const client = { editableSettings: async () => ++reads === 1 ? fixtureSettingsDocument() : current,
    applySettings: async (command: { commandId: string }) => ({ state: "conflict", commandId: command.commandId,
      currentVersion: 2, message: "private server diagnostic" }),
    preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }),
  } as unknown as DashboardClient;
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: A, onDefinitiveRefusal }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })); });
    await act(async () => { editor?.update("actor.label", "retained"); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
    assert.equal(editor?.save.state, "conflict");
    assert.equal(editor?.save.state === "conflict" ? editor.save.feedback : undefined, "chip");
    assert.equal(editor?.dirtyCount, 1);
    assert.equal(editor?.editor.state, "loaded");
    assert.deepEqual(onDefinitiveRefusal.mock.calls[0]?.[0], { actorId: "local-operator", commandId: onDefinitiveRefusal.mock.calls[0]?.[0].commandId,
      kind: "ordinary", outcome: "conflict" });
    assert.equal(JSON.stringify(onDefinitiveRefusal.mock.calls).includes("private server diagnostic"), false);
  } finally { host.remove(); }
});

it("ordinary server rejection emits a closed chip receipt without confirming a save", async () => {
  const onDefinitiveRefusal = vi.fn<(receipt: DefinitiveSettingsRefusal) => void>(() => { throw new Error("toast delivery failed"); });
  const onConfirmedSave = vi.fn<(receipt: ConfirmedSettingsSave) => void>();
  const client = { editableSettings: async () => fixtureSettingsDocument(),
    applySettings: async (command: { commandId: string }) => ({ state: "rejected", commandId: command.commandId,
      code: "not-editable", message: "private server diagnostic" }),
    preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }),
  } as unknown as DashboardClient;
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: A, onDefinitiveRefusal, onConfirmedSave }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })); });
    await act(async () => { editor?.update("actor.label", "retained"); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
    assert.equal(editor?.save.state, "refused");
    assert.equal(editor?.save.state === "refused" ? editor.save.feedback : undefined, "chip");
    assert.equal(editor?.dirtyCount, 1);
    assert.equal(onConfirmedSave.mock.calls.length, 0);
    assert.deepEqual(onDefinitiveRefusal.mock.calls[0]?.[0], { actorId: "local-operator", commandId: onDefinitiveRefusal.mock.calls[0]?.[0].commandId,
      kind: "ordinary", outcome: "refused" });
    assert.equal(JSON.stringify(onDefinitiveRefusal.mock.calls).includes("private server diagnostic"), false);
  } finally { host.remove(); }
});

it("ordinary authority uncertainty keeps exact retry and emits a closed unconfirmed receipt", async () => {
  const onUnconfirmedSave = vi.fn<(receipt: UnconfirmedSettingsSave) => void>();
  let commands = 0;
  const client = { editableSettings: async () => fixtureSettingsDocument(),
    applySettings: async (command: { commandId: string }) => { commands += 1; return { state: "rejected", commandId: command.commandId,
      code: "authority-uncertain", message: "private server diagnostic" }; },
    preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }),
  } as unknown as DashboardClient;
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: A, onUnconfirmedSave }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })); });
    await act(async () => { editor?.update("actor.label", "retained"); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
    assert.equal(editor?.save.state, "unconfirmed");
    assert.equal(editor?.locked, true);
    assert.equal(editor?.dirtyCount, 1);
    assert.deepEqual(onUnconfirmedSave.mock.calls[0]?.[0], { actorId: "local-operator", commandId: onUnconfirmedSave.mock.calls[0]?.[0].commandId, kind: "ordinary" });
    assert.equal(JSON.stringify(onUnconfirmedSave.mock.calls).includes("private server diagnostic"), false);
    await act(async () => editor?.retry());
    assert.equal(commands, 2);
    assert.equal(onUnconfirmedSave.mock.calls[1]?.[0].commandId, onUnconfirmedSave.mock.calls[0]?.[0].commandId);
  } finally { host.remove(); }
});

it("ordinary post-dispatch unknown emits no result-text claim and preserves recovery", async () => {
  const onUnconfirmedSave = vi.fn<(receipt: UnconfirmedSettingsSave) => void>();
  const client = { editableSettings: async () => fixtureSettingsDocument(),
    applySettings: async () => { throw new Error("private transport diagnostic"); },
    preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }),
  } as unknown as DashboardClient;
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: A, onUnconfirmedSave }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })); });
    await act(async () => { editor?.update("actor.label", "retained"); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
    assert.equal(editor?.save.state, "unconfirmed");
    assert.equal(editor?.locked, true);
    assert.equal(editor?.dirtyCount, 1);
    assert.equal(onUnconfirmedSave.mock.calls.length, 1);
    assert.equal(JSON.stringify(onUnconfirmedSave.mock.calls).includes("private transport diagnostic"), false);
  } finally { host.remove(); }
});

it("keeps a superseded provider draft unlocked and never resubmits it", async () => {
  const initial = EditableSettingsWireSchema.parse({ ...fixtureSettingsDocument(), providerKeys: {
    state: "available", providerSchemaHash: PROVIDER_KEYS_SCHEMA_HASH, revision: 1, sourceVersionToken: A,
    slots: {}, activeSlots: {}, parentSlotNames: [], fileSlotNamesAtBoot: [], bootFileRevision: 1,
    bootFileSourceVersionToken: A, overriddenSlots: [], restartRequired: false,
  } });
  const later = EditableSettingsWireSchema.parse({ ...initial, providerKeys: {
    ...initial.providerKeys, revision: 3, sourceVersionToken: C, slots: { GEMINI_API_KEY: "later" },
  } });
  let submissions = 0;
  const client = { applyProviderKeys: async (command: { commandId: string }) => {
    submissions += 1;
    return { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "provider-keys", revision: 2 }],
      restartRequired: true, providerRevision: 2, providerReceiptId: "33333333-3333-4333-8333-333333333333",
      providerSourceVersionToken: B };
  } } as unknown as DashboardClient;
  let editor: ReturnType<typeof useProviderKeys> | undefined;
  function Probe() { editor = useProviderKeys({ actorId: "local-operator", readReady: true, document: initial,
    refresh: async () => later }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  try {
    await act(async () => { root = createRoot(host); root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })); });
    await act(async () => { editor?.add("GEMINI_API_KEY"); });
    await act(async () => { editor?.update("GEMINI_API_KEY", "accepted"); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    assert.equal(submissions, 1);
    assert.equal(editor?.save.state, "conflict");
    assert.equal(editor?.locked, false);
    assert.equal(editor?.dirtyCount, 1);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    assert.equal(submissions, 1);
  } finally { host.remove(); }
});

it("keeps an exact attempt uncertain when its old client result settles after A to B to A", async () => {
  const oldResult = deferred<unknown>();
  const accepted = fixtureSettingsDocument({ actor: { label: "accepted" } }, 2);
  let submissions = 0;
  let attemptId = "";
  const onUnconfirmedSave = vi.fn<(receipt: UnconfirmedSettingsSave) => void>();
  const clientA = { editableSettings: async () => fixtureSettingsDocument(),
    applySettings: async (command: { commandId: string }) => { submissions += 1; attemptId = command.commandId; return oldResult.promise; },
    preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }),
  } as unknown as DashboardClient;
  const clientB = { editableSettings: async () => fixtureSettingsDocument(),
    preflightScopes: async () => [], readPreflight: async () => ({ state: "unavailable", reason: "synthetic" }),
  } as unknown as DashboardClient;
  let editor: ReturnType<typeof useEditableSettings> | undefined;
  function Probe() { editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: A, onUnconfirmedSave }); return null; }
  const host = document.createElement("div"); document.body.append(host);
  const render = async (client: DashboardClient) => act(async () => {
    if (root === undefined) root = createRoot(host);
    root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) }));
  });
  try {
    await render(clientA);
    await act(async () => { editor?.update("actor.label", "accepted"); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
    assert.equal(submissions, 1);
    await render(clientB);
    await render(clientA);
    await act(async () => { oldResult.resolve({ state: "applied", commandId: attemptId,
      affectedTargets: [{ family: "settings", revision: 2 }], restartRequired: false,
      settingsRevision: 2, settingsFingerprint: accepted.settingsFingerprint }); });
    assert.equal(editor?.save.state, "unconfirmed");
    assert.equal(editor?.dirtyCount, 1);
    assert.equal(editor?.editor.state, "loaded");
    assert.equal(onUnconfirmedSave.mock.calls.length, 0);
  } finally { host.remove(); }
});
