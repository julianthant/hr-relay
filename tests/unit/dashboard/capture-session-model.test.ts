/**
 * What the DESKTOP capture panel decides, as folds (D274 item 7, ledger 3 §7).
 *
 * `capture-operator.test.ts` pins what the SERVER says. What no server test can
 * see is the reading: whether the surface invents a shape for a page it could
 * not parse, whether the two failure arms stay two on screen, and whether the
 * demo's four unserved facts stay out. Every claim below is a NEGATIVE control
 * as much as a positive one, because each of these defects renders as perfectly
 * grammatical English and only fails beside the wire it came from.
 *
 * Each assertion was run against a mutation of the line it pins.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CaptureOperatorPhaseSchema,
  CaptureOperatorSessionSummaryWireSchema,
  CaptureOperatorSessionWireSchema,
  type CaptureOperatorPageWire,
  type CaptureOperatorSessionSummaryWire,
  type CaptureOperatorSessionWire,
} from "../../../src/domain/capture-operator.js";
import {
  CAPTURE_PHASE,
  CAPTURE_RULE_ITEMS,
  capturePageAlerts,
  capturePageFlag,
  capturePageTileFacts,
  capturePickedPage,
  captureRecordedFacts,
  captureSelectedSessionId,
  captureSessionMetaItems,
  captureSessionOptionLabel,
  captureSessionOptions,
  captureSizeLabel,
  captureEmptySheetDescription,
  endSentence,
} from "../../../src/dashboard/surfaces/capture-session-model.js";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_SESSION_ID = "22222222-3333-4444-8555-666666666666";
const ARTIFACT_ID = "99999999-8888-4777-8666-555555555555";
const NOW = "2026-08-26T10:00:00.000Z";
const LATER = "2026-08-26T11:00:00.000Z";

function photoId(ordinal: number): string {
  return `aaaaaaaa-0000-4000-8000-00000000000${ordinal.toString(16)}`;
}

/** Every fixture is what the STRICT wire schema produced, never a hand-built object. */
function session(overrides: Record<string, unknown>): CaptureOperatorSessionWire {
  return CaptureOperatorSessionWireSchema.parse({
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
  });
}

function summary(overrides: Record<string, unknown>): CaptureOperatorSessionSummaryWire {
  return CaptureOperatorSessionSummaryWireSchema.parse({
    sessionId: SESSION_ID,
    workflow: "fixture-workflow",
    state: "open",
    phase: "awaiting-phone",
    pageCount: 0,
    createdAt: NOW,
    expiresAt: LATER,
    version: 1,
    ...overrides,
  });
}

function pageOf(ordinal: number, image: Record<string, unknown>, bytes = 421_000): Record<string, unknown> {
  return {
    photoId: photoId(ordinal),
    ordinal,
    mediaType: "image/jpeg",
    bytes,
    artifactId: ARTIFACT_ID,
    image,
  };
}

const READABLE = { state: "readable", pixelWidth: 1700, pixelHeight: 2200 };
const UNREADABLE = { state: "unreadable", reason: "the JPEG marker segment is truncated" };
const UNAVAILABLE = { state: "unavailable", reason: "the artifact failed its integrity check" };

/** A session with `connectedAt` and the given pages — the only shape that parses. */
function receiving(images: readonly Record<string, unknown>[]): CaptureOperatorSessionWire {
  return session({
    connectedAt: NOW,
    phase: images.length === 0 ? "awaiting-pages" : "receiving",
    pages: images.map((image, index) => pageOf(index + 1, image)),
  });
}

function pagesOf(wire: CaptureOperatorSessionWire): readonly CaptureOperatorPageWire[] {
  return wire.pages;
}

/** The first page, or a throw — never an index cast that hides an empty fixture. */
function firstPage(wire: CaptureOperatorSessionWire): CaptureOperatorPageWire {
  const page = wire.pages[0];
  if (page === undefined) throw new Error("this fixture has no pages, so there is nothing to fold");
  return page;
}

describe("the phase vocabulary is total, and spends no success tone", () => {
  it("covers every served phase in BOTH directions", () => {
    // A seventh arm on the wire must be a typecheck failure and a red test,
    // never a silent default — and a label left behind for a retired arm is
    // just as much a lie as a missing one.
    assert.deepEqual(
      Object.keys(CAPTURE_PHASE).sort(),
      [...CaptureOperatorPhaseSchema.options].sort(),
    );
  });

  it("never reaches for success, and never draws a check (CP59)", () => {
    for (const [phase, spec] of Object.entries(CAPTURE_PHASE)) {
      assert.equal(
        (["neutral", "warning"] as string[]).includes(spec.tone),
        true,
        `${phase} spends a tone outside neutral/warning`,
      );
      assert.doesNotMatch(spec.label, /\b(accepted|verified|good|ok)\b/i, `${phase}'s label claims a verdict`);
    }
  });

  it("refuses the demo's wording where the same word means something else here", () => {
    // `ready` here is the durable `finalized` state — the bundle is MADE, not
    // waiting to be. `blocked` is the finalization failing, not a bad page.
    assert.equal(CAPTURE_PHASE.ready.label, "Bundled and queued");
    assert.doesNotMatch(CAPTURE_PHASE.blocked.label, /read/i);
  });
});

describe("a byte length reads as itself", () => {
  it("prints sub-kilobyte photographs exactly, rather than rounding them to zero", () => {
    assert.equal(captureSizeLabel(0), "0 B");
    assert.equal(captureSizeLabel(900), "900 B");
  });

  it("scales to KB and MB", () => {
    assert.equal(captureSizeLabel(421_000), "411.1 KB");
    assert.equal(captureSizeLabel(3_500_000), "3.3 MB");
  });

  it("throws on a length that is not one", () => {
    assert.throws(() => captureSizeLabel(-1), /which is not a byte length/);
    assert.throws(() => captureSizeLabel(Number.NaN), /which is not a byte length/);
  });
});

describe("a served sentence is closed before this surface's own words follow it", () => {
  it("adds the stop a server message did not carry", () => {
    assert.equal(endSentence("the JPEG marker segment is truncated"), "the JPEG marker segment is truncated.");
  });

  it("does not double one that already closes", () => {
    for (const closed of ["already ended.", "really?", "no!"]) {
      assert.equal(endSentence(closed), closed);
    }
  });

  it("refuses an empty reason rather than drawing a bare bullet", () => {
    assert.throws(() => endSentence("   "), /is empty/);
  });
});

describe("a page tile draws only what was served", () => {
  it("takes the page's OWN geometry when the bundler parsed it", () => {
    const facts = capturePageTileFacts(firstPage(receiving([READABLE])), 1);
    assert.equal(facts.aspectRatio, "1700 / 2200");
    assert.equal(facts.stateLine, "411.1 KB");
    assert.equal(facts.flag, "none");
  });

  it("invents NO shape for a page whose bytes would not parse", () => {
    // The defect this pins is a letterboxed US Letter frame standing in for a
    // page nobody could read — the surface drawing the one thing it is looking
    // at. Both failure arms must carry no ratio at all.
    for (const image of [UNREADABLE, UNAVAILABLE]) {
      const facts = capturePageTileFacts(firstPage(receiving([image])), 1);
      assert.equal(facts.aspectRatio, undefined, `${String(image.state)} carried a fabricated shape`);
    }
  });

  it("keeps the two failure arms distinct on the tile itself", () => {
    const unreadable = capturePageTileFacts(firstPage(receiving([UNREADABLE])), 1);
    const unavailable = capturePageTileFacts(firstPage(receiving([UNAVAILABLE])), 1);
    assert.equal(unreadable.flag, "unreadable");
    assert.equal(unavailable.flag, "unavailable");
    assert.notEqual(unreadable.stateLine, unavailable.stateLine);
    assert.notEqual(unreadable.accessibleName, unavailable.accessibleName);
  });

  it("composes an accessible name from served facts and NOTHING else (CP14)", () => {
    const wire = receiving([READABLE, UNREADABLE]);
    const [first, second] = pagesOf(wire);
    assert.equal(
      capturePageTileFacts(first, 2).accessibleName,
      "Page 1 of 2 — 411.1 KB, 1700 by 2200",
    );
    // The demo's name carried an arrival clock and a filename. Neither has a
    // producer here, and the negative control is that neither leaks back in as
    // a plausible-looking blank.
    const name = capturePageTileFacts(second, 2).accessibleName;
    assert.equal(name, "Page 2 of 2 — 411.1 KB, flagged unreadable");
    assert.doesNotMatch(name, /arrived|\.jpe?g|focus/i);
  });

  it("reports the flag off the served image state", () => {
    const wire = receiving([READABLE, UNREADABLE, UNAVAILABLE]);
    assert.deepEqual(pagesOf(wire).map(capturePageFlag), ["none", "unreadable", "unavailable"]);
  });
});

describe("the recorded-facts list", () => {
  it("never carries a row with no producer", () => {
    const wire = receiving([READABLE]);
    const keys = captureRecordedFacts(firstPage(wire), 1).map((fact) => fact.key);
    assert.deepEqual(keys, ["Page", "Pixels", "Size", "Type"]);
    // An optional row that never fills is a permanent blank the eye reads as a
    // value nobody bothered to fetch.
    for (const absent of ["Arrived", "File", "Read"]) {
      assert.equal(keys.includes(absent), false, `${absent} has no producer and must not be a row`);
    }
  });

  it("drops Pixels — rather than blanking it — when the geometry was not parsed", () => {
    for (const image of [UNREADABLE, UNAVAILABLE]) {
      const facts = captureRecordedFacts(firstPage(receiving([image])), 1);
      assert.equal(facts.some((fact) => fact.key === "Pixels"), false);
    }
  });

  it("gives the two failure arms two different Read verdicts and two different tones", () => {
    const unreadable = captureRecordedFacts(firstPage(receiving([UNREADABLE])), 1)
      .find((fact) => fact.key === "Read");
    const unavailable = captureRecordedFacts(firstPage(receiving([UNAVAILABLE])), 1)
      .find((fact) => fact.key === "Read");
    assert.notEqual(unreadable, undefined);
    assert.notEqual(unavailable, undefined);
    assert.notEqual(unreadable?.value, unavailable?.value);
    assert.equal(unreadable?.tone, "warning");
    assert.equal(unavailable?.tone, "danger");
  });

  it("keeps the served REASON out of the truncating value cell", () => {
    // The list's value cell truncates, so a parser's sentence recovered on a
    // tooltip would be a fact reachable by pointer and by nobody else. It
    // belongs to the banner, which wraps.
    const facts = captureRecordedFacts(firstPage(receiving([UNREADABLE])), 1);
    for (const fact of facts) {
      assert.doesNotMatch(fact.value, /marker segment/);
    }
  });
});

describe("the two failure banners are two banners (CP9)", () => {
  const wire = receiving([READABLE, UNREADABLE, UNAVAILABLE]);

  it("splits the arms rather than counting them together", () => {
    const alerts = capturePageAlerts(pagesOf(wire));
    assert.deepEqual(alerts.map((alert) => alert.kind), ["unreadable", "unavailable"]);
    assert.deepEqual(alerts.map((alert) => alert.tone), ["warning", "danger"]);
  });

  it("never tells the operator to retake a page a STORAGE fault hid", () => {
    // The negative control that matters: both instructions are grammatical
    // English, and only one of them is ever true of a read-back failure.
    const alerts = capturePageAlerts(pagesOf(wire));
    const unavailable = alerts.find((alert) => alert.kind === "unavailable");
    assert.notEqual(unavailable, undefined);
    assert.match(unavailable?.instruction ?? "", /will not clear it/);
    assert.doesNotMatch(unavailable?.instruction ?? "", /photograph it again/);
    assert.notEqual(alerts[0]?.instruction, alerts[1]?.instruction);
  });

  it("names the page in the singular arm and counts in the plural one", () => {
    const one = capturePageAlerts(pagesOf(receiving([READABLE, UNREADABLE])));
    assert.equal(one[0]?.title, "Page 2 could not be read");
    const many = capturePageAlerts(pagesOf(receiving([UNREADABLE, UNREADABLE])));
    assert.equal(many[0]?.title, "2 pages could not be read");
  });

  it("closes the server's own sentence before the product's next clause", () => {
    const alerts = capturePageAlerts(pagesOf(receiving([UNREADABLE])));
    assert.equal(alerts[0]?.reasons[0], "Page 1 — the JPEG marker segment is truncated.");
  });

  it("says nothing at all when every page parsed", () => {
    assert.deepEqual(capturePageAlerts(pagesOf(receiving([READABLE, READABLE]))), []);
  });
});

describe("the session's own facts", () => {
  it("draws three facts before pairing and four after — every one of them served", () => {
    // The `paired` clause is present exactly when `connectedAt` is, and the
    // clocks are the wire's own instants: a blank slot for an unpaired phone
    // would read as a value that failed to load.
    assert.deepEqual(captureSessionMetaItems(session({})), [
      SESSION_ID,
      "opened 3:00 AM",
      "expires 4:00 AM",
    ]);
    assert.deepEqual(captureSessionMetaItems(session({ connectedAt: LATER, phase: "awaiting-pages" })), [
      SESSION_ID,
      "opened 3:00 AM",
      "paired 4:00 AM",
      "expires 4:00 AM",
    ]);
  });

  it("carries no device label, no pairing code and no last-page clock", () => {
    const items = captureSessionMetaItems(receiving([READABLE])).join(" · ");
    for (const unserved of [/pairing code/i, /device/i, /last page/i]) {
      assert.doesNotMatch(items, unserved);
    }
  });

  it("forks the empty sheet on the ONE fact that separates the two readings", () => {
    assert.match(captureEmptySheetDescription(session({})), /has not opened this capture yet/);
    assert.match(
      captureEmptySheetDescription(session({ connectedAt: NOW, phase: "awaiting-pages" })),
      /Take the first page on it/,
    );
  });
});

describe("the picker keeps a capture the active list has dropped (CP2)", () => {
  it("labels an option with its id, its phase and its page count", () => {
    assert.equal(
      captureSessionOptionLabel(SESSION_ID, "receiving", 1),
      `${SESSION_ID} · Receiving pages · 1 page`,
    );
  });

  it("appends the loaded session when it is no longer active", () => {
    // A capture that FINALIZES leaves `listActive` at the exact moment the
    // operator wants to read it. Dropping it from the picker would strand the
    // panel on a session its own control could not name.
    const active = [summary({ sessionId: OTHER_SESSION_ID })];
    const loaded = session({ state: "finalized", phase: "ready", connectedAt: NOW });
    const options = captureSessionOptions(active, loaded);
    assert.deepEqual(options.map((option) => option.sessionId), [OTHER_SESSION_ID, SESSION_ID]);
  });

  it("does not duplicate a loaded session that is still active", () => {
    const options = captureSessionOptions([summary({})], session({}));
    assert.equal(options.length, 1);
  });

  it("honours the operator's pick over the newest active session", () => {
    const active = [summary({ sessionId: SESSION_ID }), summary({ sessionId: OTHER_SESSION_ID })];
    assert.equal(captureSelectedSessionId(active, undefined), OTHER_SESSION_ID);
    assert.equal(captureSelectedSessionId(active, SESSION_ID), SESSION_ID);
    // The latch's whole point: a pick survives its session leaving the list.
    assert.equal(captureSelectedSessionId([], SESSION_ID), SESSION_ID);
    assert.equal(captureSelectedSessionId([], undefined), undefined);
  });
});

describe("the inspected page is keyed to its own session", () => {
  const wire = receiving([READABLE, READABLE, READABLE]);

  it("honours a pick made on THIS session", () => {
    const picked = capturePickedPage(pagesOf(wire), { sessionId: SESSION_ID, ordinal: 3 }, SESSION_ID);
    assert.equal(picked?.ordinal, 3);
  });

  it("ignores a pick made on another session rather than describing a page nobody is looking at", () => {
    const picked = capturePickedPage(pagesOf(wire), { sessionId: OTHER_SESSION_ID, ordinal: 3 }, SESSION_ID);
    assert.equal(picked?.ordinal, 1);
  });

  it("falls back to the first page when the picked ordinal has left", () => {
    const picked = capturePickedPage(pagesOf(receiving([READABLE])), { sessionId: SESSION_ID, ordinal: 9 }, SESSION_ID);
    assert.equal(picked?.ordinal, 1);
  });

  it("has nothing to describe on an empty sheet", () => {
    assert.equal(capturePickedPage([], undefined, SESSION_ID), undefined);
  });
});

describe("the standing rule names the absences out loud (CP4)", () => {
  it("says which four facts this surface does not have", () => {
    const rule = CAPTURE_RULE_ITEMS.join(" ");
    for (const absence of [/filename/i, /arrival time/i, /focus score/i]) {
      assert.match(rule, absence);
    }
    assert.match(rule, /never the bytes themselves/);
    // And it states the distinction the two banners rest on, once.
    assert.match(rule, /unreadable[\s\S]*unavailable/);
  });
});
