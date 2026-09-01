// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import type { RunDetailWire } from "../../../src/domain/dashboard/run-detail.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { RunCaptures } from "../../../src/dashboard/surfaces/run-captures.js";
import {
  RUN_CAPTURE_TOUCH_TARGET,
  runCaptureFrame,
  useRunCaptures,
} from "../../../src/dashboard/surfaces/run-captures-model.js";
import { CAPTURE_RUN_A, CAPTURE_RUN_B, CAPTURE_BASE_URL, captureData, captureDetail } from "./fixtures/run-captures-app-fixture.js";

it("frames only literal failure origins and uses the configured coarse-pointer floor", () => {
  const capture = captureData();
  const origin = capture.origins[0];
  if (origin === undefined) throw new Error("the capture lifecycle fixture lost its origin");
  assert.match(runCaptureFrame({ ...capture, origins: [{ ...origin, originKind: "failure" }] }), /danger/u);
  assert.doesNotMatch(
    runCaptureFrame({ ...capture, origins: [{ ...origin, originKind: "unexpected-state" }] }),
    /danger/u,
  );
  assert.equal(RUN_CAPTURE_TOUCH_TARGET, "pointer-coarse:min-h-11 pointer-coarse:min-w-11");
});

it.each(["requested run", "loaded revision", "inactive tab"])(
  "never commits an old capture before passive effects on %s replacement", async replacement => {
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const requests: string[] = [];
    const client = createDashboardClient({ baseUrl: CAPTURE_BASE_URL, fetchImpl: async url => {
      requests.push(url);
      assert.equal(url, `${CAPTURE_BASE_URL}/api/v1/runs/${CAPTURE_RUN_A}/captures`);
      return Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A, artifacts: [captureData()] } });
    } });
    const commits: { state: string; href: string | null }[] = [];
    function Probe(props: { requested: string; detail: RunDetailWire; active: boolean }) {
      const captures = useRunCaptures(props.requested, props.detail, props.active);
      // Layout effect observes the committed child before passive request effects.
      useLayoutEffect(() => { commits.push({ state: captures.state,
        href: host.querySelector("a[download]")?.getAttribute("href") ?? null }); });
      return createElement(RunCaptures, { captures });
    }
    const render = async (requested: string, detail: RunDetailWire, active: boolean) => {
      await act(async () => { root.render(createElement(DashboardClientProvider, {
        client, children: createElement(Probe, { requested, detail, active }),
      })); });
    };
    try {
      await render(CAPTURE_RUN_A, captureDetail(), true);
      assert.equal(commits.at(-1)?.state, "available");
      assert.ok(commits.at(-1)?.href);
      // New detail object identity alone is not a new product owner.
      await render(CAPTURE_RUN_A, captureDetail(), true);
      assert.equal(requests.length, 1);
      commits.length = 0;
      await render(replacement === "requested run" ? CAPTURE_RUN_B : CAPTURE_RUN_A,
        captureDetail(CAPTURE_RUN_A, { rowRevision: replacement === "loaded revision" ? 2 : 1 }),
        replacement !== "inactive tab");
      assert.deepEqual(commits[0], { state: replacement === "inactive tab" ? "inactive" : "loading", href: null },
        "the very first committed DOM must not retain the old native download");
      assert.equal(requests.length, replacement === "loaded revision" ? 2 : 1,
        "an inactive tab or a mismatched previous detail must not fetch");
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      if (previousAct === undefined) Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      else Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
    }
  },
);
