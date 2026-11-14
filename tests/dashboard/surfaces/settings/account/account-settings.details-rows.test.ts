// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ToastProvider } from "../../../../../src/dashboard/ds/ui.js";
import { AccountSettings, type AccountPage, type ProfileDetailsChangeRequest, type ProfileDetailsChangeResult } from "../../../../../src/dashboard/surfaces/settings/account/account-settings.js";
import { IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

const values = { name: "Jordan Lee", initials: "JL", timekeeper: "Casey Morgan Park", lastSignedInAt: IsoInstantSchema.parse("2026-11-01T10:00:00.000Z") };
const account = (over: Partial<typeof values> = {}) => ({ ...values, ...over });
function page(details: AccountPage["details"], shown: typeof values = values): AccountPage {
  return { values: shown, duo: "ready", onSignOut: () => {}, details,
    login: { changePassword: async () => ({ state: "changed" }), changeUsername: async () => ({ state: "changed" }) } };
}
const render = (value: AccountPage) => act(async () => root?.render(createElement(ToastProvider, { children: createElement(AccountSettings, { page: value, username: "jordan.lee@ucsd.edu", ucpath: null, deleteAccount: null }) })));
async function mount(details: AccountPage["details"]): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render(page(details));
}
const pencil = (label: string): HTMLButtonElement | null => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const input = (label: string): HTMLInputElement => {
  const found = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  assert.ok(found, `input ${label}`);
  return found;
};
const click = (label: string) => act(async () => { pencil(label)?.click(); });
async function typeInto(label: string, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input(label), value);
    input(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const key = (label: string, name: string) => act(async () => { input(label).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe("Settings > Account details rows", () => {
  it("gives Name, Initials and Timekeeper name a pencil and Timekeeper initials the timekeeper's letters without one", async () => {
    await mount(async () => ({ state: "changed", account: account() }));
    for (const label of ["Name", "Initials", "Timekeeper name"]) assert.ok(pencil(`Edit ${label}`), `pencil ${label}`);
    assert.equal(pencil("Edit Timekeeper initials"), null);
    assert.match(document.body.textContent ?? "", /Timekeeper initialsCMP/u);
    assert.match(document.body.textContent ?? "", /InitialsJL/u);
  });

  it("saves a new name as first and last name and shows the served account", async () => {
    const sent: ProfileDetailsChangeRequest[] = [];
    await mount(async request => { sent.push(request); return { state: "changed", account: account({ name: "Sam Rivera", initials: "SR" }) }; });
    await click("Edit Name");
    assert.equal(input("Name").value, "Jordan Lee");
    await typeInto("Name", "Sam Rivera");
    await key("Name", "Enter");
    await settle();
    assert.deepEqual(sent, [{ name: { firstName: "Sam", lastName: "Rivera" } }]);
    assert.equal(document.body.querySelector("input[aria-label=Name]"), null);
    assert.match(document.body.textContent ?? "", /NameSam Rivera/u);
    assert.match(document.body.textContent ?? "", /InitialsSR/u);
  });

  it("saves initials and the timekeeper name; the timekeeper letters follow the served name", async () => {
    const sent: ProfileDetailsChangeRequest[] = [];
    let served = account();
    await mount(async request => { sent.push(request); served = account({ ...served, ...(request.initials === undefined ? { timekeeper: request.timekeeperName ?? served.timekeeper } : { initials: request.initials }) }); return { state: "changed", account: served }; });
    await click("Edit Initials");
    await typeInto("Initials", "JXL");
    await key("Initials", "Enter");
    await settle();
    await click("Edit Timekeeper name");
    await typeInto("Timekeeper name", "Alex Kim");
    await key("Timekeeper name", "Enter");
    await settle();
    assert.deepEqual(sent, [{ initials: "JXL" }, { timekeeperName: "Alex Kim" }]);
    assert.match(document.body.textContent ?? "", /InitialsJXL/u);
    assert.match(document.body.textContent ?? "", /Timekeeper initialsAK/u);
  });

  it("shows the backend's reason as a toast and keeps the old value when a change is refused", async () => {
    await mount(async () => ({ state: "refused", code: "PROFILE_INITIALS_REFUSED" } satisfies ProfileDetailsChangeResult));
    await click("Edit Initials");
    await typeInto("Initials", "!!");
    await key("Initials", "Enter");
    await settle();
    assert.match(document.body.textContent ?? "", new RegExp(ERROR_CATALOG.PROFILE_INITIALS_REFUSED.text.slice(0, 30), "u"));
    assert.match(document.body.textContent ?? "", /InitialsJL/u);
    assert.equal(document.body.querySelector("input[aria-label=Initials]"), null);
  });

  it("treats a failed request as a refusal that keeps the old value", async () => {
    await mount(async () => { throw new Error("offline"); });
    await click("Edit Name");
    await typeInto("Name", "Sam Rivera");
    await key("Name", "Enter");
    await settle();
    assert.match(document.body.textContent ?? "", /NameJordan Lee/u);
    assert.match(document.body.textContent ?? "", /not changed/iu);
  });

  it("cancels on Escape without sending and returns focus to the pencil", async () => {
    const sent: unknown[] = [];
    await mount(async request => { sent.push(request); return { state: "changed", account: account() }; });
    await click("Edit Timekeeper name");
    await typeInto("Timekeeper name", "Someone Else");
    await key("Timekeeper name", "Escape");
    await settle();
    assert.deepEqual(sent, []);
    assert.equal(document.body.querySelector("input[aria-label='Timekeeper name']"), null);
    assert.match(document.body.textContent ?? "", /Timekeeper nameCasey Morgan Park/u);
    assert.equal(document.activeElement, pencil("Edit Timekeeper name"));
  });

  it("sends nothing when the value is unchanged", async () => {
    const sent: unknown[] = [];
    await mount(async request => { sent.push(request); return { state: "changed", account: account() }; });
    await click("Edit Initials");
    await key("Initials", "Enter");
    await settle();
    assert.deepEqual(sent, []);
  });

  it("focuses nothing on load", async () => {
    await mount(async () => ({ state: "changed", account: account() }));
    assert.equal(document.activeElement, document.body);
  });

  it("follows a refreshed served account and keeps a saved value across an unrelated re-render", async () => {
    const details: AccountPage["details"] = async () => ({ state: "changed", account: account({ initials: "ZZ" }) });
    await mount(details);
    await click("Edit Initials");
    await typeInto("Initials", "ZZ");
    await key("Initials", "Enter");
    await settle();
    await render({ ...page(details), values: { ...values } });
    assert.match(document.body.textContent ?? "", /InitialsZZ/u);
    await render(page(details, { ...values, name: "Pat Chen", initials: "PC" }));
    assert.match(document.body.textContent ?? "", /NamePat Chen/u);
    assert.match(document.body.textContent ?? "", /InitialsPC/u);
  });
});
