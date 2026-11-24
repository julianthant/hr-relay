// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ToastProvider } from "../../../../../src/dashboard/ds/ui.js";
import { AccountSettings, RelayLoginRows, type ProfileLoginChangeResult, type RelayLogin } from "../../../../../src/dashboard/surfaces/settings/account/account-settings.js";
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
    button("Edit username");
    button("Change Relay password");
  });

  it("asks for the current and the new password, sends both, then closes the dialog", async () => {
    const sent: unknown[] = [];
    await mount(login({ changePassword: async request => { sent.push(request); return changed; } }));
    await click("Change Relay password");
    await type("currentPassword", "old-secret");
    await type("newPassword", "new-secret");
    await type("confirmPassword", "new-secret");
    await click("Save");
    await settle();
    assert.deepEqual(sent, [{ currentPassword: "old-secret", newPassword: "new-secret" }]);
    assert.equal(document.body.querySelector("input[name=newPassword]") === null, true);
    assert.doesNotMatch(document.body.innerHTML, /old-secret|new-secret/u);
  });

  it("opens Change password with Current, New and Confirm fields, Save off while empty, and the mismatch line", async () => {
    const sent: unknown[] = [];
    await mount(login({ changePassword: async request => { sent.push(request); return changed; } }));
    const trigger = button("Change Relay password");
    await act(async () => trigger.click());
    const dialogText = (): string => document.body.querySelector('[role="dialog"]')?.textContent ?? "";
    assert.ok(dialogText().startsWith("Change password"));
    for (const [name, control] of [["Current password", "currentPassword"], ["New password", "newPassword"], ["Confirm new password", "confirmPassword"]] as const) {
      const label = [...document.body.querySelectorAll('[role="dialog"] label')].find(item => item.textContent === name);
      assert.equal((label as HTMLLabelElement | undefined)?.htmlFor, field(control).id, `visible label ${name}`);
    }
    assert.equal(document.body.querySelector("input[placeholder]") === null, true);
    assert.equal(button("Save").disabled, true);
    await type("currentPassword", "old-secret");
    await type("newPassword", "new-secret");
    assert.equal(button("Save").disabled, true);
    await type("confirmPassword", "other");
    assert.match(dialogText(), /The passwords don’t match\./u);
    assert.ok(document.body.querySelector('[role="dialog"] [role="alert"]'));
    assert.equal(button("Save").disabled, true);
    await type("confirmPassword", "new-secret");
    assert.doesNotMatch(dialogText(), /don’t match/u);
    assert.equal(button("Save").disabled, false);
    await click("Cancel");
    assert.deepEqual(sent, []);
    await vi.waitFor(() => assert.ok(document.activeElement === trigger, "Cancel restores focus to the Relay password pencil"));
  });

  it("opens the username dialog titled Edit username with Cancel and Save", async () => {
    await mount(login());
    await click("Edit username");
    assert.ok((document.body.querySelector('[role="dialog"]')?.textContent ?? "").startsWith("Edit username"));
    assert.equal(button("Save").disabled, true);
    button("Cancel");
  });

  it("refuses a wrong current password with a toast and keeps the old username shown", async () => {
    await mount(login({ changeUsername: async () => ({ state: "refused", code: "PROFILE_CURRENT_PASSWORD_REFUSED" }) }));
    await click("Edit username");
    await type("currentPassword", "wrong");
    await type("newUsername", "new.name@ucsd.edu");
    await click("Save");
    await settle();
    assert.match(document.body.textContent ?? "", new RegExp(ERROR_CATALOG.PROFILE_CURRENT_PASSWORD_REFUSED.text.slice(0, 30), "u"));
    assert.match(rowText(), /jordan\.lee@ucsd\.edu/u);
    assert.equal(field("currentPassword").value, "wrong");
    await click("Cancel");
    assert.doesNotMatch(document.body.innerHTML, /wrong/u);
  });

  it("refuses a taken username with a toast and shows the new one only after a change", async () => {
    let result: ProfileLoginChangeResult = { state: "refused", code: "PROFILE_USERNAME_TAKEN" };
    await mount(login({ changeUsername: async () => result }));
    await click("Edit username");
    await type("currentPassword", "pw");
    await type("newUsername", "taken@ucsd.edu");
    await click("Save");
    await settle();
    assert.match(document.body.textContent ?? "", new RegExp(ERROR_CATALOG.PROFILE_USERNAME_TAKEN.text.slice(0, 30), "u"));
    assert.doesNotMatch(rowText(), /taken@ucsd\.edu/u);
    assert.ok(document.body.querySelector("input[name=newUsername]"), "dialog stays open");
    result = changed;
    await type("newUsername", "free@ucsd.edu");
    await click("Save");
    await settle();
    assert.match(rowText(), /free@ucsd\.edu/u);
  });

  it("does not send a username the sign-in form would not accept", async () => {
    const sent: unknown[] = [];
    await mount(login({ changeUsername: async request => { sent.push(request); return changed; } }));
    await click("Edit username");
    await type("currentPassword", "pw");
    await type("newUsername", "not-an-email");
    await click("Save");
    await settle();
    assert.deepEqual(sent, []);
    assert.match(document.body.textContent ?? "", /@ucsd\.edu/u);
  });

  it("ends an unconfirmed username change it cannot read back in one short toast and keeps the shown username", async () => {
    await mount(login({ changeUsername: async () => ({ state: "unknown", code: "PROFILE_LOGIN_CHANGE_UNKNOWN" }) }));
    await click("Edit username");
    await type("currentPassword", "pw");
    await type("newUsername", "new.name@ucsd.edu");
    await click("Save");
    await settle();
    assert.match(document.body.textContent ?? "", /Relay username change not confirmed/u);
    assert.doesNotMatch(document.body.textContent ?? "", new RegExp(ERROR_CATALOG.PROFILE_LOGIN_CHANGE_UNKNOWN.text.slice(0, 30), "u"));
    assert.doesNotMatch(rowText(), /new\.name@ucsd\.edu/u);
  });

  it("ends a lost password reply in one short toast with no instructions and closes the dialog", async () => {
    await mount(login({ changePassword: async () => { throw new Error("reply lost"); } }));
    await click("Change Relay password");
    await type("currentPassword", "pw");
    await type("newPassword", "next-password-1");
    await type("confirmPassword", "next-password-1");
    await click("Save");
    await settle();
    assert.match(document.body.textContent ?? "", /Relay password change not confirmed/u);
    assert.doesNotMatch(document.body.textContent ?? "", /could not confirm|Try your new/iu);
    assert.equal(document.body.querySelector('[role="dialog"]') === null, true);
  });

  it("reads a lost username reply back and shows the new username with no message when it landed", async () => {
    let served = "jordan.lee@ucsd.edu";
    await mount(login({ changeUsername: async request => { served = request.newUsername; throw new Error("reply lost"); }, readUsername: async () => served }));
    await click("Edit username");
    await type("currentPassword", "pw");
    await type("newUsername", "new.name@ucsd.edu");
    await click("Save");
    await vi.waitFor(async () => { await settle(); assert.match(rowText(), /new\.name@ucsd\.edu/u); });
    assert.equal(document.body.querySelector('[role="dialog"]') === null, true);
    assert.doesNotMatch(document.body.textContent ?? "", /not changed|could not confirm/iu);
  });

  it("reads a lost username reply back and keeps the old username with one failure toast when it did not land", async () => {
    await mount(login({ changeUsername: async () => { throw new Error("request dropped"); }, readUsername: async () => "jordan.lee@ucsd.edu" }));
    await click("Edit username");
    await type("currentPassword", "pw");
    await type("newUsername", "new.name@ucsd.edu");
    await click("Save");
    await vi.waitFor(async () => { await settle(); assert.match(document.body.textContent ?? "", /Relay username not changed/u); }, { timeout: 5000, interval: 50 });
    assert.match(rowText(), /jordan\.lee@ucsd\.edu/u);
    assert.doesNotMatch(document.body.textContent ?? "", /could not confirm/iu);
  });

  it("keeps the password dialog open with its values when the current password is refused", async () => {
    await mount(login({ changePassword: async () => ({ state: "refused", code: "PROFILE_CURRENT_PASSWORD_REFUSED" }) }));
    await click("Change Relay password");
    await type("currentPassword", "wrong");
    await type("newPassword", "new-secret");
    await type("confirmPassword", "new-secret");
    await click("Save");
    await settle();
    assert.equal(field("newPassword").value, "new-secret");
    assert.equal(document.body.querySelector('[role="dialog"] [role="alert"]')?.textContent, ERROR_CATALOG.PROFILE_CURRENT_PASSWORD_REFUSED.text);
  });

  it("shows a missing username as shown after the next sign-in, with the pencil on", async () => {
    await mount(login({ username: undefined }));
    assert.match(rowText(), /Shown after your next sign-in/u);
    assert.equal(button("Edit username").disabled, false);
    assert.equal(button("Change Relay password").disabled, false);
  });

  it("ends a username change whose read-back is absent as not confirmed, not as not changed", async () => {
    await mount(login({ changeUsername: async () => { throw new Error("reply lost"); }, readUsername: async () => undefined }));
    await click("Edit username");
    await type("currentPassword", "pw");
    await type("newUsername", "new.name@ucsd.edu");
    await click("Save");
    await vi.waitFor(async () => { await settle(); assert.match(document.body.textContent ?? "", /Relay username change not confirmed/u); }, { timeout: 5000, interval: 50 });
    assert.doesNotMatch(document.body.textContent ?? "", /Relay username not changed/u);
  });

  it("shows the served username on the Account page when it opens, so a changed username survives leaving and returning", async () => {
    const values = { name: "Jordan Lee", initials: "JL", timekeeper: "Jordan Lee", timekeeperInitials: "JL", lastSignedInAt: "2026-09-13T12:00:00.000Z", username: "old.name@ucsd.edu" };
    const page = { values, details: async () => ({ state: "refused", code: "PROFILE_INITIALS_REFUSED" }) as never, readAccount: async () => ({ ...values, username: "new.name@ucsd.edu" }), login: { changePassword: async () => changed, changeUsername: async () => changed } };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(ToastProvider, { children: createElement(AccountSettings, { page, username: values.username, ucpath: null, deleteAccount: null }) })));
    await settle();
    assert.match(rowText(), /Username.*new\.name@ucsd\.edu/u);
    assert.doesNotMatch(rowText(), /old\.name@ucsd\.edu/u);
  });
});
