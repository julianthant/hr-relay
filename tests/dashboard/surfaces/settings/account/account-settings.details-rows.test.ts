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

const values = { name: "Jordan Lee", initials: "JL", timekeeper: "Casey Morgan Park", timekeeperInitials: "CMP", lastSignedInAt: IsoInstantSchema.parse("2026-11-01T10:00:00.000Z") };
const account = (over: Partial<typeof values> = {}) => ({ ...values, ...over });
function page(details: AccountPage["details"], shown: typeof values = values, readAccount?: AccountPage["readAccount"]): AccountPage {
  return { values: shown, details, ...(readAccount === undefined ? {} : { readAccount }),
    login: { changePassword: async () => ({ state: "changed" }), changeUsername: async () => ({ state: "changed" }) } };
}
const render = (value: AccountPage) => act(async () => root?.render(createElement(ToastProvider, { children: createElement(AccountSettings, { page: value, username: "jordan.lee@ucsd.edu", ucpath: null, deleteAccount: null }) })));
async function mount(details: AccountPage["details"], readAccount?: AccountPage["readAccount"]): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render(page(details, values, readAccount));
}
const pencil = (label: string): HTMLButtonElement | null => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const dialog = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[role="dialog"]');
const input = (label: string): HTMLInputElement => {
  const found = dialog()?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  assert.ok(found, `input ${label}`);
  return found;
};
const dialogButton = (name: string): HTMLButtonElement => {
  const found = [...(dialog()?.querySelectorAll("button") ?? [])].find(item => item.textContent === name);
  assert.ok(found, `dialog button ${name}`);
  return found;
};
const click = (label: string) => act(async () => { pencil(label)?.click(); });
const press = (name: string) => act(async () => { dialogButton(name).click(); });
async function typeInto(label: string, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input(label), value);
    input(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const escape = () => act(async () => { dialog()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const text = () => document.body.textContent ?? "";

const FIELDS = [
  { row: "Name", pencil: "Edit name", title: "Edit name", value: "Jordan Lee" },
  { row: "Initials", pencil: "Edit initials", title: "Edit initials", value: "JL" },
  { row: "Timekeeper name", pencil: "Edit timekeeper name", title: "Edit timekeeper name", value: "Casey Morgan Park" },
  { row: "Timekeeper initials", pencil: "Edit timekeeper initials", title: "Edit timekeeper initials", value: "CMP" },
] as const;

describe("Settings > Account details rows", () => {
  for (const field of FIELDS) it(`${field.pencil} opens the ${field.title} dialog with the served value, Cancel and Save, and no inline field`, async () => {
    await mount(async () => ({ state: "changed", account: account() }));
    assert.equal(document.body.querySelector("input"), null);
    await click(field.pencil);
    assert.ok(dialog()?.textContent?.startsWith(field.title), field.title);
    assert.equal(input(field.row).value, field.value);
    dialogButton("Cancel");
    dialogButton("Save");
  });

  it("saves a new name as first and last name, closes the dialog and shows the served account", async () => {
    const sent: ProfileDetailsChangeRequest[] = [];
    await mount(async request => { sent.push(request); return { state: "changed", account: account({ name: "Sam Rivera", initials: "SR" }) }; });
    await click("Edit name");
    await typeInto("Name", "Sam Rivera");
    await press("Save");
    await settle();
    assert.deepEqual(sent, [{ name: { firstName: "Sam", lastName: "Rivera" } }]);
    assert.equal(dialog(), null);
    assert.match(text(), /NameSam Rivera/u);
    assert.match(text(), /InitialsSR/u);
  });

  it("saves initials, timekeeper name and timekeeper initials with the writes the inline edit sent", async () => {
    const sent: ProfileDetailsChangeRequest[] = [];
    await mount(async request => { sent.push(request); return { state: "changed", account: account() }; });
    for (const [pencilLabel, row, value] of [["Edit initials", "Initials", "JXL"], ["Edit timekeeper name", "Timekeeper name", "Alex Kim"], ["Edit timekeeper initials", "Timekeeper initials", "CP"]] as const) {
      await click(pencilLabel);
      await typeInto(row, value);
      await press("Save");
      await settle();
    }
    assert.deepEqual(sent, [{ initials: "JXL" }, { timekeeperName: "Alex Kim" }, { timekeeperInitials: "CP" }]);
  });

  it("keeps Save off while the field is empty and sends nothing for an unchanged value", async () => {
    const sent: unknown[] = [];
    await mount(async request => { sent.push(request); return { state: "changed", account: account() }; });
    await click("Edit initials");
    await typeInto("Initials", "  ");
    assert.equal(dialogButton("Save").disabled, true);
    await typeInto("Initials", "JL");
    await press("Save");
    await settle();
    assert.deepEqual(sent, []);
    assert.equal(dialog(), null);
  });

  for (const field of FIELDS.filter(item => item.row.includes("nitials"))) it(`keeps the ${field.row} dialog open with the typed value and the reason under the field when a change is refused`, async () => {
    await mount(async () => ({ state: "refused", code: "PROFILE_INITIALS_REFUSED" } satisfies ProfileDetailsChangeResult));
    await click(field.pencil);
    await typeInto(field.row, "!!");
    await press("Save");
    await settle();
    assert.ok(dialog(), "dialog stays open");
    assert.equal(input(field.row).value, "!!");
    assert.equal(dialog()?.querySelector('[role="alert"]')?.textContent, ERROR_CATALOG.PROFILE_INITIALS_REFUSED.text);
    assert.equal(dialogButton("Save").disabled, false);
    await typeInto(field.row, "AB");
    assert.equal(dialog()?.querySelector('[role="alert"]'), null);
  });

  it("closes the dialog once a retried value is saved", async () => {
    let result: ProfileDetailsChangeResult = { state: "refused", code: "PROFILE_INITIALS_REFUSED" };
    await mount(async () => result);
    await click("Edit initials");
    await typeInto("Initials", "!!");
    await press("Save");
    await settle();
    result = { state: "changed", account: account({ initials: "AB" }) };
    await typeInto("Initials", "AB");
    await press("Save");
    await settle();
    assert.equal(dialog(), null);
    assert.match(text(), /InitialsAB/u);
  });

  it("reads a lost reply back and shows the saved name with no message", async () => {
    const reads: string[] = [];
    await mount(async () => { throw new Error("offline"); }, async () => { reads.push("read"); return account({ name: "Sam Rivera" }); });
    await click("Edit name");
    await typeInto("Name", "Sam Rivera");
    await press("Save");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.equal(reads.length, 1);
    assert.equal(dialog(), null);
    assert.match(text(), /NameSam Rivera/u);
    assert.doesNotMatch(text(), /not saved|not confirmed/u);
  });

  it("reads a lost reply back and keeps the old name with one failure toast when the change did not land", async () => {
    await mount(async () => { throw new Error("offline"); }, async () => account());
    await click("Edit name");
    await typeInto("Name", "Sam Rivera");
    await press("Save");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2700)); });
    assert.match(text(), /NameJordan Lee/u);
    assert.equal(text().match(/Name not saved/gu)?.length, 1);
    assert.doesNotMatch(text(), new RegExp(ERROR_CATALOG.COMMAND_OUTCOME_UNCERTAIN.text.slice(0, 30), "u"));
  });

  for (const how of ["Cancel", "Escape"] as const) it(`${how} sends no write and returns focus to the pencil`, async () => {
    const sent: unknown[] = [];
    await mount(async request => { sent.push(request); return { state: "changed", account: account() }; });
    await click("Edit timekeeper name");
    await typeInto("Timekeeper name", "Someone Else");
    if (how === "Cancel") await press("Cancel"); else await escape();
    await settle();
    assert.deepEqual(sent, []);
    assert.equal(dialog(), null);
    assert.match(text(), /Timekeeper nameCasey Morgan Park/u);
    assert.equal(document.activeElement, pencil("Edit timekeeper name"));
  });
});
