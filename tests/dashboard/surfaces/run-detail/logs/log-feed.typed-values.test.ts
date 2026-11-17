// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { TooltipProvider } from "../../../../../src/dashboard/ds/ui.js";
import { LogFeed } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed.js";
import type { LogStep } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(HTMLElement.prototype, "scrollTo", () => {});
Reflect.set(globalThis, "ResizeObserver", class { observe() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const steps: readonly LogStep[] = [{ id: "s1", time: "10:00:00", title: "Read CRM", entries: [
  { kind: "fields", id: "s1:typed", title: "Operator-entered values", fields: [
    { id: "a", time: "10:00:00", kind: "fill", label: "Process stage", value: "Onboarding complete", mark: "Typed by hand" },
    { id: "b", time: "10:00:00", kind: "fill", label: "First day of service", value: "10/06/2026", mark: "From the earlier run" }] },
  { kind: "note", id: "s1:n", time: "10:00:00", message: "Automatic reading replaced with operator-entered values." }] }];

describe("Logs value group marks", () => {
  it("writes each mark as text beside its value", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(TooltipProvider, null, createElement(LogFeed, { steps }))));
    const rows = [...document.querySelectorAll("[data-log-field]")];
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent ?? "", /Onboarding complete.*Typed by hand/u);
    assert.match(rows[1].textContent ?? "", /10\/06\/2026.*From the earlier run/u);
    assert.ok(document.body.textContent?.includes("Operator-entered values"));
  });
});
