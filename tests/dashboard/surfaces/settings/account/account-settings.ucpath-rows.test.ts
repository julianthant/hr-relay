// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ToastProvider } from "../../../../../src/dashboard/ds/ui.js";
import { ProtectedPencilRow } from "../../../../../src/dashboard/surfaces/settings/providers/protected-pencil-row.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });

const SAVED_PASSWORD = "saved-placeholder-secret";
const calls: string[] = [];
type Draft = Partial<Record<"ucpathUserId" | "ucpathPassword", { kind: "set"; raw: string }>>;
function fakeEditor(draft: Draft = {}, failedNames: string[] = []): never {
  return {
    editor: { state: "loaded", document: { protectedSettings: { state: "available", rows: [{ name: "ucpathUserId", label: "UCPath user ID", purpose: "p" }, { name: "ucpathPassword", label: "UCPath password", purpose: "p" }],
      entries: { ucpathUserId: { value: "ucp-user", valueId: "a" }, ucpathPassword: { value: SAVED_PASSWORD, valueId: "b" } } } } },
    readProblem: undefined,
    protectedEditor: { locked: false, savingNames: [], failedNames, save: { state: "idle" }, draft, errors: {}, setExplicitSave: () => {}, reset: (name: string) => { calls.push(`reset ${name}`); }, submit: () => { calls.push("submit"); }, update: () => {}, clear: () => {} },
  } as never;
}
async function mount(name: "ucpathUserId" | "ucpathPassword", label: string, thing: string, draft: Draft = {}, failedNames: string[] = []): Promise<void> {
  calls.length = 0;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ToastProvider, { children: createElement(ProtectedPencilRow, { editor: fakeEditor(draft, failedNames), name, label, thing, description: "d" }) })));
}
const dialog = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[role="dialog"]');
const press = (name: string) => act(async () => { [...(dialog()?.querySelectorAll("button") ?? [])].find(item => item.textContent === name)?.click(); });
const save = (): HTMLButtonElement | undefined => [...(dialog()?.querySelectorAll("button") ?? [])].find(item => item.textContent === "Save");
const pencil = (label: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("Settings > Account UCPath rows", () => {
  it("reads Username and Password, each with a pencil named for UCPath", async () => {
    await mount("ucpathUserId", "Username", "UCPath username");
    assert.match(host?.textContent ?? "", /Usernameucp-user/u);
    assert.ok(pencil("Edit UCPath username"));
  });

  it("shows the typed username while a save waits, and the served one after it fails", async () => {
    await mount("ucpathUserId", "Username", "UCPath username", { ucpathUserId: { kind: "set", raw: "typed-user" } });
    assert.match(host?.textContent ?? "", /Usernametyped-user/u);
    act(() => root?.unmount()); host?.remove();
    await mount("ucpathUserId", "Username", "UCPath username", { ucpathUserId: { kind: "set", raw: "typed-user" } }, ["ucpathUserId"]);
    assert.match(host?.textContent ?? "", /Usernameucp-user/u);
  });

  it("opens Edit UCPath username with the saved username, Cancel and Save", async () => {
    await mount("ucpathUserId", "Username", "UCPath username");
    await act(async () => pencil("Edit UCPath username")?.click());
    assert.ok(dialog()?.textContent?.startsWith("Edit UCPath username"));
    assert.equal(dialog()?.querySelector<HTMLInputElement>("input")?.value, "ucp-user");
  });

  it("opens the UCPath password dialog empty and never holds the saved secret", async () => {
    await mount("ucpathPassword", "Password", "UCPath password");
    assert.doesNotMatch(document.body.innerHTML, new RegExp(SAVED_PASSWORD, "u"));
    await act(async () => pencil("Edit UCPath password")?.click());
    assert.ok(dialog()?.textContent?.startsWith("Edit UCPath password"));
    const field = dialog()?.querySelector<HTMLInputElement>("input");
    assert.equal(field?.value, "");
    assert.doesNotMatch(document.body.innerHTML, new RegExp(SAVED_PASSWORD, "u"));
  });

  for (const [why, name, label, thing, draft] of [
    ["nothing is typed", "ucpathPassword", "Password", "UCPath password", {}],
    ["the typed value is blank", "ucpathPassword", "Password", "UCPath password", { ucpathPassword: { kind: "set", raw: "   " } }],
    ["the typed username is the saved one", "ucpathUserId", "Username", "UCPath username", { ucpathUserId: { kind: "set", raw: " ucp-user " } }],
  ] as const) it(`keeps Save off and sends nothing while ${why}`, async () => {
    await mount(name, label, thing, draft);
    await act(async () => pencil(`Edit ${thing}`)?.click());
    assert.equal(save()?.disabled, true);
    await press("Save");
    assert.deepEqual(calls, []);
    assert.ok(dialog());
  });

  it("turns Save on for a changed username", async () => {
    await mount("ucpathUserId", "Username", "UCPath username", { ucpathUserId: { kind: "set", raw: "ucp-other" } });
    await act(async () => pencil("Edit UCPath username")?.click());
    assert.equal(save()?.disabled, false);
  });

  it("Save submits the draft and closes; Cancel resets it and returns focus to the pencil", async () => {
    await mount("ucpathPassword", "Password", "UCPath password", { ucpathPassword: { kind: "set", raw: "new-secret" } });
    await act(async () => pencil("Edit UCPath password")?.click());
    await press("Save");
    assert.deepEqual(calls, ["submit"]);
    assert.equal(dialog() === null, true);
    calls.length = 0;
    const trigger = pencil("Edit UCPath password");
    assert.ok(trigger);
    await act(async () => trigger.click());
    await press("Cancel");
    assert.deepEqual(calls, ["reset ucpathPassword"]);
    await vi.waitFor(() => assert.ok(document.activeElement === trigger, "Cancel restores focus to the UCPath password pencil"));
  });
});
