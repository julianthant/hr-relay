// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { AppearanceSettings } from "../../../../../src/dashboard/surfaces/settings/general/appearance-settings.js";
import { PersonPreferencesContext, type PersonPreferencesState } from "../../../../../src/dashboard/lib/person-preferences.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../../../src/models/config/person-preferences.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

it("names the current person only after confirmed preferences and preserves save failures", async () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  for (const state of ["ready", "saving", "loading", "failed", "uncertain", "signed-out"] as const) {
    const snapshot: PersonPreferencesState = { value: NEUTRAL_PERSON_PREFERENCES, state,
      ...(state === "uncertain" ? { problem: "Save outcome unknown. Do not retry." } : {}) };
    const port = { snapshot: () => snapshot, subscribe: () => () => {}, change: async () => false };
    await act(async () => root?.render(createElement(PersonPreferencesContext.Provider, { value: port,
      children: createElement(AppearanceSettings, { theme: "light", onToggleTheme() {}, personName: "Jordan Lee" }) })));
    assert.equal(host.textContent?.includes("Saved for Jordan Lee"), state === "ready");
    assert.equal(host.textContent?.includes("Your reduced-motion preference takes priority."), true);
    const controls = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    assert.equal(controls.length, 2);
    assert.ok(controls.every(control => control.disabled === (state !== "ready")));
    if (state === "uncertain") assert.match(host.textContent ?? "", /Save outcome unknown\. Do not retry\./u);
  }
  await act(async () => root?.render(createElement(AppearanceSettings, { theme: "light", onToggleTheme() {} })));
  assert.match(host.textContent ?? "", /Sign in to save appearance preferences\./u);
  assert.equal(host.textContent?.includes("Jordan Lee"), false);
});
