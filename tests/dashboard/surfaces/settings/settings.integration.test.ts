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
  it("edits the protected onboarding roster under SharePoint routes and preserves its authority", async () => {
    const h = await setup();
    await h.render("routes");
    const sharepoint = h.host.querySelector('[data-settings-path="urls.sharepoint.prod"]');
    assert.ok(sharepoint);
    const label = [...h.host.querySelectorAll<HTMLLabelElement>("label")].find(node => node.textContent === "SharePoint onboarding roster URL");
    assert.ok(label);
    const input = h.host.querySelector<HTMLInputElement>(`[id="${label.htmlFor}"]`);
    assert.ok(input);
    assert.equal(input.type, "password");
    assert.equal(sharepoint.closest(".routes-page-system")?.querySelector("h2")?.textContent, "SharePoint2 URLs");
    const search = h.host.querySelector<HTMLInputElement>('input[type="search"]');
    assert.ok(search);
    await settingsAction(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter !== undefined) Reflect.apply(setter, search, ["roster"]);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.match(h.host.textContent ?? "", /SharePoint/u);
    assert.equal(h.host.querySelector('[data-settings-path="urls.crm.prod"]'), null);
    const url = "https://example.test/onboarding-roster.xlsx";
    await settingsAction(() => h.controller().protectedEditor.update("sharepointOnboardingRosterUrl", url));
    assert.equal(input.value, url);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
    const request = ProtectedSettingsCommandRequestSchema.parse(h.commands[0]);
    assert.deepEqual(request.payload.entries, { sharepointOnboardingRosterUrl: { set: url } });
    assert.equal(h.authority.read().revision, 1, "ordinary route authority is unchanged");
    const show = h.host.querySelector<HTMLButtonElement>('button[aria-label="Show SharePoint onboarding roster URL"]');
    assert.ok(show);
    await settingsAction(() => show.click());
    assert.equal(input.type, "text");
    await h.render("credentials");
    assert.doesNotMatch(h.host.textContent ?? "", /SharePoint onboarding roster URL/u);
  });
  it("starts empty, validates all five names, and shows saved values after save", async () => {
    const h = await setup(); const ordinary = h.authority.read();
    const before = h.authority.credentials.read();
    assert.equal(h.authority.protectedApply({
      ucpathUserId: { clear: true }, ucpathPassword: { clear: true }, timekeeperName: { clear: true },
    }, before.revision).state, "applied");
    await settingsAction(() => h.controller().reload());
    const emptied = h.authority.credentials.read();
    assert.equal(emptied.revision, before.revision + 1);
    assert.equal(emptied.entries.ucpathUserId, undefined);
    assert.equal(emptied.entries.ucpathPassword, undefined);
    assert.equal(emptied.entries.timekeeperName, undefined);
    assert.equal(h.host.querySelectorAll('input[type="password"]').length, 2);
    assert.doesNotMatch(h.host.textContent ?? "", /SharePoint onboarding roster URL/u);
    assert.ok([...h.host.querySelectorAll<HTMLInputElement>("input")].every(input => input.value === ""));
    const username = h.host.querySelector<HTMLInputElement>('input[name="ucpathUserId"]');
    const password = h.host.querySelector<HTMLInputElement>('input[name="ucpathPassword"]');
    assert.equal(username?.autocomplete, "section-ucpath username");
    assert.equal(password?.autocomplete, "section-ucpath new-password");
    assert.ok(password?.closest("form"));
    assert.ok([...h.host.querySelectorAll<HTMLInputElement>("input")].every(input => input.name));
    const values = { ucpathUserId: "synthetic-user-sentinel", ucpathPassword: "synthetic-password-sentinel", timekeeperName: "synthetic-timekeeper-sentinel", sharepointOnboardingRosterUrl: "https://example.test/synthetic-url-sentinel", activityPersonPseudonym: JSON.stringify({ keyHex: "a".repeat(64), keyGeneration: "activity-person-synthetic-sentinel" }) };
    for (const name of ProtectedSettingsNameSchema.options) {
      await settingsAction(() => h.controller().protectedEditor.update(name, "")); assert.ok(h.controller().protectedEditor.errors[name]);
      await settingsAction(() => h.controller().protectedEditor.update(name, values[name])); assert.equal(h.controller().protectedEditor.errors[name], undefined);
    }
    assert.doesNotMatch(savedText(h.host), /synthetic-(?:password|url|sentinel)/u);
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(h.controller().protectedEditor.save.state, "applied"); assert.equal(h.controller().protectedEditor.dirtyCount, 0);
    assert.equal(h.authority.credentials.read().revision, emptied.revision + 1);
    for (const [name, expected] of [["UCPath username", values.ucpathUserId], ["Timekeeper name", values.timekeeperName]] as const) {
      const label = [...h.host.querySelectorAll<HTMLLabelElement>("label")].find(node => node.textContent === name);
      assert.ok(label);
      const input = h.host.querySelector<HTMLInputElement>(`[id="${label.htmlFor}"]`);
      assert.equal(input?.type, "text");
      assert.equal(input.value, expected);
      assert.equal(h.host.querySelector(`button[aria-label="Show ${name}"]`), null);
    }
    assert.equal(h.host.querySelectorAll<HTMLInputElement>('input[type="password"]')[0]?.value, values.ucpathPassword);
    assert.equal(h.host.querySelectorAll<HTMLInputElement>('input[type="password"]').length, 2);
    const after = h.authority.read(); assert.equal(after.revision, ordinary.revision); assert.deepEqual(after.sections, ordinary.sections);
    assert.match(JSON.stringify(after), /synthetic-password-sentinel/u);
    const request = ProtectedSettingsCommandRequestSchema.parse(h.commands[0]);
    const history = h.authority.database.authority.commands.getSettingsHistory(request.commandId);
    const audit = h.authority.database.authority.commandAudits.findSettingsHistory(request.commandId);
    assert.doesNotMatch(JSON.stringify({ history, audit }), /synthetic-(?:user|password|timekeeper|url|sentinel)/u);
    assert.doesNotMatch(savedText(h.host), /synthetic-password-sentinel/u);
    assert.doesNotMatch(h.host.textContent ?? "", /show password|reveal|restart required/iu);
  });
  it("ordinary and credential drafts, revisions and outcomes are independent; Clear is explicit", async () => {
    const h = await setup(); const credentialRevision = h.authority.credentials.read().revision;
    await settingsAction(() => h.controller().update("actor.label", "Ordinary draft"));
    await settingsAction(() => h.controller().protectedEditor.update("ucpathPassword", "synthetic-separate-sentinel"));
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(h.controller().dirtyCount, 1); assert.equal(h.authority.read().revision, 1);
    await settingsAction(() => h.controller().protectedEditor.clear("ucpathPassword"));
    await settingsAction(() => h.controller().submit());
    assert.equal(h.controller().protectedEditor.dirtyCount, 1); assert.equal(h.authority.credentials.read().revision, credentialRevision + 1);
    await settingsAction(() => h.controller().protectedEditor.submit());
    const clear = ProtectedSettingsCommandRequestSchema.parse(h.commands[2]); assert.deepEqual(clear.payload.entries, { ucpathPassword: { clear: true } });
    assert.equal(h.authority.credentials.read().entries.ucpathPassword, undefined); assert.equal(h.authority.read().revision, 2);
    assert.equal(SettingsCommandRequestSchema.parse(h.commands[1]).target.expectedRevision, 1);
  });
  it("refreshes protected conflict presence while retaining the draft for deliberate resubmission", async () => {
    const h = await setup(); const credentialRevision = h.authority.credentials.read().revision;
    await settingsAction(() => h.controller().protectedEditor.update("ucpathPassword", "retained-secret-sentinel"));
    assert.equal(h.authority.protectedApply({ timekeeperName: { set: "competing-name-sentinel" } }).state, "applied");
    const before = structuredClone(h.controller().protectedEditor.draft);
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(h.controller().protectedEditor.save.state, "conflict"); assert.deepEqual(h.controller().protectedEditor.draft, before); assert.equal(h.commands.length, 1);
    assert.match(h.host.textContent ?? "", /The command conflicted with a newer state\. Refresh and review the current result\./u);
    const current = h.controller().editor;
    assert.equal(current.state, "loaded");
    if (current.state !== "loaded" || current.document.protectedSettings.state !== "available") throw new Error("protected-conflict-readback-unavailable");
    assert.equal(current.document.protectedSettings.readback.revision, credentialRevision + 1);
    assert.equal(current.document.protectedSettings.entries.timekeeperName?.value, "competing-name-sentinel");
    await settingsAction(() => h.controller().protectedEditor.submit());
    assert.equal(ProtectedSettingsCommandRequestSchema.parse(h.commands[1]).target.expectedRevision, credentialRevision + 1);
    assert.equal(h.controller().protectedEditor.save.state, "applied");
  });
  for (const failure of ["lost-response", "failed-readback", "failed-audit", "intervening-writer", "foreign-result", "legacy-readback"] as const) {
    it(`keeps exact protected attempt and truthful uncertainty for ${failure}`, async () => {
      const h = await setup();
      h.ports.execute = input => {
        const result = h.authority.execute(input); const request = ProtectedSettingsCommandRequestSchema.parse(input);
        if (failure === "lost-response") throw new Error("raw-secret-server-sentinel");
        if (failure === "failed-readback") h.ports.read = () => { throw new Error("raw-secret-server-sentinel"); };
        if (failure === "failed-audit") return { state: "rejected", commandId: request.commandId, code: "authority-unjournaled", message: "raw-secret-server-sentinel" };
        if (failure === "intervening-writer") h.authority.protectedApply({ ucpathPassword: { set: "later-secret-sentinel" } });
        if (failure === "foreign-result") return { ...result, commandId: "00000000-0000-4000-8000-000000000099" };
        if (failure === "legacy-readback" && "entries" in result) return { ...result, entries: { ...result.entries, personLookupCanaryEid: { present: false }, separationsKualiFinalizationCanaryDocumentNumber: { present: false } } };
        return result;
      };
      await settingsAction(() => h.controller().protectedEditor.update("ucpathPassword", "draft-secret-sentinel"));
      await settingsAction(() => h.controller().protectedEditor.submit());
      assert.equal(h.controller().protectedEditor.save.state, "unconfirmed"); assert.equal(h.controller().protectedEditor.dirtyCount, 1);
      assert.doesNotMatch(savedText(h.host), /raw-secret-server-sentinel/u);
      const exact = structuredClone(h.commands[0]);
      await settingsAction(() => h.controller().protectedEditor.update("ucpathPassword", "divergent-secret-sentinel"));
      assert.deepEqual(h.controller().protectedEditor.draft.ucpathPassword, { kind: "set", raw: "draft-secret-sentinel" });
      h.ports.read = h.authority.read; h.ports.execute = h.authority.execute;
      await settingsAction(() => h.controller().protectedEditor.retry());
      assert.deepEqual(h.commands[1], exact);
      assert.equal(h.controller().protectedEditor.save.state, failure === "intervening-writer" ? "conflict" : "applied");
    });
  }
  it("recovers definitive write-id reuse with new identity and the unchanged draft", async () => {
    const h = await setup(); const credentialRevision = h.authority.credentials.read().revision;
    h.ports.execute = input => ({ state: "rejected", commandId: ProtectedSettingsCommandRequestSchema.parse(input).commandId, code: "write-id-reused", message: "raw-secret-sentinel" });
    await settingsAction(() => h.controller().protectedEditor.update("ucpathPassword", "retained-value-sentinel")); await settingsAction(() => h.controller().protectedEditor.submit());
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
    await settingsAction(() => h.controller().protectedEditor.update("ucpathPassword", "retained-secret-sentinel"));
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
  [{ state: "conflict", message: "Current revision changed" }, "Credentials changed", false],
  [{ state: "unconfirmed", message: "Readback unavailable" }, "Credentials write unconfirmed", true],
  [{ state: "refused", message: "Draft refused" }, "Credentials were not applied", false],
  [{ state: "applied", replayed: false }, "Saved", false],
  [{ state: "applied", replayed: true }, "Already saved", false],
] satisfies [SettingsSaveState, string, boolean][])("preserves the feedback title and retry affordance for %j", (save, title, retry) => {
  const html = renderToStaticMarkup(createElement(SettingsSaveFeedback, { save, protectedStore: true, retry: () => {} }));
  assert.ok(html.includes(title));
  assert.equal(html.includes("Retry exact attempt"), retry);
});

it("retains applied feedback until the next draft changes its state", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SettingsSaveFeedback, {
      save: { state: "applied", replayed: true },
      protectedStore: true,
      retry: () => undefined,
    })));
    assert.match(host.textContent ?? "", /Already saved/u);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    assert.match(host.textContent ?? "", /Already saved/u);
    await act(async () => root.render(createElement(SettingsSaveFeedback, { save: { state: "idle" }, protectedStore: true, retry: () => undefined })));
    assert.equal(host.textContent, "");
    assert.doesNotMatch(host.textContent ?? "", /Already saved/u);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});
