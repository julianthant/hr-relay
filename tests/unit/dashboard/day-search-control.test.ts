// @vitest-environment jsdom
/**
 * DCR4's operator seam, pressed: the corpus request is debounced and stale
 * settlements cannot repaint newer state; all refusal renderings stay redacted,
 * including an unsafe duplicate continuation after a valid first page.
 */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import {
  CrossDateSearchPageSchema,
  type CrossDateSearchPage,
  type CrossDateSearchQueryInput,
} from "../../../src/domain/dashboard/search.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { DaySearchControl } from "../../../src/dashboard/surfaces/day-search.js";
import { TOP_BAR_CORPUS_SEARCH_DEBOUNCE_MS } from "../../../src/dashboard/surfaces/day-search-model.js";

const RAW_RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";

class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function page(input: Readonly<{ cursor?: "present" | "absent"; runId?: string; query?: string }> = {}): CrossDateSearchPage {
  const runId = input.runId ?? RAW_RUN_ID;
  return CrossDateSearchPageSchema.parse({
    wireVersion: 1,
    generatedAt: "2026-08-28T16:00:00.000Z",
    snapshot: { authorityGeneration: 19, order: "match-strength/enqueued-desc/run-id-asc:v1" },
    totalMatches: 1,
    results: [{
      runId,
      traceId: `sp-160000-${runId.slice(0, 4)}`,
      workflowId: "separations",
      registration: { state: "registered", label: "Separations", code: "sp", categoryId: "separation" },
      partitionDay: "2026-08-03",
      state: "parked-gate",
      shape: "single",
      dryRun: true,
      priority: "interactive",
      systems: ["kuali", "new-kronos", "ucpath"],
      runNumber: { state: "present", value: 42 },
      retryOf: { state: "absent", reason: "this run is not a retry" },
      enqueuedAt: "2026-08-28T16:00:00.000Z",
      endedAt: { state: "absent", reason: "this run is parked at a gate" },
      match: { field: "workflow", strength: "exact" },
    }],
    nextCursor: input.cursor === "absent"
      ? { state: "absent", reason: "the snapshot has no later matching run" }
      : { state: "present", value: "opaque-first-page-cursor" },
  });
}

function emptyPage(): CrossDateSearchPage {
  return CrossDateSearchPageSchema.parse({
    wireVersion: 1,
    generatedAt: "2026-08-28T16:00:00.000Z",
    snapshot: { authorityGeneration: 19, order: "match-strength/enqueued-desc/run-id-asc:v1" },
    totalMatches: 0,
    results: [],
    nextCursor: { state: "absent", reason: "the snapshot has no matching runs" },
  });
}

function clientWithSearch(searchRuns: (input: CrossDateSearchQueryInput) => Promise<CrossDateSearchPage>): DashboardClient {
  return new Proxy({ searchRuns }, {
    get(target, property): unknown {
      const value = Reflect.get(target, property);
      if (value === undefined) {
        throw new Error(`the Top Bar reached client.${String(property)} without this test serving it`);
      }
      return value;
    },
  }) as DashboardClient;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  if (resolve === undefined || reject === undefined) throw new Error("deferred promise did not expose settlement handles");
  return { promise, resolve, reject };
}

let root: Root | undefined;

afterEach(async () => {
  vi.useRealTimers();
  const mounted = root;
  root = undefined;
  if (mounted !== undefined) {
    await act(async () => {
      mounted.unmount();
    });
  }
  document.body.replaceChildren();
});

async function mount(client: DashboardClient): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(DashboardClientProvider, {
      client,
      children: createElement(DaySearchControl, {
        surfaces: [],
        day: "2026-08-03",
        workflowLabelOf: (workflowId: string) => workflowId,
        onOpenRun: () => undefined,
        onOpenCrossDateResult: () => undefined,
      }),
    }));
  });
  const trigger = document.body.querySelector<HTMLButtonElement>("button[aria-label='Search runs across dates']");
  if (trigger === null) throw new Error("the Top Bar search trigger did not render");
  await act(async () => {
    trigger.click();
  });
}

function searchbox(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>("input[role='searchbox']");
  if (input === null) throw new Error("the corpus searchbox did not render");
  return input;
}

function typeInto(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const setter = descriptor?.set;
  if (setter === undefined) throw new Error("jsdom exposed no input value setter");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function typeCorpusQuery(value: string): Promise<void> {
  await act(async () => {
    typeInto(searchbox(), value);
  });
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the Top Bar corpus request", () => {
  it("debounces input and prevents an old settlement from painting over the newer query", async () => {
    vi.useFakeTimers();
    const requests: Array<Readonly<{ input: CrossDateSearchQueryInput; deferred: Deferred<CrossDateSearchPage> }>> = [];
    await mount(clientWithSearch((input) => {
      const pending = deferred<CrossDateSearchPage>();
      requests.push({ input, deferred: pending });
      return pending.promise;
    }));

    await typeCorpusQuery("old");
    await elapse(TOP_BAR_CORPUS_SEARCH_DEBOUNCE_MS - 1);
    assert.equal(requests.length, 0, "typing must not issue an authority read per keystroke");
    await elapse(1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.input.q, "old");

    await typeCorpusQuery("new");
    await elapse(TOP_BAR_CORPUS_SEARCH_DEBOUNCE_MS);
    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.input.q, "new");

    await act(async () => {
      requests[1]?.deferred.resolve(emptyPage());
      await Promise.resolve();
    });
    assert.match(document.body.textContent ?? "", /No Separations run matches “new”/u);

    await act(async () => {
      requests[0]?.deferred.resolve(page({ cursor: "absent" }));
      await Promise.resolve();
    });
    const text = document.body.textContent ?? "";
    assert.match(text, /No Separations run matches “new”/u);
    assert.doesNotMatch(text, /Open Separations Run 42/u, "a superseded response must not repaint the list");
  });

  it("keeps unexpected failure detail out of both corpus and this-day UI", async () => {
    vi.useFakeTimers();
    const secret = `unsafe ${RAW_RUN_ID}`;
    await mount(clientWithSearch(() => {
      throw new Error(secret);
    }));
    await typeCorpusQuery("safe term");
    await elapse(TOP_BAR_CORPUS_SEARCH_DEBOUNCE_MS);
    await act(async () => { await Promise.resolve(); });
    assert.match(document.body.textContent ?? "", /The cross-date result set could not be safely applied\./u);
    assert.doesNotMatch(document.body.textContent ?? "", new RegExp(RAW_RUN_ID, "u"));

    const dayToggle = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => (button.textContent ?? "").trim() === "This day");
    if (dayToggle === undefined) throw new Error("the served-day search scope toggle did not render");
    await act(async () => {
      dayToggle.click();
    });
    const text = document.body.textContent ?? "";
    assert.match(text, /Search this day/u);
    assert.doesNotMatch(text, /cross-date result set could not be safely applied/u);
    assert.doesNotMatch(text, new RegExp(RAW_RUN_ID, "u"));
  });

  it("renders a redacted continuation refusal when a later page repeats a durable run", async () => {
    vi.useFakeTimers();
    const first = page();
    const duplicate = { ...first, nextCursor: { state: "absent" as const, reason: "end" } };
    let calls = 0;
    await mount(clientWithSearch(() => {
      calls += 1;
      return Promise.resolve(calls === 1 ? first : duplicate);
    }));
    await typeCorpusQuery("separations");
    await elapse(TOP_BAR_CORPUS_SEARCH_DEBOUNCE_MS);
    await act(async () => { await Promise.resolve(); });

    const more = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => (button.textContent ?? "").includes("Load next"));
    if (more === undefined) throw new Error("the first corpus page did not offer its continuation");
    await act(async () => {
      more.click();
      await Promise.resolve();
    });
    const text = document.body.textContent ?? "";
    assert.match(text, /The next search page was refused/u);
    assert.match(text, /The cross-date result set could not be safely applied\./u);
    assert.doesNotMatch(text, new RegExp(RAW_RUN_ID, "u"));
  });
});
