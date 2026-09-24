// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { DateNav } from "../../../src/dashboard/surfaces/date-navigation.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { TooltipProvider } from "../../../src/dashboard/ds/ui.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { CalendarWireSchema } from "../../../src/domain/dashboard/calendar.js";
import { DayCountWireSchema } from "../../../src/domain/dashboard/projection.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("browses independently, retains a usable tab stop over gaps, recovers from empty months and restores the trigger", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const requests: string[] = [], picks: string[] = [];
  const counts = DayCountWireSchema.array().parse([{ day: "2026-01-02", count: 2 }, { day: "2026-01-05", count: 1 }]);
  const client = { async calendar({ month, day }) { requests.push(`${month}/${day}`); return CalendarWireSchema.parse({ month, day, today: "2026-01-10", authorityGeneration: 1,
    monthCounts: month === "2026-01" ? counts : [], firstDay: "2025-11-02", lastDay: "2026-01-05", previousDay: "2025-11-02", nextDay: "2026-01-05" }); } } as DashboardClient;
  const draw = async (day = "2026-01-02") => { await act(async () => root.render(createElement(DashboardClientProvider, { client,
    children: createElement(TooltipProvider, { children: createElement(DateNav, { day, today: "2026-01-10", monthCounts: counts,
      onDay: day => picks.push(day), onToday: () => picks.push("live") }) }) }))); };
  const button = (prefix: string) => { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.getAttribute("aria-label")?.startsWith(prefix) || b.textContent === prefix); assert.ok(found, prefix); return found; };
  const click = async (target: HTMLElement) => { await act(async () => target.click()); };
  try {
    await draw(); await click(button("Pick a day"));
    const cell = document.querySelector<HTMLButtonElement>('[data-demo-day="2026-01-02"]'); assert.ok(cell);
    await act(async () => { cell.focus(); cell.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); });
    assert.equal(document.activeElement?.getAttribute("data-demo-day"), "2026-01-03");
    assert.equal(document.activeElement?.getAttribute("aria-disabled"), "true");
    for (let step = 0; step < 2; step++) await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    assert.equal(document.activeElement?.getAttribute("data-demo-day"), "2026-01-05");
    assert.equal(document.querySelectorAll('[role="grid"] [tabindex="0"]').length, 1);
    await click(button("Previous month"));
    assert.ok(requests.includes("2025-12/2026-01-02")); assert.deepEqual(picks, []);
    assert.equal(document.querySelectorAll('[role="grid"] [tabindex="0"]').length, 1);
    await click(button("Previous month"));
    assert.equal(document.querySelectorAll('[role="grid"] [tabindex="0"][aria-disabled="true"]').length, 1);
    assert.equal(button("Today").disabled, false);
    await draw("2026-01-03");
    assert.ok(requests.includes("2025-11/2026-01-03"));
    await click(button("Today"));
    assert.deepEqual(picks, ["live"]);
    assert.equal(document.querySelector('[role="grid"]'), null);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.activeElement, button("Pick a day"));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
