// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ToastProvider } from "../../../../../src/dashboard/ds/ui.js";
import { RelayLoginRows, type ProfileLoginChangeResult, type RelayLogin } from "../../../../../src/dashboard/surfaces/settings/account/account-settings.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

const changed: ProfileLoginChangeResult = { state: "changed" };
function login(over: Partial<RelayLogin> = {}): RelayLogin {
  return { username: "jordan.lee@ucsd.edu", changePassword: async () => changed, changeUsername: async () => changed, ...over };
}
async function mount(value: RelayLogin): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(ToastProvider, { children: createElement(RelayLoginRows, { login: value }) })));
}
const button = (name: string): HTMLButtonElement => {
  const found = [...document.body.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === name || b.textContent === name);
  assert.ok(found, `button ${name}`);
  return found;
};
const field = (name: string): HTMLInputElement => {
  const found = document.body.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  assert.ok(found, `field ${name}`);
  return found;
};
async function type(name: string, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field(name), value);
    field(name).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = (name: string) => act(async () => button(name).click());
const rowText = () => host?.textContent ?? "";
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe("Settings > Account Relay login rows", () => {
  it("shows the username and a masked password, each with a pencil", async () => {
    await mount(login());
    assert.match(rowText(), /Username.*jordan\.lee@ucsd\.edu/u);
    assert.match(rowText(), /Password.*••••••••/u);
    button("Edit Relay username");
    button("Edit Relay password");
  });

  it("asks for the current and the new password, sends both, then closes the dialog", async () => {
    const sent: unknown[] = [];
    await mount(login({ changePassword: async request => { sent.push(request); return changed; } }));
    await click("Edit Relay password");
    await type("currentPassword", "old-secret");
    await type("newPassword", "new-secret");
    await click("Save");
    await settle();
    assert.deepEqual(sent, [{ currentPassword: "old-secret", newPassword: "new-secret" }]);
    assert.equal(document.body.querySelector("input[name=newPassword]"), null);
    assert.doesNotMatch(document.body.innerHTML, /old-secret|new-secret/u);
  });

  it("refuses a wrong current password with a toast and keeps the old username shown", async () => {
    await mount(login({ changeUsername: async () => ({ state: "refused", code: "PROFILE_CURRENT_PASSWORD_REFUSED" }) }));
    await click("Edit Relay username");
    await type("currentPassword", "wrong");
    await type("newUsername", "new.name@ucsd.edu");
    await click("Save");
    await settle();
    assert.match(document.body.textContent ?? "", new RegExp(ERROR_CATALOG.PROFILE_CURRENT_PASSWORD_REFUSED.text.slice(0, 30), "u"));
    assert.match(rowText(), /jordan\.lee@ucsd\.edu/u);
    assert.doesNotMatch(document.body.innerHTML, /wrong/u);
  });

  it("refuses a taken username with a toast and shows the new one only after a change", async () => {
    let result: ProfileLoginChangeResult = { state: "refused", code: "PROFILE_USERNAME_TAKEN" };
    await mount(login({ changeUsername: async () => result }));
    await click("Edit Relay username");
    await type("currentPassword", "pw");
    await type("newUsername", "taken@ucsd.edu");
    await click("Save");
    await settle();
    assert.match(document.body.textContent ?? "", new RegExp(ERROR_CATALOG.PROFILE_USERNAME_TAKEN.text.slice(0, 30), "u"));
    assert.doesNotMatch(rowText(), /taken@ucsd\.edu/u);
    result = changed;
    await click("Edit Relay username");
    await type("currentPassword", "pw");
    await type("newUsername", "free@ucsd.edu");
    await click("Save");
    await settle();
    assert.match(rowText(), /free@ucsd\.edu/u);
  });

  it("does not send a username the sign-in form would not accept", async () => {
    const sent: unknown[] = [];
    await mount(login({ changeUsername: async request => { sent.push(request); return changed; } }));
    await click("Edit Relay username");
    await type("currentPassword", "pw");
    await type("newUsername", "not-an-email");
    await click("Save");
    await settle();
    assert.deepEqual(sent, []);
    assert.match(document.body.textContent ?? "", /@ucsd\.edu/u);
  });

  it("reports an unconfirmed outcome as a warning and keeps the shown username", async () => {
    await mount(login({ changeUsername: async () => ({ state: "unknown", code: "PROFILE_LOGIN_CHANGE_UNKNOWN" }) }));
    await click("Edit Relay username");
    await type("currentPassword", "pw");
    await type("newUsername", "new.name@ucsd.edu");
    await click("Save");
    await settle();
    assert.match(document.body.textContent ?? "", new RegExp(ERROR_CATALOG.PROFILE_LOGIN_CHANGE_UNKNOWN.text.slice(0, 30), "u"));
    assert.doesNotMatch(rowText(), /new\.name@ucsd\.edu/u);
  });
});
