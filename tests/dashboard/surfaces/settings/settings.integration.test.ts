// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import { ProtectedSettingsNameSchema } from "../../../../src/models/config/protected-settings.js";
import { ProtectedSettingsCommandRequestSchema,SettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { mountSettingsHarness,settingsAction,syntheticSettingsAuthority } from "../../../support/helpers/dashboard/settings-harness.js";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup() { const authority = await syntheticSettingsAuthority(); cleanups.push(authority.close); const mounted = await mountSettingsHarness(authority, "protected-store"); cleanups.push(mounted.close); return { ...mounted, authority }; }
function savedText(host: HTMLElement): string {
  const copy = host.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("input").forEach(input => input.remove());
  return copy.outerHTML;
}
describe("independent protected Settings surface", () => {
  it("validates and saves UCPath and roster credentials without exposing the password", async () => {
    const h = await setup(); const ordinary = h.authority.read();
    const before = h.authority.credentials.read();
    assert.equal(h.host.querySelectorAll('input[type="password"]').length, 1);
    assert.doesNotMatch(h.host.textContent ?? "", /SharePoint onboarding roster URL/u);
    const username = h.host.querySelector<HTMLInputElement>('input[name="ucpathUserId"]');
    const password = h.host.querySelector<HTMLInputElement>('input[name="ucpathPassword"]');
    assert.equal(username?.autocomplete, "section-ucpath username");
    assert.equal(password?.autocomplete, "section-ucpath new-password");
    assert.ok(password?.closest("form"));
    assert.ok([...h.host.querySelectorAll<HTMLInputElement>("input")].every(input => input.name));
    const values = { ucpathUserId: "synthetic-user-sentinel", ucpathPassword: "synthetic-password-sentinel", sharepointOnboardingRosterUrl: "https://example.test/synthetic-url-sentinel" };
    for (const name of ProtectedSettingsNameSchema.options) {
      await settingsAction(() => h.controller().protectedEditor.update(name, "")); assert.ok(h.controller().protectedEditor.errors[name]);
      await settingsAction(() => h.controller().protectedEditor.update(name, values[name])); assert.equal(h.controller().protectedEditor.errors[name], undefined);
    }
    assert.doesNotMatch(savedText(h.host), /synthetic-(?:password|url|sentinel)/u);
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(h.controller().protectedEditor.save.state, "applied"); assert.equal(h.controller().protectedEditor.dirtyCount, 0);
    assert.equal(h.authority.credentials.read().revision, before.revision + 1);
    assert.equal(h.authority.credentials.read().entries.sharepointOnboardingRosterUrl?.value, values.sharepointOnboardingRosterUrl);
    assert.equal(h.authority.credentials.read().entries.ucpathUserId?.value, values.ucpathUserId);
    assert.equal(h.authority.credentials.read().entries.ucpathPassword?.value, values.ucpathPassword);
    const after = h.authority.read(); assert.equal(after.revision, ordinary.revision); assert.deepEqual(after.sections, ordinary.sections);
    const request = ProtectedSettingsCommandRequestSchema.parse(h.commands[0]);
    const history = h.authority.database.authority.commands.getSettingsHistory(request.commandId);
    const audit = h.authority.database.authority.commandAudits.findSettingsHistory(request.commandId);
    assert.doesNotMatch(JSON.stringify({ history, audit }), /synthetic-(?:user|password|timekeeper|url|sentinel)/u);
    assert.doesNotMatch(savedText(h.host), /synthetic-password-sentinel/u);
    assert.doesNotMatch(h.host.textContent ?? "", /show password|reveal|restart required/iu);
    const cleared = h.authority.protectedApply({ ucpathUserId: { clear: true }, ucpathPassword: { clear: true } }, before.revision + 1);
    assert.equal(cleared.state, "applied");
    const saved = h.authority.credentials.read();
    assert.equal(saved.revision, before.revision + 2);
    assert.equal(saved.entries.ucpathUserId, undefined);
    assert.equal(saved.entries.ucpathPassword, undefined);
  });
  it("ordinary and credential drafts, revisions and outcomes are independent; Clear is explicit", async () => {
    const h = await setup(); const credentialRevision = h.authority.credentials.read().revision;
    await settingsAction(() => h.controller().update("actor.label", "Ordinary draft"));
    await settingsAction(() => h.controller().protectedEditor.update("sharepointOnboardingRosterUrl", "https://example.test/synthetic-separate-sentinel"));
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(h.controller().dirtyCount, 1); assert.equal(h.authority.read().revision, 1);
    await settingsAction(() => h.controller().protectedEditor.clear("sharepointOnboardingRosterUrl"));
    await settingsAction(() => h.controller().submit());
    assert.equal(h.controller().protectedEditor.dirtyCount, 1); assert.equal(h.authority.credentials.read().revision, credentialRevision + 1);
    await settingsAction(() => h.controller().protectedEditor.submit());
    const clear = ProtectedSettingsCommandRequestSchema.parse(h.commands[2]); assert.deepEqual(clear.payload.entries, { sharepointOnboardingRosterUrl: { clear: true } });
    assert.equal(h.authority.credentials.read().entries.sharepointOnboardingRosterUrl, undefined); assert.equal(h.authority.read().revision, 2);
    assert.equal(SettingsCommandRequestSchema.parse(h.commands[1]).target.expectedRevision, 1);
  });
  it("refreshes protected conflict presence while retaining the draft for deliberate resubmission", async () => {
    const h = await setup(); const credentialRevision = h.authority.credentials.read().revision;
    await settingsAction(() => h.controller().protectedEditor.update("sharepointOnboardingRosterUrl", "https://example.test/retained-secret-sentinel"));
    assert.equal(h.authority.protectedApply({ sharepointOnboardingRosterUrl: { set: "https://example.test/competing-name-sentinel" } }).state, "applied");
    const before = structuredClone(h.controller().protectedEditor.draft);
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(h.controller().protectedEditor.save.state, "conflict"); assert.deepEqual(h.controller().protectedEditor.draft, before); assert.equal(h.commands.length, 1);
    assert.doesNotMatch(h.host.textContent ?? "", /Credentials changed|Retry edit/u); // the model toasts the conflict once
    const current = h.controller().editor;
    assert.equal(current.state, "loaded");
    if (current.state !== "loaded" || current.document.protectedSettings.state !== "available") throw new Error("protected-conflict-readback-unavailable");
    assert.equal(current.document.protectedSettings.readback.revision, credentialRevision + 1);
    assert.equal(current.document.protectedSettings.entries.sharepointOnboardingRosterUrl?.value, "https://example.test/competing-name-sentinel");
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(ProtectedSettingsCommandRequestSchema.parse(h.commands[1]).target.expectedRevision, credentialRevision + 1);
    assert.equal(h.controller().protectedEditor.save.state, "applied");
  });
  for (const failure of ["lost-response", "failed-readback", "pending-reply", "intervening-writer", "foreign-result", "legacy-readback"] as const) {
    it(`reads the protected attempt back by itself, never resending it, and settles after ${failure}`, async () => {
      const h = await setup();
      h.ports.execute = input => {
        const result = h.authority.execute(input); const request = ProtectedSettingsCommandRequestSchema.parse(input);
        if (failure === "lost-response") throw new Error("raw-secret-server-sentinel");
        if (failure === "failed-readback") h.ports.read = () => { throw new Error("raw-secret-server-sentinel"); };
        if (failure === "pending-reply") return { state: "pending", commandId: request.commandId };
        if (failure === "intervening-writer") h.authority.protectedApply({ sharepointOnboardingRosterUrl: { set: "https://example.test/later-secret-sentinel" } });
        if (failure === "foreign-result") return { ...result, commandId: "00000000-0000-4000-8000-000000000099" };
        if (failure === "legacy-readback" && "entries" in result) return { ...result, entries: { ...result.entries, personLookupCanaryEid: { present: false }, separationsKualiFinalizationCanaryDocumentNumber: { present: false } } };
        return result;
      };
      await settingsAction(() => h.controller().protectedEditor.update("sharepointOnboardingRosterUrl", "https://example.test/draft-secret-sentinel"));
      await settingsAction(() => h.controller().protectedEditor.submit());
      // The transport recovers; the model reads the stored write back and settles it with no message.
      h.ports.read = h.authority.read; h.ports.execute = h.authority.execute;
      await vi.waitFor(async () => { await settingsAction(() => undefined); assert.equal(h.controller().protectedEditor.locked, false); }, { timeout: 5000, interval: 50 });
      assert.equal(h.controller().protectedEditor.save.state, "idle");
      assert.equal(h.controller().protectedEditor.dirtyCount, 0);
      assert.equal(h.commands.length, 1, "an unknown outcome is read back, never resent");
      // Another value served over this save is no proof that it landed, so it ends as one failure.
      if (failure === "intervening-writer") assert.deepEqual(h.problems.map(problem => problem.title), ["Credentials weren't saved"]);
      else assert.deepEqual(h.problems, [], "the stored write is found by the read-back");
      assert.deepEqual(h.notices, [], "a save found by reading back shows no message");
      assert.doesNotMatch(savedText(h.host), /raw-secret-server-sentinel|unconfirmed|Retry exact attempt/u);
      await settingsAction(() => h.controller().protectedEditor.update("sharepointOnboardingRosterUrl", "https://example.test/next-secret-sentinel"));
      await settingsAction(() => h.controller().protectedEditor.submit());
      assert.equal(h.commands.length, 2, "the read-back freed the lock: the next save reaches Relay");
    });
  }
  it("recovers definitive write-id reuse with new identity and the unchanged draft", async () => {
    const h = await setup(); const credentialRevision = h.authority.credentials.read().revision;
    h.ports.execute = input => ({ state: "rejected", commandId: ProtectedSettingsCommandRequestSchema.parse(input).commandId, code: "write-id-reused", message: "raw-secret-sentinel" });
    await settingsAction(() => h.controller().protectedEditor.update("sharepointOnboardingRosterUrl", "https://example.test/retained-value-sentinel")); await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(h.controller().protectedEditor.save.state, "refused"); assert.equal(h.authority.credentials.read().revision, credentialRevision);
    h.ports.execute = h.authority.execute;
    await settingsAction(() => h.controller().protectedEditor.submit());
    const first = ProtectedSettingsCommandRequestSchema.parse(h.commands[0]); const second = ProtectedSettingsCommandRequestSchema.parse(h.commands[1]);
    assert.notEqual(first.commandId, second.commandId); assert.notEqual(first.payload.writeId, second.payload.writeId); assert.deepEqual(first.payload.entries, second.payload.entries);
    assert.equal(h.controller().protectedEditor.save.state, "applied");
    assert.equal(h.authority.credentials.read().revision, credentialRevision + 1);
  });
  it("distinguishes a typed request refusal before effect from an unknown transport failure", async () => {
    const h = await setup(); const credentialRevision = h.authority.credentials.read().revision;
    h.ports.response = () => new Response(JSON.stringify({ state: "error", code: "OPERATOR_MUTATION_ORIGIN_REFUSED", message: "raw-secret-sentinel", retryable: false }), { status: 403 });
    await settingsAction(() => h.controller().protectedEditor.update("sharepointOnboardingRosterUrl", "https://example.test/retained-secret-sentinel"));
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(h.controller().protectedEditor.save.state, "refused");
    assert.equal(h.authority.credentials.read().revision, credentialRevision);
    assert.equal(h.controller().protectedEditor.dirtyCount, 1);
    assert.doesNotMatch(savedText(h.host), /secret-sentinel/u);
    h.ports.response = () => undefined;
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(h.controller().protectedEditor.save.state, "applied");
    assert.equal(h.authority.credentials.read().revision, credentialRevision + 1);
  });
  it("keeps unavailable store as unknown with disabled inputs, never as missing", async () => {
    const h = await setup(); const document = h.authority.read();
    document.protectedSettings = { state: "unknown", rows: document.protectedSettings.rows, reason: "credential-store-unavailable" };
    h.ports.read = () => document; await settingsAction(() => h.controller().reload());
    assert.match(h.host.textContent ?? "", /Credentials unavailable/u);
    assert.ok([...h.host.querySelectorAll<HTMLInputElement>("input")].every(input => input.disabled));
    assert.doesNotMatch(h.host.textContent ?? "", /Missing/u);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SettingsSaveState } from "../../../../src/dashboard/surfaces/settings/editor/settings-attempt-model.js";
import { SettingsSaveFeedback } from "../../../../src/dashboard/surfaces/settings/editor/settings-feedback.js";
it.each([
  [{ state: "conflict", message: "Current revision changed" }, ""],
  [{ state: "refused", message: "Draft refused" }, ""],
  [{ state: "applied", replayed: false }, "Saved"],
  [{ state: "applied", replayed: true }, "Already saved"],
] satisfies [SettingsSaveState, string][])("shows only a landed save inline for %j, never a button", (save, text) => {
  const html = renderToStaticMarkup(createElement(SettingsSaveFeedback, { save }));
  assert.equal(html.includes(text || "Credentials"), text !== "");
  assert.equal(html.includes("<button"), false);
});

it("retains applied feedback until the next draft changes its state", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SettingsSaveFeedback, {
      save: { state: "applied", replayed: true },
    })));
    assert.match(host.textContent ?? "", /Already saved/u);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    assert.match(host.textContent ?? "", /Already saved/u);
    await act(async () => root.render(createElement(SettingsSaveFeedback, { save: { state: "idle" } })));
    assert.equal(host.textContent, "");
    assert.doesNotMatch(host.textContent ?? "", /Already saved/u);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});

import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { SettingsPage } from "../../../../src/dashboard/surfaces/settings/settings.js";

describe("closing Settings", () => {
  it("closes on the X button and on Escape unless a dialog or list has the key", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const closed = vi.fn();
    try {
      await act(async () => root.render(createElement(DashboardClientProvider, {
        client: {} as DashboardClient,
        children: createElement(SettingsPage, { profileName: "Synthetic Operator", onClose: closed, section: "budgets", actorId: "local-operator", descriptorFingerprint: "a".repeat(64), onSection: () => undefined }),
      })));
      const exit = host.querySelector<HTMLButtonElement>('button[aria-label="Close settings"]');
      assert.ok(exit);
      assert.ok(exit.querySelector("svg.lucide-x"));
      const dialog = document.body.appendChild(document.createElement("div"));
      dialog.setAttribute("role", "dialog");
      const inner = dialog.appendChild(document.createElement("button"));
      await act(async () => { inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      assert.equal(closed.mock.calls.length, 0);
      dialog.remove();
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      assert.equal(closed.mock.calls.length, 1);
      await act(async () => { exit.click(); });
      assert.equal(closed.mock.calls.length, 2);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
