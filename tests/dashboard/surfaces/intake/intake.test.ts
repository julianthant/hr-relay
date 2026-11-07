// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act,createElement,type ReactNode } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { IntakeWorkspace } from "../../../../src/dashboard/surfaces/intake/intake.js";

class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);

let mounted: Root | undefined;

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
});

/** The takeover's own root — the `section` the frame renders and names. */
function frameOf(label: string): HTMLElement {
  const node = document.querySelector(`section[aria-label="${label}"]`);
  assert.ok(node instanceof HTMLElement, `no takeover frame is labelled "${label}"`);
  return node;
}


async function mountSurface(client: DashboardClient, children: ReactNode): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(createElement(DashboardClientProvider, { client, children }));
  });
}

// jsdom does not implement Tab navigation; assert the first enabled descendant order directly.
function takeFirstTab(frame: HTMLElement): HTMLElement {
  const first = frame.querySelector<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
  );
  assert.ok(first instanceof HTMLElement, "the takeover has no first Tab target");
  first.focus();
  assert.equal(document.activeElement, first);
  return first;
}

describe("the two remaining takeovers use the shared focus boundary (UF-FU-1)", () => {
  it("Spreadsheet intake receives frame focus, then Tab reaches Close first", async () => {

    const client = {
      intakeSession: () => new Promise<never>(() => undefined),
    } as unknown as DashboardClient;
    await mountSurface(client, createElement(IntakeWorkspace, {
      workflowLabel: "Fixture workflow",
      actorId: "fixture-operator",
      supportsDryRun: false,
      sessionId: "fixture-intake-session",
      onClose: () => undefined,
      onEnqueued: () => undefined,
    }));

    const frame = frameOf("Spreadsheet intake");
    assert.equal(document.activeElement, frame);
    const first = takeFirstTab(frame);
    assert.equal(first.textContent?.trim(), "Close");
  });
});
