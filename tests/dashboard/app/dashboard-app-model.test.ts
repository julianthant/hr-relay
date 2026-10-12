// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import {
RUN_START_DOOR_ID,
restoreDashboardTakeoverFocus,
} from "../../../src/dashboard/app/dashboard-app-model.js";

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

describe("closing a route-backed takeover restores its toolbar door", () => {

  it("uses the persistent main region when a deep link has no matching door", () => {
    const main = document.createElement("main");
    main.id = "fixture-main-region";
    main.tabIndex = -1;
    document.body.append(main);

    restoreDashboardTakeoverFocus(document, RUN_START_DOOR_ID, main.id);
    assert.equal(document.activeElement, main);
  });

  it("fails loud when neither the requested door nor the main fallback exists", () => {
    assert.throws(
      () => restoreDashboardTakeoverFocus(
        document,
        RUN_START_DOOR_ID,
        "missing-main-region",
      ),
      /neither dashboard-run-start-door nor missing-main-region is mounted/u,
    );
  });
});
