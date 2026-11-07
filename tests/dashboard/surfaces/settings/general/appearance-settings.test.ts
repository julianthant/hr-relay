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

it("keeps appearance rows description-free and preserves availability and save failures", async () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  for (const state of ["ready", "saving", "loading", "failed", "uncertain", "signed-out"] as const) {
    const snapshot: PersonPreferencesState = { value: NEUTRAL_PERSON_PREFERENCES, state,
      ...(state === "uncertain" ? { problem: "Save outcome unknown. Do not retry." } : {}) };
    const port = { snapshot: () => snapshot, subscribe: () => () => {}, change: async () => false };
    await act(async () => root?.render(createElement(PersonPreferencesContext.Provider, { value: port,
      children: createElement(AppearanceSettings, { theme: "light", onToggleTheme() {} }) })));
    assert.doesNotMatch(host.textContent ?? "", /Saved for|Dark theme|reduced-motion preference/u);
    assert.equal(host.querySelectorAll(".ds-field-description,.hub-row-note").length, 0);
    const theme = host.querySelector<HTMLButtonElement>('button[aria-label="Switch to dark theme"]');
    assert.ok(theme);
    assert.equal(theme.textContent, "Light");
    assert.equal(theme.disabled, state !== "ready");
    const controls = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    assert.equal(controls.length, 1);
    assert.equal(controls[0]?.closest(".ds-switch-row")?.textContent, "Animations");
    assert.ok(controls.every(control => control.disabled === (state !== "ready")));
    if (state === "uncertain") assert.match(host.textContent ?? "", /Save outcome unknown\. Do not retry\./u);
  }
  await act(async () => root?.render(createElement(AppearanceSettings, { theme: "light", onToggleTheme() {} })));
  assert.match(host.textContent ?? "", /Sign in to save appearance preferences\./u);
});

it("toggles from either theme through the supplied preference callback", async () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const snapshot = { value: NEUTRAL_PERSON_PREFERENCES, state: "ready" as const };
  const port = { snapshot: () => snapshot, subscribe: () => () => {}, change: async () => false };
  for (const theme of ["light", "dark"] as const) {
    let toggles = 0;
    await act(async () => root?.render(createElement(PersonPreferencesContext.Provider, { value: port,
      children: createElement(AppearanceSettings, { theme, onToggleTheme() { toggles++; } }) })));
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Switch to ${theme === "light" ? "dark" : "light"} theme"]`);
    assert.ok(button);
    assert.equal(button.textContent, theme === "light" ? "Light" : "Dark");
    await act(async () => button.click());
    assert.equal(toggles, 1);
  }
});
