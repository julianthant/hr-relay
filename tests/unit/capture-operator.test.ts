/**
 * The operator capture wire contract (D274 item 7, ledger 3 §7 CP2–CP21).
 *
 * Two properties carry this file: the phase fold is TOTAL over the durable
 * state machine and refuses the one corrupt combination by name, and the wire
 * schemas pin their own honesty — a phase that disagrees with its own facts,
 * or a contact sheet whose ordinals are not the page order, refuses to parse.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CaptureOperatorSessionListWireSchema,
  CaptureOperatorSessionSummaryWireSchema,
  CaptureOperatorSessionWireSchema,
  deriveCaptureOperatorPhase,
  type CaptureOperatorPhase,
} from "../../src/domain/capture-operator.js";
import type { CaptureSessionState } from "../../src/domain/capture.js";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const ARTIFACT_ID = "99999999-8888-4777-8666-555555555555";
const PHOTO_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const NOW = "2026-08-26T10:00:00.000Z";
const LATER = "2026-08-26T11:00:00.000Z";

function page(ordinal: number): Record<string, unknown> {
  return {
    photoId: PHOTO_ID,
    ordinal,
    mediaType: "image/jpeg",
    bytes: 123,
    artifactId: ARTIFACT_ID,
    image: { state: "readable", pixelWidth: 16, pixelHeight: 12 },
  };
}

function sessionWire(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    wireVersion: 1,
    sessionId: SESSION_ID,
    workflow: "fixture-workflow",
    state: "open",
    phase: "awaiting-phone",
    pages: [],
    handoff: { state: "pending" },
    finalizationGeneration: 0,
    version: 1,
    createdAt: NOW,
    expiresAt: LATER,
    ...overrides,
  };
}

describe("the phase fold is total and honest", () => {
  const cases: readonly [CaptureSessionState, boolean, number, CaptureOperatorPhase][] = [
    ["open", false, 0, "awaiting-phone"],
    ["open", true, 0, "awaiting-pages"],
    ["open", true, 2, "receiving"],
    ["finalizing", true, 2, "finalizing"],
    ["finalized", true, 2, "ready"],
    ["failed", true, 2, "blocked"],
    ["discarded", true, 1, "discarded"],
    ["expired", false, 0, "expired"],
    // Terminal states derive from the state ALONE — a discarded session that
    // never connected is still just discarded.
    ["discarded", false, 0, "discarded"],
    ["expired", true, 3, "expired"],
  ];
  for (const [state, connected, pageCount, expected] of cases) {
    it(`${state} / connected=${String(connected)} / ${String(pageCount)} pages → ${expected}`, () => {
      assert.equal(deriveCaptureOperatorPhase({ state, connected, pageCount }), expected);
    });
  }

  it("refuses pages on a session no phone ever touched, by name", () => {
    assert.throws(
      () => deriveCaptureOperatorPhase({ state: "open", connected: false, pageCount: 1 }),
      /records 1 pages but no connectedAt/,
    );
  });
});

describe("the session wire pins its own facts", () => {
  it("parses a coherent wire", () => {
    const parsed = CaptureOperatorSessionWireSchema.parse(sessionWire({
      state: "open",
      phase: "receiving",
      connectedAt: NOW,
      pages: [page(1), { ...page(2), image: { state: "unreadable", reason: "capture photo x is not a JPEG" } }],
    }));
    assert.equal(parsed.phase, "receiving");
    assert.equal(parsed.pages[1]?.image.state, "unreadable");
  });

  it("refuses a phase that disagrees with its own facts", () => {
    assert.throws(
      () => CaptureOperatorSessionWireSchema.parse(sessionWire({ phase: "receiving" })),
      /disagrees with its own facts, which derive awaiting-phone/,
    );
  });

  it("refuses the corrupt pages-without-connect combination instead of narrating it", () => {
    assert.throws(
      () => CaptureOperatorSessionWireSchema.parse(sessionWire({ phase: "receiving", pages: [page(1)] })),
      /records 1 pages but no connectedAt/,
    );
  });

  it("refuses a contact sheet whose ordinals are not contiguous page order", () => {
    assert.throws(
      () => CaptureOperatorSessionWireSchema.parse(sessionWire({
        phase: "receiving",
        connectedAt: NOW,
        pages: [page(2), page(1)],
      })),
      /contiguous ordinal order/,
    );
  });

  it("carries no focus score, filename, or arrival instant — unserved facts are absent, not optional", () => {
    const pageKeys = Object.keys(CaptureOperatorSessionWireSchema.shape.pages.element.shape);
    for (const invented of ["focusScore", "fileName", "arrivedAt", "pairingCode", "deviceLabel"]) {
      assert.ok(!pageKeys.includes(invented), `the page wire must not declare ${invented}`);
    }
    const sessionKeys = Object.keys(CaptureOperatorSessionWireSchema.shape);
    assert.ok(!sessionKeys.includes("token"));
    assert.ok(!sessionKeys.includes("tokenDigest"));
  });
});

describe("the summary wire pins the same derivation", () => {
  it("parses a coherent summary and refuses a lying phase", () => {
    const summary = {
      sessionId: SESSION_ID,
      workflow: "fixture-workflow",
      state: "open",
      phase: "awaiting-pages",
      pageCount: 0,
      createdAt: NOW,
      connectedAt: NOW,
      expiresAt: LATER,
      version: 2,
    };
    const list = CaptureOperatorSessionListWireSchema.parse({ wireVersion: 1, sessions: [summary] });
    assert.equal(list.sessions[0]?.phase, "awaiting-pages");
    assert.throws(
      () => CaptureOperatorSessionSummaryWireSchema.parse({ ...summary, phase: "receiving" }),
      /disagrees with its own facts/,
    );
  });
});
