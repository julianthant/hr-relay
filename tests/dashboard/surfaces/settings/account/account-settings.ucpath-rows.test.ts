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
function fakeEditor(): never {
  return {
    editor: { state: "loaded", document: { protectedSettings: { state: "available", rows: [{ name: "ucpathUserId", label: "UCPath user ID", purpose: "p" }, { name: "ucpathPassword", label: "UCPath password", purpose: "p" }],
      entries: { ucpathUserId: { value: "ucp-user", valueId: "a" }, ucpathPassword: { value: SAVED_PASSWORD, valueId: "b" } } } } },
    readProblem: undefined,
    protectedEditor: { locked: false, draft: {}, errors: {}, setExplicitSave: () => {}, reset: (name: string) => { calls.push(`reset ${name}`); }, submit: () => { calls.push("submit"); }, update: () => {}, clear: () => {} },
  } as never;
}
async function mount(name: "ucpathUserId" | "ucpathPassword", label: string, thing: string): Promise<void> {
  calls.length = 0;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ToastProvider, { children: createElement(ProtectedPencilRow, { editor: fakeEditor(), name, label, thing, description: "d", onRemove: () => {} }) })));
}
const dialog = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[role="dialog"]');
const press = (name: string) => act(async () => { [...(dialog()?.querySelectorAll("button") ?? [])].find(item => item.textContent === name)?.click(); });
const pencil = (label: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("Settings > Account UCPath rows", () => {
  it("reads Username and Password, each with a pencil named for UCPath", async () => {
    await mount("ucpathUserId", "Username", "UCPath username");
    assert.match(host?.textContent ?? "", /Usernameucp-user/u);
    assert.ok(pencil("Edit UCPath username"));
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

  it("Save submits the draft and closes; Cancel resets it and returns focus to the pencil", async () => {
    await mount("ucpathPassword", "Password", "UCPath password");
    await act(async () => pencil("Edit UCPath password")?.click());
    await press("Save");
    assert.deepEqual(calls, ["submit"]);
    assert.equal(dialog(), null);
    calls.length = 0;
    await act(async () => pencil("Edit UCPath password")?.click());
    await press("Cancel");
    assert.deepEqual(calls, ["reset ucpathPassword"]);
    assert.equal(document.activeElement, pencil("Edit UCPath password"));
  });
});
