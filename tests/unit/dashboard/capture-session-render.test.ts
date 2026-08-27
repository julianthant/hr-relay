// @vitest-environment jsdom
/**
 * The desktop capture panel as an operator actually meets it (D274 item 7,
 * ledger 3 §7 CP5/CP9/CP21).
 *
 * `capture-session-model.test.ts` pins what the folds DECIDE. What no fold on
 * either side can see is the three-state arm between them: this panel FETCHES,
 * and a surface that fetches has a loading state, a loaded state and a REFUSAL
 * — and the refusal is the one this repo cares about, because "we could not ask
 * the server" and "no capture is open" occupy the same blank space and only one
 * of them means the operator has nothing to look at.
 *
 * It also pins the one claim that lives in the JSX rather than in a fold: that
 * the two failure arms reach the screen as TWO regions with two sentences. A
 * component that mapped both alerts into one banner would leave every fold test
 * green.
 *
 * Third file in the unit lane to render React, for the reason the other two
 * give: the standing rule that behaviour belongs to the parity lane holds for
 * PIXELS, and none of the claims below is about a pixel. Each was run against a
 * mutation of the line it pins.
 */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import {
  CaptureOperatorSessionListWireSchema,
  CaptureOperatorSessionWireSchema,
  type CaptureOperatorSessionListWire,
  type CaptureOperatorSessionWire,
} from "../../../src/domain/capture-operator.js";
import { DashboardClientError } from "../../../src/dashboard/client/index.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { CaptureSessionPanel } from "../../../src/dashboard/surfaces/capture-session.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const WORKFLOW = "fixture-workflow";
const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const ARTIFACT_ID = "99999999-8888-4777-8666-555555555555";
const NOW = "2026-08-26T10:00:00.000Z";
const LATER = "2026-08-26T11:00:00.000Z";

function photoId(ordinal: number): string {
  return `aaaaaaaa-0000-4000-8000-00000000000${ordinal.toString(16)}`;
}

const ACTIVE: CaptureOperatorSessionListWire = CaptureOperatorSessionListWireSchema.parse({
  wireVersion: 1,
  sessions: [{
    sessionId: SESSION_ID,
    workflow: WORKFLOW,
    state: "open",
    phase: "receiving",
    pageCount: 3,
    createdAt: NOW,
    connectedAt: NOW,
    expiresAt: LATER,
    version: 4,
  }],
});

const EMPTY_LIST: CaptureOperatorSessionListWire =
  CaptureOperatorSessionListWireSchema.parse({ wireVersion: 1, sessions: [] });

const SESSION_ID_2 = "22222222-3333-4444-8555-666666666666";

/** Two active sessions, so the picker has something to lose. */
const TWO_ACTIVE: CaptureOperatorSessionListWire = CaptureOperatorSessionListWireSchema.parse({
  wireVersion: 1,
  sessions: [
    {
      sessionId: SESSION_ID,
      workflow: WORKFLOW,
      state: "open",
      phase: "receiving",
      pageCount: 3,
      createdAt: NOW,
      connectedAt: NOW,
      expiresAt: LATER,
      version: 4,
    },
    {
      sessionId: SESSION_ID_2,
      workflow: WORKFLOW,
      state: "open",
      phase: "awaiting-pages",
      pageCount: 0,
      createdAt: NOW,
      connectedAt: NOW,
      expiresAt: LATER,
      version: 1,
    },
  ],
});

/** One readable page, one the bundler refused, one the store could not read back. */
const MIXED: CaptureOperatorSessionWire = CaptureOperatorSessionWireSchema.parse({
  wireVersion: 1,
  sessionId: SESSION_ID,
  workflow: WORKFLOW,
  state: "open",
  phase: "receiving",
  connectedAt: NOW,
  pages: [
    { photoId: photoId(1), ordinal: 1, mediaType: "image/jpeg", bytes: 421_000, artifactId: ARTIFACT_ID, image: { state: "readable", pixelWidth: 1700, pixelHeight: 2200 } },
    { photoId: photoId(2), ordinal: 2, mediaType: "image/jpeg", bytes: 900, artifactId: ARTIFACT_ID, image: { state: "unreadable", reason: "the JPEG marker segment is truncated" } },
    { photoId: photoId(3), ordinal: 3, mediaType: "image/jpeg", bytes: 12_000, artifactId: ARTIFACT_ID, image: { state: "unavailable", reason: "the artifact failed its integrity check" } },
  ],
  handoff: { state: "pending" },
  finalizationGeneration: 0,
  version: 7,
  createdAt: NOW,
  expiresAt: LATER,
});

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
});

interface Stubs {
  readonly activeCaptureSessions: () => Promise<CaptureOperatorSessionListWire>;
  readonly captureSession?: () => Promise<CaptureOperatorSessionWire>;
}

async function mount(stubs: Stubs): Promise<string> {
  host = document.createElement("div");
  document.body.append(host);
  const client = stubs as unknown as DashboardClient;
  const element = createElement(DashboardClientProvider, {
    client,
    children: createElement(CaptureSessionPanel, { workflowId: WORKFLOW }),
  });
  await act(async () => {
    root = createRoot(host as HTMLElement);
    root.render(element);
  });
  // One more flush: the list resolves, the panel latches its selection, and the
  // session read it triggers settles on the next microtask turn.
  await act(async () => { await Promise.resolve(); });
  return host.textContent ?? "";
}

function mounted(): HTMLElement {
  if (host === undefined) throw new Error("mount() has not run");
  return host;
}

/** A promise that never settles — the render is frozen in its loading arm. */
function pending<Value>(): Promise<Value> {
  return new Promise<Value>(() => undefined);
}

function refusal(message: string): DashboardClientError {
  return new DashboardClientError({ kind: "http", status: 404, message, retryable: false });
}

describe("the three arms before a session is on screen", () => {
  it("loads rather than declaring nothing open", async () => {
    const text = await mount({ activeCaptureSessions: pending<CaptureOperatorSessionListWire> });
    assert.equal(text.includes("No capture session is open"), false);
    assert.equal(mounted().querySelectorAll("[data-slot='skeleton'], .animate-pulse").length > 0, true);
  });

  it("names a refused list, and says nothing below is missing", async () => {
    const text = await mount({
      activeCaptureSessions: () => Promise.reject(refusal("the capture service is not composed")),
    });
    assert.match(text, /could not be read/);
    assert.match(text, /the capture service is not composed/);
    assert.match(text, /nothing below was asked for/);
    // The negative control: a refusal must NEVER read as an empty capture list.
    assert.equal(text.includes("No capture session is open"), false);
  });

  it("says nothing is open only when the server actually said so", async () => {
    const text = await mount({ activeCaptureSessions: () => Promise.resolve(EMPTY_LIST) });
    assert.match(text, /No capture session is open/);
  });

  it("names a refused SESSION read separately from a refused list", async () => {
    const text = await mount({
      activeCaptureSessions: () => Promise.resolve(ACTIVE),
      captureSession: () => Promise.reject(refusal("capture session is not in authority")),
    });
    assert.match(text, /This capture session could not be read/);
    assert.match(text, /not in authority/);
    assert.equal(text.includes("No capture session is open"), false);
  });
});

describe("the loaded session", () => {
  const stubs: Stubs = {
    activeCaptureSessions: () => Promise.resolve(ACTIVE),
    captureSession: () => Promise.resolve(MIXED),
  };

  it("draws the phase, the meta line and the contact sheet", async () => {
    const text = await mount(stubs);
    assert.match(text, /Receiving pages/);
    assert.match(text, /expires/);
    const sheet = mounted().querySelector("ul[aria-label='Pages received']");
    assert.equal(sheet === null, false);
    assert.equal(sheet?.querySelectorAll("li").length, 3);
  });

  it("keeps unreadable and unavailable as TWO regions with two instructions", async () => {
    // The claim no fold can make: a component that mapped both alerts into one
    // banner, or reused one instruction for both, leaves every fold test green.
    const text = await mount(stubs);
    // Two DISTINCT titles: "could not be read" and "could not be read back"
    // are not the same sentence, and the surface may never collapse them.
    assert.equal(text.includes("Page 2 could not be readPage 2 \u2014"), true);
    assert.equal(text.includes("Page 3 could not be read backPage 3 \u2014"), true);
    assert.match(text, /photograph it again/);
    assert.match(text, /will not clear it/);
    assert.match(text, /Nothing is known about what these bytes hold/);
  });

  it("carries no image element and no byte source anywhere (no page is drawn)", async () => {
    await mount(stubs);
    assert.equal(mounted().querySelectorAll("img, canvas, image").length, 0);
    assert.doesNotMatch(mounted().innerHTML, /\bsrc=|url\(/);
  });

  it("spends no success token on a surface where nothing has been read (CP59)", async () => {
    await mount(stubs);
    assert.doesNotMatch(mounted().innerHTML, /ds-success/);
  });

  it("names each page from served facts, with no arrival clock or filename", async () => {
    await mount(stubs);
    const names = [...mounted().querySelectorAll("ul[aria-label='Pages received'] button")]
      .map((tile) => tile.getAttribute("aria-label") ?? "");
    assert.deepEqual(names, [
      "Page 1 of 3 — 411.1 KB, 1700 by 2200",
      "Page 2 of 3 — 900 B, flagged unreadable",
      "Page 3 of 3 — 11.7 KB, could not be read back",
    ]);
  });

  it("gives the readable page its own frame shape and the unparsed ones none", async () => {
    await mount(stubs);
    const frames = [...mounted().querySelectorAll("ul[aria-label='Pages received'] button > span[aria-hidden]")];
    assert.equal(frames.length, 3);
    assert.equal((frames[0] as HTMLElement).style.aspectRatio, "1700 / 2200");
    assert.equal((frames[1] as HTMLElement).style.aspectRatio, "");
    assert.equal((frames[2] as HTMLElement).style.aspectRatio, "");
  });

  it("offers no picker for a single session, and the ⓘ rule on demand", async () => {
    const text = await mount(stubs);
    assert.equal(mounted().querySelector("select"), null);
    // The rule is DISCLOSED, not standing copy — but it must be reachable.
    assert.equal(text.includes("never the bytes themselves"), false);
    const info = mounted().querySelector("button[aria-expanded]");
    assert.equal(info === null, false);
    await act(async () => { (info as HTMLButtonElement).click(); });
    assert.match(mounted().textContent ?? "", /never the bytes themselves/);
  });

  it("wires the ⓘ's aria-controls to the disclosed Well it opens", async () => {
    await mount(stubs);
    const info = mounted().querySelector("button[aria-expanded]");
    const controls = info?.getAttribute("aria-controls");
    assert.equal(typeof controls === "string" && controls.length > 0, true);
    await act(async () => { (info as HTMLButtonElement).click(); });
    const panel = document.getElementById(controls as string);
    assert.equal(panel === null, false);
    assert.match(panel?.textContent ?? "", /never the bytes themselves/);
  });

  it("gives a flagged tile a hover tint, not just a click handler", async () => {
    await mount(stubs);
    const tiles = [...mounted().querySelectorAll("ul[aria-label='Pages received'] > li > button")];
    const unreadable = tiles[1];
    const unavailable = tiles[2];
    assert.equal(unreadable?.className.includes("hover:brightness-125"), true);
    assert.equal(unavailable?.className.includes("hover:brightness-125"), true);
  });
});

describe("a failed list poll while a session is latched", () => {
  it("keeps the prior picker options and surfaces an inline failure note, never folding to []", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const text = await mount({
        activeCaptureSessions: () => {
          calls += 1;
          return calls === 1
            ? Promise.resolve(TWO_ACTIVE)
            : Promise.reject(refusal("the capture service could not be reached"));
        },
        captureSession: () => Promise.resolve(MIXED),
      });

      // Before the second poll: two sessions, so the picker is offered.
      assert.equal(mounted().querySelectorAll("select option").length, 2);
      assert.equal(text.includes("Receiving pages"), true);

      // Advance past the list's poll interval — the SECOND call rejects.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      const after = mounted().textContent ?? "";
      // The negative control: a failed poll must NEVER collapse the picker to
      // nothing, and the panel must NEVER read as "no capture session is open"
      // while one is latched.
      assert.equal(mounted().querySelectorAll("select option").length, 2);
      assert.equal(after.includes("No capture session is open"), false);
      // An inline failure note is on screen, naming the server's own words.
      assert.match(after, /could not be reached/);
      // The latched session's own contact sheet is still drawn underneath it.
      assert.equal(after.includes("Receiving pages"), true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a capture for another workflow is out of scope, not hidden", () => {
  it("does not offer a session the operator's intake screen cannot use", async () => {
    const foreign = CaptureOperatorSessionListWireSchema.parse({
      wireVersion: 1,
      sessions: [{ ...ACTIVE.sessions[0], workflow: "some-other-workflow" }],
    });
    const text = await mount({
      activeCaptureSessions: () => Promise.resolve(foreign),
      // Reaching this stub at all would mean the filter did not hold.
      captureSession: () => Promise.reject(new Error("a foreign session must never be read")),
    });
    assert.match(text, /No capture session is open/);
  });
});
