// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ToastProvider } from "../../../../../src/dashboard/ds/ui.js";
import { AccountSettings, type AccountPage } from "../../../../../src/dashboard/surfaces/settings/account/account-settings.js";
import { IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

const values = { name: "Jordan Lee", initials: "JL", timekeeper: "Casey Morgan Park", timekeeperInitials: "CMP", lastSignedInAt: IsoInstantSchema.parse("2026-11-01T10:00:00.000Z") };
const key = { id: "a".repeat(64), name: "Relay Work Key", shortId: "aB12cd34", addedAt: "2026-11-01T10:00:00.000Z" };
async function mount(over: Partial<AccountPage>): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const page: AccountPage = { values, onDuoSetup: async () => undefined,
    duoKeys: { read: async () => ({ revision: 1, keys: [key] }), change: async () => { throw new Error("unexpected Duo key change"); } },
    details: async () => ({ state: "changed", account: values }),
    login: { changePassword: async () => ({ state: "changed" }), changeUsername: async () => ({ state: "changed" }) }, ...over };
  await act(async () => root?.render(createElement(ToastProvider, { children: createElement(AccountSettings, { page, username: "jordan.lee@ucsd.edu", ucpath: null, deleteAccount: null }) })));
}
const button = (name: string) => [...document.body.querySelectorAll("button")].find(item => item.textContent === name);

describe("Settings > Account Security group", () => {
  it("shows the served Duo state and Set up again", async () => {
    await mount({});
    assert.match(document.body.textContent ?? "", /DuoReadySet up again/u);
  });

  it("runs the served re-enrolment from Set up again", async () => {
    const calls: string[] = [];
    await mount({ onDuoSetup: async () => { calls.push("setup"); return undefined; } });
    await act(async () => { button("Set up again")?.click(); });
    assert.deepEqual(calls, ["setup"]);
  });

  it("shows a refusal as a failure with the backend's text and leaves the row as it was", async () => {
    await mount({ onDuoSetup: async () => "Duo setup is still open for this profile. Finish or cancel it." });
    await act(async () => { button("Set up again")?.click(); });
    assert.match(document.body.textContent ?? "", /Duo setup not opened/u);
    assert.match(document.body.textContent ?? "", /Duo setup is still open for this profile/u);
    assert.match(document.body.textContent ?? "", /DuoReadySet up again/u);
  });

  it("offers no Set up again where no served re-enrolment exists", async () => {
    await mount({ onDuoSetup: undefined });
    assert.equal(button("Set up again") === undefined, true);
  });

  it("names the key in confirmation and offers setup after the last key is removed", async () => {
    const change = vi.fn(async () => ({ state: "changed" as const, snapshot: { revision: 2, keys: [] } }));
    await mount({ duoKeys: { read: async () => ({ revision: 1, keys: [key] }), change } });
    assert.match(document.body.textContent ?? "", /Relay Work Key/u);
    const remove = button("Remove");
    assert.ok(remove);
    await act(async () => { remove.click(); });
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent ?? "", /Relay Work Key/u);
    assert.match(dialog.textContent ?? "", /stays registered in Duo/u);
    assert.equal(change.mock.calls.length, 0);

    const confirm = [...dialog.querySelectorAll("button")].find(item => item.textContent === "Remove");
    assert.ok(confirm);
    await act(async () => { confirm.click(); });
    assert.equal(change.mock.calls.length, 1);
    assert.match(document.body.textContent ?? "", /DuoSet up/u);
    assert.ok(button("Set up"));
    assert.doesNotMatch(document.body.textContent ?? "", /Relay Work Key/u);
  });
});
