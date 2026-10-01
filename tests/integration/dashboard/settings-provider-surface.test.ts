// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it, vi } from "vitest";
import { ProviderKeysCommandRequestSchema, ProviderKeysRetryIntentSchema } from "../../../src/domain/commands.js";
import { mountSettingsHarness, settingsAction, syntheticSettingsAuthority } from "./helpers/settings-harness.js";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
async function setup(options: { file?: string; parentSlots?: NodeJS.ProcessEnv; afterRename?: () => void } = {}) {
  const authority = syntheticSettingsAuthority({ providerFile: options.file ?? "GEMINI_API_KEY='synthetic-saved-one'\nGEMINI_API_KEY3='synthetic-saved-three'\n",
    parentSlots: options.parentSlots, providerHooks: { afterRename: options.afterRename } });
  cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority, "credentials"); cleanups.push(mounted.close);
  return { ...mounted, authority };
}
function providerDocument(h: Awaited<ReturnType<typeof setup>>) {
  const keys = h.controller().editor;
  if (keys.state !== "loaded" || (keys.document.providerKeys.state !== "available" && keys.document.providerKeys.state !== "pending")) throw new Error("provider fixture unavailable");
  return keys.document.providerKeys;
}

describe("Credentials provider editor", () => {
  it("shows saved and sparse parent-only slots masked with stable identities", async () => {
    const h = await setup({ parentSlots: { GROQ_API_KEY3: " synthetic-parent-three ", GEMINI_API_KEY3: "synthetic-parent-override" } });
    const keys = providerDocument(h);
    assert.equal(keys.activeSlots.GROQ_API_KEY3, "synthetic-parent-three");
    assert.equal(keys.slots.GEMINI_API_KEY3, "synthetic-saved-three");
    assert.equal(h.host.querySelectorAll('input[type="password"]').length, 4);
    assert.ok(h.host.querySelector('button[aria-label="Show UCPath password"]'));
    assert.ok(h.host.querySelector('button[aria-label="Show Historical Activity pseudonym"]'));
    assert.equal(h.host.querySelectorAll('.settings-provider-families input[type="password"]').length, 2);
    assert.doesNotMatch(h.host.textContent ?? "", /synthetic-saved-one|synthetic-parent-three/u);
    const gemini = [...h.host.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "Show Gemini Key 1");
    assert.ok(gemini);
    await act(async () => gemini.click());
    assert.equal(h.host.querySelectorAll('.settings-provider-families input[type="text"]').length, 1);
    const groqGroup = [...h.host.querySelectorAll("button")].find(button => button.textContent?.includes("Groq") && button.textContent.includes("saved keys"));
    assert.ok(groqGroup); await act(async () => groqGroup.click());
    assert.match(h.host.textContent ?? "", /Key 3/u);
    assert.doesNotMatch(h.host.textContent ?? "", /Key 2/u);
    assert.equal([...h.host.querySelectorAll("button")].some(button => button.getAttribute("aria-label") === "Remove Groq Key 3"), false);
  });

  it("adds the lowest free file slot, saves only valid edits, and preserves sparse numbering", async () => {
    const h = await setup();
    await settingsAction(() => { assert.equal(h.controller().providerEditor.add("GEMINI_API_KEY"), "GEMINI_API_KEY2"); });
    assert.equal(h.controller().providerEditor.dirtyCount, 1);
    assert.equal(h.controller().providerEditor.errors.GEMINI_API_KEY2, "Enter a provider key before saving.");
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    assert.equal(h.commands.length, 0);
    await settingsAction(() => h.controller().providerEditor.update("GEMINI_API_KEY2", "synthetic-new-two"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1201); });
    assert.equal(h.controller().providerEditor.save.state, "applied");
    const command = ProviderKeysCommandRequestSchema.parse(h.commands[0]);
    assert.deepEqual(command.payload.operations, { GEMINI_API_KEY2: { set: "synthetic-new-two" } });
    assert.equal(providerDocument(h).slots.GEMINI_API_KEY2, "synthetic-new-two");
    assert.equal(providerDocument(h).slots.GEMINI_API_KEY3, "synthetic-saved-three");
  });

  it("cancels removal, restores focus, then confirms only the selected saved slot", async () => {
    const h = await setup();
    const remove = [...h.host.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "Remove Gemini Key 1");
    assert.ok(remove); remove.focus();
    await act(async () => remove.click());
    assert.match(document.body.textContent ?? "", /Remove Gemini Key 1\?/u);
    const cancel = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Cancel");
    assert.ok(cancel); await act(async () => cancel.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.equal(h.controller().providerEditor.dirtyCount, 0);
    assert.equal(document.activeElement?.getAttribute("aria-label"), "Remove Gemini Key 1");
    await act(async () => remove.click());
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.equal(h.controller().providerEditor.dirtyCount, 0);
    assert.equal(document.activeElement?.getAttribute("aria-label"), "Remove Gemini Key 1");
    await act(async () => remove.click());
    const confirm = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Remove key");
    assert.ok(confirm); await act(async () => confirm.click());
    assert.deepEqual(h.controller().providerEditor.draft.GEMINI_API_KEY, { kind: "clear" });
    await settingsAction(() => h.controller().providerEditor.submit());
    assert.equal(providerDocument(h).slots.GEMINI_API_KEY, undefined);
    assert.equal(providerDocument(h).slots.GEMINI_API_KEY3, "synthetic-saved-three");
  });

  it("retains an exact attempt after an unknown response and rejects divergent editing", async () => {
    const h = await setup();
    h.ports.execute = input => { const result = h.authority.execute(input); if (h.commands.length === 1) throw new Error("synthetic-lost-response"); return result; };
    await settingsAction(() => h.controller().providerEditor.update("GEMINI_API_KEY", "synthetic-replacement"));
    await settingsAction(() => h.controller().providerEditor.submit());
    assert.equal(h.controller().providerEditor.save.state, "unconfirmed");
    const exact = structuredClone(h.commands[0]);
    await settingsAction(() => h.controller().providerEditor.update("GEMINI_API_KEY", "synthetic-divergent"));
    const retained = h.controller().providerEditor.draft.GEMINI_API_KEY;
    assert.equal(retained?.kind === "set" && retained.raw, "synthetic-replacement");
    await settingsAction(() => h.controller().providerEditor.retry());
    assert.deepEqual(h.commands[1], exact);
    assert.equal(h.controller().providerEditor.save.state, "applied");
  });

  it("retains a stale draft across a typed source conflict and refreshes the saved revision", async () => {
    const h = await setup();
    await settingsAction(() => h.controller().providerEditor.update("GEMINI_API_KEY", "synthetic-retained"));
    const before = providerDocument(h);
    h.authority.execute(ProviderKeysCommandRequestSchema.parse({
      family: "settings", type: "apply-provider-keys", commandId: crypto.randomUUID(),
      requestedAt: h.authority.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
      target: { expectedRevision: before.revision, sourceVersionToken: before.sourceVersionToken },
      payload: { providerSchemaHash: before.providerSchemaHash, writeId: crypto.randomUUID(),
        operations: { MISTRAL_API_KEY: { set: "synthetic-competing" } } },
    }));
    await settingsAction(() => h.controller().providerEditor.submit());
    assert.equal(h.controller().providerEditor.save.state, "conflict");
    assert.deepEqual(h.controller().providerEditor.draft.GEMINI_API_KEY, { kind: "set", raw: "synthetic-retained" });
    assert.equal(providerDocument(h).revision, before.revision + 1);
    assert.equal(providerDocument(h).slots.MISTRAL_API_KEY, "synthetic-competing");
  });

  it("shows override and restart truthfully and removes an unsent blank without a write", async () => {
    const h = await setup({ parentSlots: { GEMINI_API_KEY: "synthetic-parent" } });
    assert.equal(providerDocument(h).restartRequired, false);
    assert.match(h.host.textContent ?? "", /Saved key is shadowed by the environment/u);
    await settingsAction(() => { assert.equal(h.controller().providerEditor.add("GEMINI_API_KEY"), "GEMINI_API_KEY2"); });
    await settingsAction(() => h.controller().providerEditor.remove("GEMINI_API_KEY2"));
    assert.equal(h.controller().providerEditor.dirtyCount, 0);
    assert.equal(h.commands.length, 0);
    await settingsAction(() => h.controller().providerEditor.update("GEMINI_API_KEY", "synthetic-replacement"));
    await settingsAction(() => h.controller().providerEditor.submit());
    assert.equal(providerDocument(h).restartRequired, false);
    assert.equal(providerDocument(h).slots.GEMINI_API_KEY, "synthetic-replacement");
    assert.equal(providerDocument(h).activeSlots.GEMINI_API_KEY, "synthetic-parent");
  });

  it("blocks provider editing when saved authority is unknown", async () => {
    const h = await setup();
    const document = h.authority.read();
    h.ports.read = () => ({ ...document, providerKeys: { state: "unknown", reason: "provider-store-unavailable" } });
    await settingsAction(() => h.controller().reload());
    assert.match(h.host.textContent ?? "", /Provider keys unavailable/u);
    assert.equal(h.controller().providerEditor.add("GEMINI_API_KEY"), undefined);
    assert.equal(h.commands.length, 0);
  });

  it("recovers a reopened pending write using only a value-free bound identity", async () => {
    let fail = true;
    const h = await setup({ afterRename: () => { if (fail) { fail = false; throw new Error("synthetic-sql-rollback"); } } });
    await settingsAction(() => h.controller().providerEditor.update("GEMINI_API_KEY", "synthetic-replacement"));
    await settingsAction(() => h.controller().providerEditor.submit());
    assert.equal(h.controller().providerEditor.save.state, "unconfirmed");
    const read = h.authority.read();
    assert.equal(read.providerKeys.state, "pending");
    const reopened = await mountSettingsHarness(h.authority, "credentials"); cleanups.push(reopened.close);
    await settingsAction(() => { void reopened.controller().providerEditor.retryPending(); });
    assert.equal(reopened.controller().providerEditor.save.state, "applied");
    const intent = ProviderKeysRetryIntentSchema.parse(reopened.commands[0]);
    assert.equal(JSON.stringify(intent).includes("synthetic-replacement"), false);
    const loaded = reopened.controller().editor;
    assert.equal(loaded.state === "loaded" && loaded.document.providerKeys.state, "available");
  });
});

for (const code of ["SCHEMA_INVALID", "REQUEST_IDENTITY_REFUSED", "UNEXPECTED_SERVER_ERROR"] as const) {
  it(`distinguishes provider admission ${code} from unknown delivery`, async () => {
    const h = await setup();
    h.ports.response = () => new Response(JSON.stringify({ state: "error", code, message: "refused", retryable: false }), { status: 400 });
    await settingsAction(() => h.controller().providerEditor.update("GEMINI_API_KEY", "synthetic-new-one"));
    await settingsAction(() => h.controller().providerEditor.submit());
    const editor = h.controller().providerEditor;
    const unknown = code === "UNEXPECTED_SERVER_ERROR";
    assert.equal(editor.save.state, unknown ? "unconfirmed" : "refused");
    assert.equal(editor.hasExactAttempt, unknown); assert.equal(editor.locked, unknown);
    assert.equal(editor.dirtyCount, 1);
  });
}
