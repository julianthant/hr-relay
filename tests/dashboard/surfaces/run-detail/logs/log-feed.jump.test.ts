// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LogFeed } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed.js";
import type { LogStep } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";

const list = vi.hoisted(() => ({ heightChanged: undefined as ((height: number) => void) | undefined }));
vi.mock("react-virtuoso", () => ({ Virtuoso: (props: { totalListHeightChanged?: (height: number) => void }) => { list.heightChanged = props.totalListHeightChanged; return null; } }));
afterEach(() => vi.unstubAllGlobals());

it("offers Jump to latest once a windowed log has its height, before any scroll", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const steps: readonly LogStep[] = Array.from({ length: 201 }, (_, index) => ({ id: `step-${index}`, title: "Read", time: "09:00:00", entries: [{ kind: "note" as const, id: `note-${index}`, time: "09:00:00", message: "Read." }] }));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(LogFeed, { steps })));
  const jumpButton = () => [...host.querySelectorAll("button")].find(button => button.textContent === "Jump to latest");
  expect(jumpButton()).toBeUndefined();
  const scroller = host.querySelector('[role="region"]')!;
  Object.defineProperty(scroller, "scrollHeight", { value: 5000 });
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  await act(async () => list.heightChanged?.(5000));
  expect(jumpButton()).toBeDefined();
  await act(async () => root.unmount()); host.remove();
});
