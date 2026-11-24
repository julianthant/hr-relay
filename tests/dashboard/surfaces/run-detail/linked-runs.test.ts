// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogPanel } from "../../../../src/dashboard/surfaces/run-detail/log-panel.js";
import { linkedRunEntries } from "../../../../src/dashboard/surfaces/run-detail/linked-runs-model.js";

type Row = Parameters<typeof linkedRunEntries>[0];
const wire = (runId: string, workflowId: string, label: string, status: "done" | "running" | "failed") =>
  ({ runId, partitionDay: "2026-11-16", workflowId, label, panelKind: "run" as const, status }) as unknown as Row["linkedRuns"][number];
const parent = { ...wire("run-parent", "onboarding", "Onboarding", "running"), title: "Avery Quinn onboarding", visibility: "linked" as const } as NonNullable<Row["parent"]>;
const children = [wire("run-child-1", "oath-signature", "Oath Signature", "done"), wire("run-child-2", "i9-lookup", "I-9 Lookup", "failed")];

describe("linkedRunEntries", () => {
  it("lists the parent first, then the children, with workflow, name and status", () => {
    const entries = linkedRunEntries({ parent, linkedRuns: children });
    assert.deepEqual(entries.map(entry => [entry.name, entry.workflow, entry.relation]), [
      ["Avery Quinn onboarding", "Onboarding", "Parent"], ["Oath Signature", "Oath Signature", "Child"], ["I-9 Lookup", "I-9 Lookup", "Child"]]);
    assert.equal(entries[0].status, "Running");
    assert.equal(entries[1].status, "Done");
    assert.equal(entries[2].status, "Failed");
  });
  it("is empty for a run with no parent and no child", () => assert.deepEqual(linkedRunEntries({ parent: null, linkedRuns: [] }), []));
});

describe("Logs header linked runs", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(async () => {
    await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
    vi.unstubAllGlobals(); document.body.innerHTML = "";
  });

  const mount = async (row: Row, onOpen = vi.fn()) => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    await act(async () => root.render(createElement(LogPanel, { title: "Avery", steps: [], timeline: [], linkedRuns: linkedRunEntries(row), onOpenLinkedRun: onOpen })));
    return { host, root, onOpen, button: () => host.querySelector<HTMLButtonElement>('button[aria-label^="Linked runs"]') };
  };
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] ul button')];
  const key = async (target: Element, name: string) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });

  it("shows the count on the icon button", async () => {
    const { button } = await mount({ parent, linkedRuns: children });
    expect(button()?.getAttribute("aria-label")).toBe("Linked runs (3)");
  });

  it("shows no button when the run has no linked run", async () => {
    const { button } = await mount({ parent: null, linkedRuns: [] });
    expect(button()).toBeNull();
  });

  it("opens the popover titled Linked runs with one row per run in order", async () => {
    const { button } = await mount({ parent, linkedRuns: children });
    await act(async () => button()!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Linked runs");
    expect(rows().map(row => row.textContent)).toEqual([
      expect.stringMatching(/Avery Quinn onboarding.*Parent.*Onboarding.*Running/),
      expect.stringMatching(/Oath Signature.*Done/),
      expect.stringMatching(/I-9 Lookup.*Failed/)]);
  });

  it("moves with the arrow keys, opens the focused run with Enter and closes", async () => {
    const { button, onOpen } = await mount({ parent, linkedRuns: children });
    await act(async () => button()!.click());
    const list = rows();
    await act(async () => list[0].focus());
    await key(list[0], "ArrowDown");
    assert.equal(document.activeElement === list[1], true);
    await key(list[1], "ArrowDown"); await key(list[2], "ArrowDown");
    assert.equal(document.activeElement === list[0], true, "wraps");
    await key(list[0], "ArrowUp");
    assert.equal(document.activeElement === list[2], true, "wraps back");
    await act(async () => list[2].click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-child-2" }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes on Escape and returns focus to the button", async () => {
    const { button } = await mount({ parent, linkedRuns: children });
    await act(async () => { button()!.focus(); button()!.click(); });
    await key(rows()[0], "Escape");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    assert.equal(document.activeElement === button(), true);
  });

  it("truncates a long name without moving the status", async () => {
    const long = { ...children[0], label: "A very long linked run name ".repeat(8) };
    const { button } = await mount({ parent: null, linkedRuns: [long] });
    await act(async () => button()!.click());
    const name = rows()[0].querySelector(".truncate");
    assert(name, "name truncates");
    expect(rows()[0].textContent).toContain("Done");
  });
});
