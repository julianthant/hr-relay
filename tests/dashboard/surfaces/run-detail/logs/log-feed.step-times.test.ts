// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { TooltipProvider } from "../../../../../src/dashboard/ds/ui.js";
import { LogFeed } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed.js";
import type { LogStep } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(HTMLElement.prototype, "scrollTo", () => {});
Reflect.set(globalThis, "ResizeObserver", class { observe() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const steps: readonly LogStep[] = [{ id: "s1", time: "1:24:00 PM", title: "Kuali extraction", entries: [
  { kind: "note", id: "n1", time: "1:24:00 PM", message: "Kuali Action · Done" },
  { kind: "note", id: "n2", time: "1:24:07 PM", message: "Separation Document · Done" },
  { kind: "note", id: "n3", time: "1:24:15 PM", message: "Separation Plan · Failed" }] }];

it("shows each step of one stage with its own time", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(LogFeed, { steps }))));
  const times = [...document.querySelectorAll("time")].map(node => node.textContent);
  assert.deepEqual(times.filter(time => time?.startsWith("1:24")), ["1:24:00 PM", "1:24:07 PM", "1:24:15 PM"]);
  assert.ok(document.body.textContent?.includes("Separation Plan · Failed"));
});
