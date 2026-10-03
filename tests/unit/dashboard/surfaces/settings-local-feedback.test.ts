// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useProtectedSettings } from "../../../../src/dashboard/surfaces/settings-protected-model.js";
import { useProviderKeys } from "../../../../src/dashboard/surfaces/settings-provider-model.js";
import { SettingsSaveFeedback } from "../../../../src/dashboard/surfaces/settings-feedback.js";
import type { ConfirmedSettingsSave, DefinitiveSettingsRefusal } from "../../../../src/dashboard/surfaces/settings-save-feedback-model.js";
import { EditableSettingsWireSchema } from "../../../../src/models/dashboard/settings-editor.js";
import { PROVIDER_KEYS_SCHEMA_HASH } from "../../../../src/models/config/provider-keys.js";
import { fixtureSettingsDocument } from "../../../support/fixtures/dashboard/fixture-settings.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const A = "a".repeat(64); const B = "b".repeat(64);
const receiptId = "33333333-3333-4333-8333-333333333333";

it("protected save reports confirmed only after exact readback, without credential value", async () => {
  const initial = fixtureSettingsDocument();
  if (initial.protectedSettings.state !== "available") throw new Error("fixture unavailable");
  const entries = { ...initial.protectedSettings.readback.entries, ucpathUserId: {
    present: true as const, valueId: receiptId, updatedAt: "2026-10-02T12:00:00.000Z",
  } };
  const saved = EditableSettingsWireSchema.parse({ ...initial, protectedSettings: {
    ...initial.protectedSettings, readback: { revision: 2, entries }, entries: {
      ucpathUserId: { valueId: receiptId, value: "private-example", updatedAt: "2026-10-02T12:00:00.000Z" },
    },
  } });
  const onConfirmedSave = vi.fn<(receipt: ConfirmedSettingsSave) => void>();
  const client = { executeCommand: async (command: { commandId: string }) => ({ state: "applied", commandId: command.commandId,
    affectedTargets: [{ family: "protected-settings", revision: 2 }], restartRequired: false, revision: 2, entries }) } as unknown as DashboardClient;
  let model: ReturnType<typeof useProtectedSettings> | undefined;
  function Probe() { model = useProtectedSettings({ actorId: "local-operator", readReady: true, document: initial,
    refresh: async () => saved, onConfirmedSave }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })));
    await act(async () => model?.update("ucpathUserId", "private-example"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    assert.equal(model?.save.state, "applied");
    assert.equal(onConfirmedSave.mock.calls.length, 1);
    assert.equal(onConfirmedSave.mock.calls[0]?.[0].kind, "protected");
    assert.equal(JSON.stringify(onConfirmedSave.mock.calls).includes("private-example"), false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("provider save reports confirmed only after matching receipt, token, and readback", async () => {
  const base = fixtureSettingsDocument();
  const provider = (revision: number, sourceVersionToken: string, value: string) => EditableSettingsWireSchema.parse({ ...base, providerKeys: {
    state: "available", providerSchemaHash: PROVIDER_KEYS_SCHEMA_HASH, revision, sourceVersionToken,
    slots: value === "" ? {} : { GEMINI_API_KEY: value }, activeSlots: {}, parentSlotNames: [], fileSlotNamesAtBoot: [],
    bootFileRevision: 1, bootFileSourceVersionToken: A, overriddenSlots: [], restartRequired: true,
  } });
  const initial = provider(1, A, ""); const saved = provider(2, B, "private-provider-example");
  const onConfirmedSave = vi.fn<(receipt: ConfirmedSettingsSave) => void>();
  const client = { applyProviderKeys: async (command: { commandId: string }) => ({ state: "applied", commandId: command.commandId,
    affectedTargets: [{ family: "provider-keys", revision: 2 }], restartRequired: true, providerRevision: 2,
    providerReceiptId: receiptId, providerSourceVersionToken: B }) } as unknown as DashboardClient;
  let model: ReturnType<typeof useProviderKeys> | undefined;
  function Probe() { model = useProviderKeys({ actorId: "local-operator", readReady: true, document: initial,
    refresh: async () => saved, onConfirmedSave }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })));
    await act(async () => model?.add("GEMINI_API_KEY"));
    await act(async () => model?.update("GEMINI_API_KEY", "private-provider-example"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    assert.equal(model?.save.state, "applied");
    assert.equal(onConfirmedSave.mock.calls.length, 1);
    assert.equal(onConfirmedSave.mock.calls[0]?.[0].kind, "provider-key");
    assert.equal(JSON.stringify(onConfirmedSave.mock.calls).includes("private-provider-example"), false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("protected server rejection produces one closed refusal receipt and keeps the draft", async () => {
  const initial = fixtureSettingsDocument();
  const onDefinitiveRefusal = vi.fn<(receipt: DefinitiveSettingsRefusal) => void>();
  const client = { executeCommand: async (command: { commandId: string }) => ({ state: "rejected", commandId: command.commandId,
    code: "not-editable", message: "private server diagnostic" }) } as unknown as DashboardClient;
  let model: ReturnType<typeof useProtectedSettings> | undefined;
  function Probe() { model = useProtectedSettings({ actorId: "local-operator", readReady: true, document: initial,
    refresh: async () => initial, onDefinitiveRefusal }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })));
    await act(async () => model?.update("ucpathUserId", "private-example"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    assert.equal(model?.save.state, "refused");
    assert.equal(model?.save.state === "refused" ? model.save.feedback : undefined, "chip");
    assert.equal(model?.dirtyCount, 1);
    assert.deepEqual(onDefinitiveRefusal.mock.calls[0]?.[0], { actorId: "local-operator", commandId: onDefinitiveRefusal.mock.calls[0]?.[0].commandId,
      kind: "protected", outcome: "refused" });
    assert.equal(JSON.stringify(onDefinitiveRefusal.mock.calls).includes("private-example"), false);
    assert.equal(JSON.stringify(onDefinitiveRefusal.mock.calls).includes("private server diagnostic"), false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("protected server revision conflict emits a chip receipt and keeps the draft", async () => {
  const initial = fixtureSettingsDocument();
  const onDefinitiveRefusal = vi.fn<(receipt: DefinitiveSettingsRefusal) => void>();
  const client = { executeCommand: async (command: { commandId: string }) => ({ state: "conflict", commandId: command.commandId,
    currentVersion: 2, message: "private server diagnostic" }) } as unknown as DashboardClient;
  let model: ReturnType<typeof useProtectedSettings> | undefined;
  function Probe() { model = useProtectedSettings({ actorId: "local-operator", readReady: true, document: initial,
    refresh: async () => initial, onDefinitiveRefusal }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })));
    await act(async () => model?.update("ucpathUserId", "private-example"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    assert.equal(model?.save.state, "conflict");
    assert.equal(model?.save.state === "conflict" ? model.save.feedback : undefined, "chip");
    assert.equal(model?.dirtyCount, 1);
    assert.deepEqual(onDefinitiveRefusal.mock.calls[0]?.[0], { actorId: "local-operator", commandId: onDefinitiveRefusal.mock.calls[0]?.[0].commandId,
      kind: "protected", outcome: "conflict" });
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("provider server rejection produces one closed refusal receipt and keeps the edit", async () => {
  const base = fixtureSettingsDocument();
  const initial = EditableSettingsWireSchema.parse({ ...base, providerKeys: {
    state: "available", providerSchemaHash: PROVIDER_KEYS_SCHEMA_HASH, revision: 1, sourceVersionToken: A,
    slots: {}, activeSlots: {}, parentSlotNames: [], fileSlotNamesAtBoot: [], bootFileRevision: 1,
    bootFileSourceVersionToken: A, overriddenSlots: [], restartRequired: true,
  } });
  const onDefinitiveRefusal = vi.fn<(receipt: DefinitiveSettingsRefusal) => void>();
  const client = { applyProviderKeys: async (command: { commandId: string }) => ({ state: "rejected", commandId: command.commandId,
    code: "not-editable", message: "private server diagnostic" }) } as unknown as DashboardClient;
  let model: ReturnType<typeof useProviderKeys> | undefined;
  function Probe() { model = useProviderKeys({ actorId: "local-operator", readReady: true, document: initial,
    refresh: async () => initial, onDefinitiveRefusal }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })));
    await act(async () => model?.add("GEMINI_API_KEY"));
    await act(async () => model?.update("GEMINI_API_KEY", "private-provider-example"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    assert.equal(model?.save.state, "refused");
    assert.equal(model?.save.state === "refused" ? model.save.feedback : undefined, "chip");
    assert.equal(model?.dirtyCount, 1);
    assert.deepEqual(onDefinitiveRefusal.mock.calls[0]?.[0], { actorId: "local-operator", commandId: onDefinitiveRefusal.mock.calls[0]?.[0].commandId,
      kind: "provider-key", outcome: "refused" });
    assert.equal(JSON.stringify(onDefinitiveRefusal.mock.calls).includes("private-provider-example"), false);
    assert.equal(JSON.stringify(onDefinitiveRefusal.mock.calls).includes("private server diagnostic"), false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("provider server revision conflict emits a chip receipt and keeps the edit", async () => {
  const base = fixtureSettingsDocument();
  const initial = EditableSettingsWireSchema.parse({ ...base, providerKeys: {
    state: "available", providerSchemaHash: PROVIDER_KEYS_SCHEMA_HASH, revision: 1, sourceVersionToken: A,
    slots: {}, activeSlots: {}, parentSlotNames: [], fileSlotNamesAtBoot: [], bootFileRevision: 1,
    bootFileSourceVersionToken: A, overriddenSlots: [], restartRequired: true,
  } });
  const onDefinitiveRefusal = vi.fn<(receipt: DefinitiveSettingsRefusal) => void>();
  const client = { applyProviderKeys: async (command: { commandId: string }) => ({ state: "conflict", commandId: command.commandId,
    currentVersion: 2, message: "private server diagnostic" }) } as unknown as DashboardClient;
  let model: ReturnType<typeof useProviderKeys> | undefined;
  function Probe() { model = useProviderKeys({ actorId: "local-operator", readReady: true, document: initial,
    refresh: async () => initial, onDefinitiveRefusal }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })));
    await act(async () => model?.add("GEMINI_API_KEY"));
    await act(async () => model?.update("GEMINI_API_KEY", "private-provider-example"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    assert.equal(model?.save.state, "conflict");
    assert.equal(model?.save.state === "conflict" ? model.save.feedback : undefined, "chip");
    assert.equal(model?.dirtyCount, 1);
    assert.deepEqual(onDefinitiveRefusal.mock.calls[0]?.[0], { actorId: "local-operator", commandId: onDefinitiveRefusal.mock.calls[0]?.[0].commandId,
      kind: "provider-key", outcome: "conflict" });
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("server-refusal inline copy is suppressed while local validation and unknown recovery remain", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const retryConflict = vi.fn();
  const render = async (save: Parameters<typeof SettingsSaveFeedback>[0]["save"]) => act(async () => root.render(createElement(SettingsSaveFeedback, { save, retry: () => {}, retryConflict })));
  try {
    await render({ state: "refused", feedback: "chip", message: "server refusal", code: "not-editable" });
    assert.equal(host.textContent, "Retry edit");
    await act(async () => host.querySelector("button")?.click());
    assert.equal(retryConflict.mock.calls.length, 1);
    await render({ state: "conflict", feedback: "chip", message: "server revision conflict" });
    assert.equal(host.textContent, "Retry edit");
    await render({ state: "refused", message: "Check the draft values. No request was sent." });
    assert.match(host.textContent ?? "", /Check the draft values/u);
    await render({ state: "unconfirmed", message: "The write may have taken effect." });
    assert.match(host.textContent ?? "", /The write may have taken effect/u);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
