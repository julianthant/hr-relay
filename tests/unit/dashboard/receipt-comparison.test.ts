// @vitest-environment jsdom
/** D289's receipt-tab comparison states, privacy boundary, and stale-read guard. */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { RunIdSchema } from "../../../src/domain/ids.js";
import { RunReceiptComparisonWireSchema, type RunReceiptComparisonWire } from "../../../src/domain/dashboard/run-comparison.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientError } from "../../../src/dashboard/client/index.js";
import { ReceiptComparisonPanel } from "../../../src/dashboard/surfaces/receipt.js";
import {
  receiptComparisonFailure,
  useReceiptComparison,
  type ReceiptComparisonRequest,
} from "../../../src/dashboard/surfaces/receipt-model.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const RUN_ONE = RunIdSchema.parse("11111111-1111-4111-8111-111111111111");
const PRIOR_ONE = RunIdSchema.parse("22222222-2222-4222-8222-222222222222");
const RUN_TWO = RunIdSchema.parse("33333333-3333-4333-8333-333333333333");
const PRIOR_TWO = RunIdSchema.parse("44444444-4444-4444-8444-444444444444");

function comparison(runId = RUN_ONE, retryOf = PRIOR_ONE): RunReceiptComparisonWire {
  return RunReceiptComparisonWireSchema.parse({
    wireVersion: 1,
    runId,
    retryOf,
    workflowId: "separations",
    currentReceiptId: "55555555-5555-4555-8555-555555555555",
    priorReceiptId: "66666666-6666-4666-8666-666666666666",
    facts: [
      { state: "added", factId: "separations.observation.new-reference", label: "New reference", after: "reviewed-after" },
      { state: "removed", factId: "separations.observation.old-reference", label: "Prior reference", before: "reviewed-before" },
      { state: "changed", factId: "separations.observation.status", label: "Status", before: "reviewed-before", after: "reviewed-after" },
      { state: "withheld", factId: "separations.observation.protected-detail", label: "Protected detail" },
    ],
  });
}

function request(state: ReceiptComparisonRequest["state"]): ReceiptComparisonRequest {
  return { state, retry: () => undefined };
}

function render(state: ReceiptComparisonRequest["state"]): string {
  return renderToStaticMarkup(createElement(ReceiptComparisonPanel, { comparison: request(state) }));
}

describe("D289 receipt comparison render", () => {
  it("renders every authority fact arm without treating protected data as a comparable value", () => {
    const html = render({ state: "ready", value: comparison() });
    assert.match(html, /New reference/u);
    assert.match(html, /Prior reference/u);
    assert.match(html, /Status/u);
    assert.match(html, /Added/u);
    assert.match(html, /Removed/u);
    assert.match(html, /Changed/u);
    assert.match(html, /reviewed-before/u);
    assert.match(html, /reviewed-after/u);
    assert.match(html, /Protected detail/u);
    assert.match(html, /Withheld to protect this detail/u);
  });

  it("keeps withheld data free of raw values and any difference or absence claim", () => {
    const html = render({
      state: "ready",
      value: RunReceiptComparisonWireSchema.parse({
        ...comparison(),
        facts: [{ state: "withheld", factId: "separations.observation.protected-detail", label: "Protected detail" }],
      }),
    });
    assert.doesNotMatch(html, /sensitive-person-value|••••1234|digest|added|removed|changed/iu);
    assert.match(html, /Withheld to protect this detail/u);
  });

  it("keeps no-prior, unavailable, refusal, and unexpected failure distinct", () => {
    assert.match(render({ state: "not-comparable" }), /No earlier run to compare/u);
    assert.match(render({ state: "unavailable", code: "SECTION_UNAVAILABLE" }), /is unavailable/u);
    assert.match(render({ state: "refused", code: "TARGET_NOT_FOUND" }), /was refused/u);
    const errorHtml = render({ state: "error", code: "NETWORK_DOWN" });
    assert.match(errorHtml, /could not be loaded/u);
    assert.match(errorHtml, /Retry comparison/u);
  });
});

describe("D289 typed failure fold", () => {
  it("does not collapse authority unavailable or refusal into the ordinary empty state", () => {
    expect(receiptComparisonFailure(new DashboardClientError({ kind: "http", code: "SECTION_UNAVAILABLE", message: "unavailable" })))
      .toEqual({ state: "unavailable", code: "SECTION_UNAVAILABLE" });
    expect(receiptComparisonFailure(new DashboardClientError({ kind: "http", code: "TARGET_NOT_FOUND", message: "refused" })))
      .toEqual({ state: "refused", code: "TARGET_NOT_FOUND" });
    expect(receiptComparisonFailure(new DashboardClientError({ kind: "network", message: "offline", retryable: true })))
      .toEqual({ state: "error" });
  });
});

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((complete) => { resolve = complete; });
  return {
    promise,
    resolve: (value) => {
      if (resolve === undefined) throw new Error("deferred promise lost its resolver");
      resolve(value);
    },
  };
}

let root: Root | undefined;

afterEach(async () => {
  if (root !== undefined) {
    const current = root;
    root = undefined;
    await act(async () => { current.unmount(); });
  }
  document.body.replaceChildren();
});

function ComparisonProbe({ runId, retryOf }: { runId: typeof RUN_ONE; retryOf?: typeof PRIOR_ONE }) {
  const comparisonState = useReceiptComparison(runId, retryOf);
  return createElement("output", { "data-state": comparisonState.state.state }, comparisonState.state.state);
}

describe("D289 client integration", () => {
  it("does not request a comparison when the selected receipt has no exact retry target", async () => {
    const calls: string[] = [];
    const client = {
      runReceiptComparison(runId: string): Promise<RunReceiptComparisonWire> {
        calls.push(runId);
        return Promise.resolve(comparison());
      },
    } as unknown as DashboardClient;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(createElement(DashboardClientProvider, {
        client,
        children: createElement(ComparisonProbe, { runId: RUN_ONE }),
      }));
    });

    assert.equal(host.querySelector("output")?.dataset.state, "not-comparable");
    assert.deepEqual(calls, []);
  });

  it("keeps an unexpected client failure in the explicit error arm", async () => {
    const client = {
      runReceiptComparison(): Promise<RunReceiptComparisonWire> {
        return Promise.reject(new Error("socket closed"));
      },
    } as unknown as DashboardClient;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(createElement(DashboardClientProvider, {
        client,
        children: createElement(ComparisonProbe, { runId: RUN_ONE, retryOf: PRIOR_ONE }),
      }));
      await Promise.resolve();
    });

    assert.equal(host.querySelector("output")?.dataset.state, "error");
  });

  it("keeps the comparison retry in the keyboard order after an unexpected read failure", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(ReceiptComparisonPanel, {
        comparison: request({ state: "error" }),
      }));
    });
    const retry = [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry comparison");
    if (retry === undefined) throw new Error("comparison error rendered no retry control");
    assert.equal(retry.disabled, false);
    retry.focus();
    assert.equal(document.activeElement, retry);
  });

  it("never lets a stale receipt-comparison response bind after selecting another retry", async () => {
    const first = deferred<RunReceiptComparisonWire>();
    const second = deferred<RunReceiptComparisonWire>();
    const calls: string[] = [];
    const client = {
      runReceiptComparison(runId: string): Promise<RunReceiptComparisonWire> {
        calls.push(runId);
        return runId === RUN_ONE ? first.promise : second.promise;
      },
    } as unknown as DashboardClient;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(createElement(DashboardClientProvider, {
        client,
        children: createElement(ComparisonProbe, { runId: RUN_ONE, retryOf: PRIOR_ONE }),
      }));
    });
    await act(async () => {
      root?.render(createElement(DashboardClientProvider, {
        client,
        children: createElement(ComparisonProbe, { runId: RUN_TWO, retryOf: PRIOR_TWO }),
      }));
    });
    await act(async () => { first.resolve(comparison()); });
    assert.equal(host.querySelector("output")?.dataset.state, "loading");
    await act(async () => { second.resolve(comparison(RUN_TWO, PRIOR_TWO)); });
    assert.equal(host.querySelector("output")?.dataset.state, "ready");
    assert.deepEqual(calls, [RUN_ONE, RUN_TWO]);
  });
});
