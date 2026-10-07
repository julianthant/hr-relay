// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { DateNav } from "../../../../../src/dashboard/surfaces/date-navigation.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { TooltipProvider } from "../../../../../src/dashboard/ds/ui.js";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { CalendarWireSchema } from "../../../../../src/models/dashboard/calendar.js";
import { DayCountWireSchema } from "../../../../../src/models/dashboard/projection.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("browses independently and retains a usable tab stop across empty months", async () => {
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
    await draw();
    assert.match(button("Previous day").getAttribute("aria-label") ?? "", /Jan 1/);
    assert.match(button("Next day").getAttribute("aria-label") ?? "", /Jan 3/);
    await click(button("Next day"));
    assert.deepEqual(picks, ["2026-01-03"]);
    picks.length = 0;
    await click(button("Pick a day"));
    const cell = document.querySelector<HTMLButtonElement>('[data-demo-day="2026-01-02"]'); assert.ok(cell);
    await act(async () => { cell.focus(); cell.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); });
    assert.equal(document.activeElement?.getAttribute("data-demo-day"), "2026-01-03");
    assert.notEqual(document.activeElement?.getAttribute("aria-disabled"), "true");
    for (let step = 0; step < 2; step++) await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    assert.equal(document.activeElement?.getAttribute("data-demo-day"), "2026-01-05");
    assert.equal(document.querySelectorAll('[role="grid"] [tabindex="0"]').length, 1);
    await click(button("Previous month"));
    assert.ok(requests.includes("2025-12/2026-01-02")); assert.deepEqual(picks, []);
    assert.equal(document.querySelectorAll('[role="grid"] [tabindex="0"]').length, 1);
    await click(button("Previous month"));
    assert.equal(document.querySelectorAll('[role="grid"] [tabindex="0"][aria-disabled="true"]').length, 0);
    assert.equal([...document.querySelectorAll("button")].some(button => button.textContent === "Today"), false);
    await draw("2026-01-03");
    assert.ok(requests.includes("2025-11/2026-01-03"));
    assert.deepEqual(picks, []);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
