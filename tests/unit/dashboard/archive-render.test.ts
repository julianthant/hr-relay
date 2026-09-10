// @vitest-environment jsdom
/**
 * Two ui-review findings on the archive surface (unit F10b) that no pure fold
 * can hold, because both are about what the DOM says once React has drawn it.
 *
 * 1. The windowed table's row count (finding 4, archive.tsx:809). Only the
 *    mounted slice is ever in the DOM — `windowArchiveTable` sees to that on
 *    purpose (D274 item 1) — so an assistive technology reading the tree alone
 *    counts however many rows happen to be rendered, not the true size of the
 *    list. `ArchiveTable` is rendered to static markup (the standing pattern
 *    for a JSX fact `queue-bulk-band-sentence.test.ts` already uses) and the
 *    markup is read back for `aria-rowcount` on the `<table>` and
 *    `aria-rowindex` on each `<tr>`.
 *
 * 2. The capture viewer's Previous/Next walk (finding 1, archive.tsx:2073).
 *    `disabled` pulls a button out of the tab order the instant it disables,
 *    so the control the operator had just pressed to REACH an end lost focus
 *    to the dialog body. `CaptureViewerDialog` is mounted into a real document
 *    and pressed, the way `run-start-dialog.test.ts` presses the Run Modal.
 *    What jsdom can actually prove here is the ROOT CAUSE — the button must
 *    never become a real `disabled` control at either end — not the browser's
 *    own focus-eviction step, which jsdom does not implement (checked by
 *    hand: `btn.disabled = true` on a focused jsdom button leaves
 *    `document.activeElement` untouched, so an `activeElement` assertion
 *    alone would pass against the very `disabled=` code this file exists to
 *    catch). See the comment on the describe block below.
 */
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it } from "vitest";
import {
  ArchiveEntryWireSchema,
  ArchivedCaptureResourceWireSchema,
  type ArchivedCaptureResourceWire,
} from "../../../src/domain/dashboard/archive.js";
import { ArchivedCaptureTileSchema, type ArchivedCaptureTile } from "../../../src/domain/archive/sections.js";
import { ArtifactIdSchema, RunIdSchema } from "../../../src/domain/ids.js";
import {
  ArchiveTable,
  ArchivedRunDetail,
  CaptureViewerDialog,
} from "../../../src/dashboard/surfaces/archive.js";
import type { ArchiveSection } from "../../../src/dashboard/surfaces/archive-model.js";
import { FIXTURE_ARCHIVE_INDEX } from "../../parity/helpers/fixture-archive.js";
import { FIXTURE_ARCHIVE_EVIDENCE_RUN } from "../../parity/helpers/fixture-archive-evidence.js";
import { ToastProvider } from "../../../src/dashboard/ds/ui.js";

const noop = (): void => undefined;

/* ── fixtures ─────────────────────────────────────────────────────────── */

const ENTRY = FIXTURE_ARCHIVE_INDEX.entries[0];

/** A distinct, schema-valid uuid per fixture row — ids are branded. */
function uuid(seed: string, index: number): string {
  const tail = `${seed}${String(index)}`.padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${tail}`;
}

function entries(seed: string, applicationId: string, n: number): ArchiveSection["entries"] {
  return Array.from({ length: n }, (_, index) => ArchiveEntryWireSchema.parse({
    ...ENTRY,
    applicationId,
    runId: uuid(seed, index),
  }));
}

function section(seed: string, n: number): ArchiveSection {
  const applicationId = uuid(`${seed}f`, 0);
  return { sweep: undefined, applicationId, entries: entries(seed, applicationId, n) };
}

function markup(sections: readonly ArchiveSection[], codes = new Map<string, string>()): string {
  return renderToStaticMarkup(createElement(ArchiveTable, {
    sections,
    codes,
    query: { text: "", workflowId: "all", status: "all", instance: "all", sort: "when", dir: "desc" },
    onSort: noop,
    collapsed: new Set<string>(),
    onToggleSection: noop,
    selectedRunId: undefined,
    onSelect: noop,
  }));
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`, "u").exec(tag);
  return match?.[1];
}

describe("the windowed archive table names its true size to assistive tech", () => {
  it("ports the five measured archive column widths through their demo-shaped classes", () => {
    const columns = [...markup([section("a", 1)]).matchAll(/<col\b[^>]*>/gu)].map((match) => match[0]);
    assert.equal(columns.length, 5);
    assert.deepEqual(
      columns.map((column) => attr(column, "class")),
      [
        "w-[var(--ds-w-archive-status)]",
        undefined,
        "w-[var(--ds-w-archive-trace)]",
        "w-[var(--ds-w-archive-when)]",
        "w-[var(--ds-w-archive-duration)]",
      ],
    );
  });

  it("does not retain the demo-only row hook on archived runs", () => {
    assert.equal(markup([section("a", 1)]).includes("data-demo-row-id="), false);
  });

  it("sets aria-rowcount from the flat item list, not the mounted slice", () => {
    const sections = [section("a", 2), section("b", 1)];
    const html = markup(sections);
    const table = /<table\b[^>]*>/u.exec(html)?.[0];
    if (table === undefined) throw new Error("ArchiveTable drew no <table>");
    // 2 sections + 3 runs = 5 flat items — the same count the window arithmetic
    // walks, even though every one of them is mounted here (small fixture, no
    // scroll container measured yet).
    assert.equal(attr(table, "aria-rowcount"), "5");
  });

  it("gives every mounted row a 1-based aria-rowindex over the FULL list", () => {
    const sections = [section("a", 2), section("b", 1)];
    const html = markup(sections);
    const rows = [...html.matchAll(/<tr\b[^>]*>/gu)].map((match) => match[0]);
    const indexed = rows.map((row) => attr(row, "aria-rowindex")).filter((value) => value !== undefined);
    // section head, run, run, section head, run — in that order (flattenArchiveTable).
    assert.deepEqual(indexed, ["1", "2", "3", "4", "5"]);
  });

  it("keeps the window's own rowIndex offset when a section is collapsed", () => {
    const collapsedSection = section("a", 3);
    const html = renderToStaticMarkup(createElement(ArchiveTable, {
      sections: [collapsedSection, section("b", 1)],
      codes: new Map<string, string>(),
      query: { text: "", workflowId: "all", status: "all", instance: "all", sort: "when", dir: "desc" },
      onSort: noop,
      collapsed: new Set([collapsedSection.applicationId]),
      onToggleSection: noop,
      selectedRunId: undefined,
      onSelect: noop,
    }));
    const rows = [...html.matchAll(/<tr\b[^>]*>/gu)].map((match) => match[0]);
    // the header row's `<TR>` carries no `aria-rowindex` — it is not part of
    // the flat item list `rowCount`/`rowIndex` describe — so it drops out here
    // exactly as it does in the two tests above.
    const indexed = rows.map((row) => attr(row, "aria-rowindex")).filter((value) => value !== undefined);
    // the collapsed sweep still costs one flat item (its 3 runs are never
    // built), so the second section's head is row 2 of 3 — never row 4, which
    // is what it would be uncollapsed.
    assert.deepEqual(indexed, ["1", "2", "3"]);
    const table = /<table\b[^>]*>/u.exec(html)?.[0] ?? "";
    assert.equal(attr(table, "aria-rowcount"), "3");
  });
});

/* ── the capture viewer's walk ────────────────────────────────────────── */

function tile(seed: number, origin: ArchivedCaptureTile["origin"] = "operator-request"): ArchivedCaptureTile {
  return ArchivedCaptureTileSchema.parse({
    // "ca"/"bd" — hex-safe seeds, the way the shared `uuid()` helper needs
    // (archive-window.test.ts's own precedent: every letter must be 0-9a-f).
    artifactId: uuid("ca", seed),
    bundleId: uuid("bd", seed),
    kind: "screenshot",
    mediaType: "image/png",
    byteLength: 1_024 * (seed + 1),
    digest: String(seed).repeat(64).slice(0, 64),
    sensitivity: "redacted",
    capturedAt: "2026-08-20T09:11:00.000Z",
    origin,
    step: { state: "present", nodeId: `node-${String(seed)}` },
    system: { state: "present", value: "crm" },
    retention: { kind: "ordinary", purgeAfter: "2026-09-02T09:11:00.000Z" },
  });
}

const TILES: readonly ArchivedCaptureTile[] = [tile(0), tile(1), tile(2)];
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const unreadCapture = async (runId: string, artifactId: string): Promise<ArchivedCaptureResourceWire> => ({
  runId: RunIdSchema.parse(runId),
  artifactId: artifactId as typeof TILES[number]["artifactId"],
  resource: { state: "missing" as const, reason: "test fixture has no bytes" },
});

/** The dialog's own parent owns `index` — this is that parent, minimally. */
function Harness({
  initialIndex,
  readCapture = unreadCapture,
  tiles = TILES,
}: {
  initialIndex: number | undefined;
  readCapture?: (runId: string, artifactId: string, signal?: AbortSignal) => ReturnType<typeof unreadCapture>;
  tiles?: readonly ArchivedCaptureTile[];
}) {
  const [index, setIndex] = useState<number | undefined>(initialIndex);
  return createElement(CaptureViewerDialog, {
    tiles,
    index,
    runId: RUN_ID,
    subject: "EID 10873698",
    onReadCapture: readCapture,
    onIndex: setIndex,
    onClose: () => { setIndex(undefined); },
  });
}

function ReopenHarness({
  readCapture,
}: {
  readCapture: (runId: string, artifactId: string, signal?: AbortSignal) => ReturnType<typeof unreadCapture>;
}) {
  const [index, setIndex] = useState<number | undefined>(0);
  return createElement(
    "div",
    undefined,
    createElement("button", { type: "button", onClick: () => { setIndex(0); } }, "Reopen capture"),
    createElement(CaptureViewerDialog, {
      tiles: TILES,
      index,
      runId: RUN_ID,
      subject: "EID 10873698",
      onReadCapture: readCapture,
      onIndex: setIndex,
      onClose: () => { setIndex(undefined); },
    }),
  );
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let mounted: Root | undefined;

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => { root.unmount(); });
  }
  document.body.replaceChildren();
});

async function mountHarness(
  initialIndex: number,
  readCapture?: (runId: string, artifactId: string, signal?: AbortSignal) => ReturnType<typeof unreadCapture>,
  tiles?: readonly ArchivedCaptureTile[],
): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(createElement(Harness, {
      initialIndex,
      ...(readCapture === undefined ? {} : { readCapture }),
      ...(tiles === undefined ? {} : { tiles }),
    }));
  });
}

async function mountReopenHarness(
  readCapture: (runId: string, artifactId: string, signal?: AbortSignal) => ReturnType<typeof unreadCapture>,
): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => { root.render(createElement(ReopenHarness, { readCapture })); });
}

function findButton(name: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")]
    .filter((button) => (button.textContent ?? "").trim() === name);
  if (match.length !== 1) {
    throw new Error(`expected exactly one "${name}" control, found ${String(match.length)}`);
  }
  const only = match[0];
  if (only === undefined) throw new Error(`"${name}" vanished between find and use`);
  return only;
}

/** A `click()` in jsdom moves no focus of its own — focus first, as a pointer or a Tab would. */
async function press(button: HTMLButtonElement): Promise<void> {
  button.focus();
  await act(async () => { button.click(); });
}

describe("the capture viewer's Previous/Next walk never drops focus", () => {
  /*
    `.disabled` is the load-bearing assertion in both cases below: jsdom does
    NOT reproduce the browser's own "a disabled element cannot hold focus"
    step (checked directly against a mutation — setting `btn.disabled = true`
    on a focused jsdom button leaves `document.activeElement` untouched), so
    the `activeElement` assertion alone would pass against the OLD `disabled=`
    code too. What jsdom CAN and does prove is the root cause the finding
    names: the button must never become a real `disabled` control at either
    end of the walk. Reverting `aria-disabled` back to `disabled` turns both
    `.disabled`/`aria-disabled` assertions here red; the real focus-survives-a-
    real-disable claim belongs to the Playwright parity lane.
  */
  it("keeps focus on Previous once the walk reaches the first capture", async () => {
    await mountHarness(1);
    const previous = findButton("Previous capture");

    await press(previous);

    assert.equal(previous.disabled, false, "Previous became a real disabled control at the start of the walk");
    assert.equal(previous.getAttribute("aria-disabled"), "true");
    assert.equal(document.activeElement, previous, "focus left the nav control at the start of the walk");
  });

  it("keeps focus on Next once the walk reaches the last capture", async () => {
    await mountHarness(1);
    const next = findButton("Next capture");

    await press(next);

    assert.equal(next.disabled, false, "Next became a real disabled control at the end of the walk");
    assert.equal(next.getAttribute("aria-disabled"), "true");
    assert.equal(document.activeElement, next, "focus left the nav control at the end of the walk");
  });

  it("does not advance past either end", async () => {
    await mountHarness(0);
    const previous = findButton("Previous capture");

    await press(previous);
    await press(previous);

    // still on the first tile's own facts — pressing Previous at the start
    // never called onIndex(-1)
    assert.match(document.body.textContent ?? "", /node-0/u);
  });
});

for (const close of ["button", "Escape"] as const) {
  it(`returns focus to the actual archived capture opener after ${close}`, async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted = root;
    await act(async () => {
      root.render(createElement(ToastProvider, {
        children: createElement(ArchivedRunDetail, {
          detail: FIXTURE_ARCHIVE_EVIDENCE_RUN,
          sweep: undefined,
          codes: new Map<string, string>(),
          busy: false,
          relaunched: false,
          refusal: undefined,
          onRelaunch: noop,
          onDelete: noop,
          onDismiss: noop,
          onReadCapture: unreadCapture,
        }),
      }));
    });
    const evidenceTab = [...document.querySelectorAll("button[role=tab]")]
      .find((button) => button.textContent?.startsWith("Evidence"));
    if (!(evidenceTab instanceof HTMLButtonElement)) throw new Error("the archive detail has no Evidence tab");
    await press(evidenceTab);
    const opener = findButton("What it was");
    await press(opener);
    assert.ok(document.querySelector('[role="dialog"]'));
    if (close === "button") await press(findButton("Close"));
    else await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); }); });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    // Same node identity, without asking a failed assertion to inspect the entire jsdom tree.
    assert.equal(document.activeElement === opener, true, "closing the archived viewer lost its opener focus");
  });
}

describe("the archived capture viewer's read-time resource state", () => {
  function available(runId: string, artifactId: string): ArchivedCaptureResourceWire {
    return ArchivedCaptureResourceWireSchema.parse({
      runId,
      artifactId,
      resource: { state: "available", downloadUrl: `/artifacts/v1/archive/${runId}/${artifactId}` },
    });
  }

  async function settle(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
  }

  function image(): HTMLImageElement {
    const element = document.querySelector("img");
    if (!(element instanceof HTMLImageElement)) throw new Error("the available image capture did not render an image element");
    return element;
  }

  function deferred<Value>() {
    let resolve: (value: Value) => void = () => { throw new Error("deferred promise has no resolver"); };
    let reject: (reason: Error) => void = () => { throw new Error("deferred promise has no rejecter"); };
    const promise = new Promise<Value>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
    return { promise, resolve, reject };
  }

  async function loadImage(element: HTMLImageElement, decoding: Promise<void>, width = 1440, height = 900): Promise<void> {
    Object.defineProperties(element, {
      naturalHeight: { configurable: true, value: height },
      naturalWidth: { configurable: true, value: width },
      decode: { configurable: true, value: () => decoding },
    });
    await act(async () => { element.dispatchEvent(new Event("load")); });
  }

  function assertReady(element: HTMLImageElement): void {
    assert.equal(document.querySelector("img") === element, true, "the current preview was replaced");
    assert.equal(element.getAttribute("aria-hidden"), null, "the current decoded image was hidden");
    assert.match(document.body.textContent ?? "", /Verified retained bytes for this frozen archived capture\./u);
    assert.doesNotMatch(document.body.textContent ?? "", /Capture image could not be displayed/u);
  }

  it("explicitly loads the requested archived image eagerly", async () => {
    await mountHarness(0, async (runId, artifactId) => available(runId, artifactId));

    assert.equal(image().getAttribute("loading"), "eager", "the requested capture preview must declare eager loading");
  });

  for (const dimensions of [undefined, { width: 1440, height: 900 }]) {
    it(`reserves the same preview shell through resource loading, decode and failure with ${dimensions === undefined ? "unrecorded" : "frozen"} dimensions`, async () => {
      const frozen = ArchivedCaptureTileSchema.parse({ ...TILES[0], dimensions });
      const resource = deferred<ArchivedCaptureResourceWire>();
      await mountHarness(0, () => resource.promise, [frozen]);
      const preview = () => {
        const figure = document.querySelector('figure[aria-label="Archived capture preview"]');
        if (!(figure instanceof HTMLElement)) throw new Error("the loading image has no reserved preview shell");
        return { style: figure.getAttribute("style"), className: figure.className };
      };
      const loading = preview();
      assert.ok(loading.style, "the preview shell has no explicit size reservation");
      if (dimensions === undefined) assert.match(document.body.textContent ?? "", /this image's pixel dimensions were not recorded/u);
      await act(async () => { resource.resolve(available(RUN_ID, frozen.artifactId)); });
      const element = image();
      assert.equal(element.getAttribute("width"), dimensions === undefined ? null : "1440");
      assert.equal(element.getAttribute("height"), dimensions === undefined ? null : "900");
      assert.deepEqual(preview(), loading);

      const decoding = deferred<void>();
      await loadImage(element, decoding.promise);
      assert.deepEqual(preview(), loading);
      await act(async () => { decoding.resolve(); });
      assertReady(element);
      assert.deepEqual(preview(), loading);
      await act(async () => { element.dispatchEvent(new Event("error")); });
      assert.match(document.body.textContent ?? "", /Capture image could not be displayed/u);
      assert.deepEqual(preview(), loading);
    });
  }

  it("reserves a separate readiness-caption lane without covering retained imagery", async () => {
    await mountHarness(0, async (runId, artifactId) => available(runId, artifactId));
    const element = image();
    const frame = element.closest("figure");
    const caption = frame?.querySelector("figcaption");
    assert.ok(caption instanceof HTMLElement, "the image preview has no persistent caption lane before decode");
    const viewport = element.parentElement;
    assert.ok(viewport instanceof HTMLElement && viewport !== frame, "the retained image still occupies the full caption frame");
    assert.equal(viewport.nextElementSibling === caption, true, "the caption is not a separate image-viewport sibling");
    assert.equal(caption.parentElement === frame, true, "the caption lost its figure semantics");
    assert.ok(frame?.classList.contains("flex") && frame.classList.contains("flex-col"));
    assert.ok(viewport.classList.contains("relative") && viewport.classList.contains("min-h-0") && viewport.classList.contains("flex-1"));
    assert.ok(element.classList.contains("object-contain"), "retained image content must not be cropped");
    assert.ok(caption.classList.contains("shrink-0") && caption.classList.contains("whitespace-normal"));
    assert.equal(caption.classList.contains("absolute"), false, "the caption must not overlay the image");
    assert.ok(caption.classList.contains("min-h-[calc(1lh+var(--ds-space-tight)*2)]"));
    assert.ok(caption.classList.contains("bg-[color:var(--ds-surface-2)]"));
    assert.ok(frame?.classList.contains("bg-[color:var(--ds-surface-2)]"));
    assert.equal(caption.textContent, "", "success text must not be hidden in the pending lane");

    const decoding = deferred<void>();
    await loadImage(element, decoding.promise);
    assert.equal(caption.textContent, "", "HTTP load alone must not publish readiness");
    await act(async () => { decoding.resolve(); });
    assertReady(element);
    assert.equal(frame?.querySelector("figcaption") === caption, true, "decode replaced the reserved caption lane");
    assert.equal(caption.textContent, "Verified retained bytes for this frozen archived capture.");
    await act(async () => { element.dispatchEvent(new Event("error")); });
    assert.equal(frame?.querySelector("figcaption") === caption, true, "refusal removed the reserved caption lane");
    assert.equal(caption.textContent, "", "refusal retained a stale success caption");
  });

  it("offers a verified image download without replacing frozen metadata or inventing purge", async () => {
    const readAvailable = async (runId: string, artifactId: string) => available(runId, artifactId);
    await mountHarness(0, readAvailable);
    await settle();

    const download = [...document.body.querySelectorAll("a")]
      .find((link) => (link.textContent ?? "").trim() === "Download");
    assert.equal(download?.getAttribute("href"), `/artifacts/v1/archive/${RUN_ID}/${TILES[0].artifactId}`);
    assert.match(document.body.textContent ?? "", /node-0/u);
    assert.doesNotMatch(document.body.textContent ?? "", /purged/u);
  });

  it("renders capture footer actions in navigation order", async () => {
    await mountHarness(0, async (runId, artifactId) => available(runId, artifactId));
    const dialog = document.querySelector('[role="dialog"]');
    if (!(dialog instanceof HTMLElement)) throw new Error("the capture dialog did not open");
    const actions = [...dialog.querySelectorAll("footer button, footer a")];
    assert.deepEqual(actions.map((action) => action.textContent?.trim()), ["Previous capture", "Next capture", "Download", "Close"]);
  });

  it("withholds the verified-image claim until the browser has loaded and decoded the image", async () => {
    await mountHarness(0, async (runId, artifactId) => available(runId, artifactId));
    await settle();
    assert.doesNotMatch(document.body.textContent ?? "", /Verified retained bytes for this frozen archived capture\./u);

    const element = image();
    const decoding = deferred<void>();
    await loadImage(element, decoding.promise);
    assert.doesNotMatch(document.body.textContent ?? "", /Verified retained bytes for this frozen archived capture\./u);
    assert.equal(element.getAttribute("aria-hidden"), "true", "onLoad exposed an image whose decode is pending");

    await act(async () => { decoding.resolve(); });

    assert.match(document.body.textContent ?? "", /Verified retained bytes for this frozen archived capture\./u);
    assert.equal(element.getAttribute("aria-hidden"), null);
  });

  for (const failure of ["decode-rejection", "zero-width", "zero-height"] as const) {
    it(`keeps ${failure} visible after metadata verification`, async () => {
      await mountHarness(0, async (runId, artifactId) => available(runId, artifactId));
      const element = image();
      const decoding = deferred<void>();
      await loadImage(element, decoding.promise, failure === "zero-width" ? 0 : 1440, failure === "zero-height" ? 0 : 900);
      await act(async () => {
        if (failure === "decode-rejection") decoding.reject(new Error("decoder refused the bytes"));
        else decoding.resolve();
      });

      assert.match(document.body.textContent ?? "", /Capture image could not be displayed/u);
      assert.doesNotMatch(document.body.textContent ?? "", /Verified retained bytes for this frozen archived capture\./u);
      assert.equal(element.getAttribute("aria-hidden"), "true");
      assert.match(document.body.textContent ?? "", /node-0/u);
    });
  }

  for (const transition of ["next", "close-reopen"] as const) {
    for (const settlement of ["resolve", "reject"] as const) {
      it(`ignores an old image decode ${settlement} after the ${transition} image is ready`, async () => {
        const read = async (runId: string, artifactId: string) => available(runId, artifactId);
        if (transition === "next") await mountHarness(0, read);
        else await mountReopenHarness(read);
        const oldDecoding = deferred<void>();
        await loadImage(image(), oldDecoding.promise);

        if (transition === "next") await press(findButton("Next capture"));
        else {
          await press(findButton("Close"));
          await press(findButton("Reopen capture"));
        }
        const currentImage = image();
        await loadImage(currentImage, Promise.resolve());
        assertReady(currentImage);
        await act(async () => {
          if (settlement === "resolve") oldDecoding.resolve();
          else oldDecoding.reject(new Error("obsolete image decode failed"));
        });

        assertReady(currentImage);
      });
    }
  }

  for (const intermediate of ["non-image", "undecoded-image"] as const) {
    it(`requires a fresh A decode after navigating A to ${intermediate} B to A`, async () => {
      const middle = intermediate === "non-image"
        ? ArchivedCaptureTileSchema.parse({ ...TILES[1], kind: "accessibility-excerpt", mediaType: "text/yaml" })
        : TILES[1];
      await mountHarness(0, async (runId, artifactId) => available(runId, artifactId), [TILES[0], middle]);
      const firstImage = image();
      await loadImage(firstImage, Promise.resolve());
      assertReady(firstImage);

      await press(findButton("Next capture"));
      await press(findButton("Previous capture"));
      const returnedImage = image();
      assert.notEqual(returnedImage, firstImage, "navigation did not create a new image attempt");
      assert.doesNotMatch(document.body.textContent ?? "", /Verified retained bytes for this frozen archived capture\./u);
      assert.equal(returnedImage.getAttribute("aria-hidden"), "true");
      await loadImage(returnedImage, Promise.resolve());
      assertReady(returnedImage);
    });
  }

  for (const transition of ["next", "close-reopen"] as const) {
    for (const settlement of ["resolve", "reject"] as const) {
      it(`preserves current metadata after an old resource ${settlement} across ${transition}`, async () => {
        const old = deferred<ArchivedCaptureResourceWire>();
        const current = deferred<ArchivedCaptureResourceWire>();
        const signals: AbortSignal[] = [];
        const pending = [old, current];
        const read = (_runId: string, _artifactId: string, signal?: AbortSignal) => {
          if (signal === undefined) throw new Error("the resource read has no abort signal");
          signals.push(signal);
          const request = pending.shift();
          if (request === undefined) throw new Error("unexpected resource read for unchanged ownership");
          return request.promise;
        };
        if (transition === "next") {
          await mountHarness(0, read);
          await press(findButton("Next capture"));
        } else {
          await mountReopenHarness(read);
          await press(findButton("Close"));
          await press(findButton("Reopen capture"));
        }
        const currentTile = transition === "next" ? TILES[1] : TILES[0];
        await act(async () => { current.resolve(available(RUN_ID, currentTile.artifactId)); });
        const currentImage = image();
        await loadImage(currentImage, Promise.resolve());
        assertReady(currentImage);
        assert.equal(signals[0].aborted, true);
        const before = document.body.textContent;
        const currentDownload = document.querySelector("a[download]");

        await act(async () => {
          if (settlement === "resolve") old.resolve(available(RUN_ID, TILES[0].artifactId));
          else old.reject(new Error("obsolete metadata request failed"));
        });

        assert.equal(document.body.textContent, before, "stale metadata changed the current viewer");
        assert.equal(document.querySelector("a[download]") === currentDownload, true);
        assert.equal(currentDownload?.getAttribute("href"), `/artifacts/v1/archive/${RUN_ID}/${currentTile.artifactId}`);
        assertReady(currentImage);
      });
    }
  }

  it("keeps a verified-metadata image load failure visible instead of claiming a broken image is verified", async () => {
    await mountHarness(0, async (runId, artifactId) => available(runId, artifactId));
    await settle();
    const element = image();
    await act(async () => { element.dispatchEvent(new Event("error")); });

    assert.match(document.body.textContent ?? "", /Capture image could not be displayed/u);
    assert.doesNotMatch(document.body.textContent ?? "", /Verified retained bytes for this frozen archived capture\./u);
    assert.equal(element.getAttribute("aria-hidden"), "true");
    assert.match(document.body.textContent ?? "", /node-0/u);
  });

  it("keeps frozen capture metadata readable for missing, corrupt, and unavailable resource results", async () => {
    await mountHarness(0, async (runId, artifactId) => ({
      runId: RunIdSchema.parse(runId),
      artifactId: artifactId as typeof TILES[number]["artifactId"],
      resource: { state: "missing", reason: "the fixture store no longer holds these bytes" },
    }));
    await settle();
    assert.match(document.body.textContent ?? "", /Capture bytes are missing/u);
    assert.match(document.body.textContent ?? "", /node-0/u);
    assert.doesNotMatch(document.body.textContent ?? "", /purged/u);
  });

  it("keeps frozen capture metadata readable when byte verification reports corruption", async () => {
    await mountHarness(0, async (runId, artifactId) => ({
      runId: RunIdSchema.parse(runId),
      artifactId: artifactId as typeof TILES[number]["artifactId"],
      resource: { state: "error", message: "the fixture bytes did not match the archive digest" },
    }));
    await settle();
    assert.match(document.body.textContent ?? "", /Capture bytes could not be verified/u);
    assert.match(document.body.textContent ?? "", /node-0/u);
  });

  it("keeps frozen capture metadata readable when the resource request itself is unavailable", async () => {
    await mountHarness(0, async () => { throw new Error("the archive resource service is unavailable"); });
    await settle();
    assert.match(document.body.textContent ?? "", /Capture resource could not be read/u);
    assert.match(document.body.textContent ?? "", /node-0/u);
  });

  it("offers non-image bytes for download without fabricating an inline preview", async () => {
    const nonImage = ArchivedCaptureTileSchema.parse({
      ...TILES[0],
      kind: "accessibility-excerpt",
      mediaType: "text/yaml",
    });
    await mountHarness(0, async (runId, artifactId) => available(runId, artifactId), [nonImage]);
    await settle();
    assert.match(document.body.textContent ?? "", /This media type has no inline preview/u);
    assert.equal(document.querySelector("img"), null);
    assert.equal(
      [...document.body.querySelectorAll("a")].find((link) => (link.textContent ?? "").trim() === "Download")?.getAttribute("href"),
      `/artifacts/v1/archive/${RUN_ID}/${nonImage.artifactId}`,
    );
  });

  it("aborts and ignores the prior capture request before the next capture can render it", async () => {
    let resolveFirst: ((value: ArchivedCaptureResourceWire) => void) | undefined;
    let resolveSecond: ((value: ArchivedCaptureResourceWire) => void) | undefined;
    const signals: AbortSignal[] = [];
    const read = (runId: string, artifactId: string, signal?: AbortSignal): Promise<ArchivedCaptureResourceWire> => {
      if (signal === undefined) throw new Error("the capture read did not receive an abort signal");
      signals.push(signal);
      return new Promise((resolve) => {
        if (artifactId === TILES[0].artifactId) resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    };
    await mountHarness(0, read);
    await press(findButton("Next capture"));
    assert.equal(signals[0].aborted, true, "walking to another capture did not abort the old request");
    if (resolveFirst === undefined || resolveSecond === undefined) throw new Error("the capture requests did not both begin");
    const first = resolveFirst;
    const second = resolveSecond;

    await act(async () => { first(available(RUN_ID, TILES[0].artifactId)); });
    assert.doesNotMatch(document.body.textContent ?? "", /Download/u);
    await act(async () => { second(available(RUN_ID, TILES[1].artifactId)); });
    assert.equal(
      [...document.body.querySelectorAll("a")].find((link) => (link.textContent ?? "").trim() === "Download")?.getAttribute("href"),
      `/artifacts/v1/archive/${RUN_ID}/${TILES[1].artifactId}`,
    );
    assert.match(document.body.textContent ?? "", /node-1/u);
  });

  it("aborts and ignores a closed capture request when the same dialog is reopened", async () => {
    const resolves: ((value: ArchivedCaptureResourceWire) => void)[] = [];
    const signals: AbortSignal[] = [];
    const read = (runId: string, artifactId: string, signal?: AbortSignal): Promise<ArchivedCaptureResourceWire> => {
      if (signal === undefined) throw new Error("the capture read did not receive an abort signal");
      signals.push(signal);
      return new Promise((resolve) => { resolves.push(resolve); });
    };
    await mountReopenHarness(read);
    await press(findButton("Close"));
    assert.equal(signals[0].aborted, true, "closing the dialog did not abort its resource read");
    await press(findButton("Reopen capture"));
    if (resolves.length !== 2) throw new Error(`expected two resource reads across close and reopen, received ${String(resolves.length)}`);
    const first = resolves[0];
    const second = resolves[1];
    if (first === undefined || second === undefined) throw new Error("a capture resource resolver disappeared");

    await act(async () => { first(available(RUN_ID, TILES[0].artifactId)); });
    assert.equal([...document.body.querySelectorAll("a")].some((link) => (link.textContent ?? "").trim() === "Download"), false);
    await act(async () => { second(available(RUN_ID, TILES[0].artifactId)); });
    assert.equal(
      [...document.body.querySelectorAll("a")].find((link) => (link.textContent ?? "").trim() === "Download")?.getAttribute("href"),
      `/artifacts/v1/archive/${RUN_ID}/${TILES[0].artifactId}`,
    );
  });

  it("does not reuse an already-decoded image as success after a close and reopen of the same capture", async () => {
    await mountReopenHarness(async (runId, artifactId) => available(runId, artifactId));
    await settle();
    const firstImage = image();
    Object.defineProperties(firstImage, {
      naturalHeight: { configurable: true, value: 900 },
      naturalWidth: { configurable: true, value: 1440 },
    });
    Object.defineProperty(firstImage, "decode", { configurable: true, value: async () => undefined });
    await act(async () => {
      firstImage.dispatchEvent(new Event("load"));
      await Promise.resolve();
    });
    assert.match(document.body.textContent ?? "", /Verified retained bytes for this frozen archived capture\./u);

    await press(findButton("Close"));
    await press(findButton("Reopen capture"));
    await settle();

    assert.doesNotMatch(document.body.textContent ?? "", /Verified retained bytes for this frozen archived capture\./u);
  });

  it("refuses a foreign URL from an injected reader even when the response repeats the requested ids", async () => {
    await mountHarness(0, async (runId, artifactId) => ({
      runId: RunIdSchema.parse(runId),
      artifactId: artifactId as typeof TILES[number]["artifactId"],
      resource: { state: "available", downloadUrl: `/artifacts/v1/archive/${runId}/${TILES[1].artifactId}` },
    }));
    await settle();

    assert.match(document.body.textContent ?? "", /named a different download/u);
    assert.equal([...document.body.querySelectorAll("a")].some((link) => (link.textContent ?? "").trim() === "Download"), false);
    assert.match(document.body.textContent ?? "", /node-0/u);
  });

  for (const field of ["runId", "artifactId"] as const) {
    it(`refuses a foreign ${field} from an injected reader before exposing a download`, async () => {
      const foreign = "00000000-0000-4000-8000-000000000999";
      await mountHarness(0, async (runId, artifactId) => {
        const value = available(runId, artifactId);
        // Injection bypasses the wire parser: keep the URL correct to isolate echoed-id validation.
        return field === "runId"
          ? { ...value, runId: RunIdSchema.parse(foreign) }
          : { ...value, artifactId: ArtifactIdSchema.parse(foreign) };
      });
      assert.match(document.body.textContent ?? "", /did not match the capture that was requested/u);
      assert.equal(document.querySelector("a[download]"), null);
      assert.equal(document.querySelector("img"), null);
      assert.match(document.body.textContent ?? "", /node-0/u);
    });
  }
});

import { SavedArchiveWorkspace } from "../../../src/dashboard/surfaces/archive-report.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { FIXTURE_SAVED_REPORT, FIXTURE_SAVED_VERSIONS } from "../../parity/helpers/fixture-archive.js";

it("keeps generic loading, empty, deleted and failed responses distinct, and discards a stale detail response", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); mounted = root;
  const pending = new Map<string, (response: Response) => void>();
  const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl: async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/archive/reports") return new Response(JSON.stringify({ items: [], next: null }));
    if (path === "/api/v1/archive/versions") return new Response(JSON.stringify(FIXTURE_SAVED_VERSIONS));
    return new Promise<Response>(resolve => pending.set(path, resolve));
  } });
  const render = async (selection: string) => { await act(async () => root.render(createElement(DashboardClientProvider, { client,
    children: createElement(SavedArchiveWorkspace, { selection, view: "runs", actorId: "local-operator", onSelection: noop, onView: noop, onClose: noop }),
  }))); };
  const first = FIXTURE_SAVED_REPORT.runId, second = "00000000-0000-4000-8000-000000008899";
  await render(first);
  assert.match(container.textContent ?? "", /No saved reports match this query/);
  assert.match(container.textContent ?? "", /Loading saved report/);
  await render(second);
  const resolve = (id: string, body: unknown, status = 200) => { const reply = pending.get(`/api/v1/archive/reports/${id}`); assert.ok(reply); reply(new Response(JSON.stringify(body), { status })); };
  await act(async () => resolve(second, { state: "deleted", runId: second, reason: "This run was explicitly deleted." }));
  await act(async () => resolve(first, FIXTURE_SAVED_REPORT));
  assert.match(container.textContent ?? "", /explicitly deleted/);
  assert.doesNotMatch(container.textContent ?? "", /Synthetic saved lookup/);
  await render(first);
  await act(async () => resolve(first, { state: "error", code: "STALE_REPORT", message: "Saved report authority is stale.", retryable: false }, 409));
  assert.match(container.textContent ?? "", /Saved report authority is stale/);
  assert.doesNotMatch(container.textContent ?? "", /explicitly deleted/);
});

// H: filtering retains indexed fields, never reconstructs an old page locally.
import { savedFilterQuery } from "../../../src/dashboard/surfaces/archive-report-model.js";
it("retains exact title/version/outcome filters while replacing workflow and dropping pagination", () => {
  const query = savedFilterQuery({ limit: 50, title: "Exact retained title", descriptorVersion: "7", outcome: "interrupted", after: { runId: "00000000-0000-4000-8000-000000000081", completedAt: "2026-08-01T12:00:00.000Z" } }, "workflow", "removed-workflow");
  assert.deepEqual(query, { limit: 50, title: "Exact retained title", descriptorVersion: "7", outcome: "interrupted", workflow: "removed-workflow" });
});
