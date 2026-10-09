/**
 * §9.20 item 7 / §9.28 — a result row on sight is not a result.
 *
 * WFD renders an Employee Search slat in stages, each an Angular digest apart:
 * the `[role='menuitemradio']` host (no text) → the `krn-slat` skeleton → the
 * `krn-slats-tabular-data` card with its RAW `{{ … }}` bindings → the digest
 * that interpolates them into `Name <name> ID <eid>` (30–108 ms cold, 9–18 ms
 * warm, 214–570 ms under CPU throttle; live 2026-08-27). A poll that accepted
 * the host on sight read `""` inside that gap on 2026-08-19 and the driver
 * refused the row; a poll that accepted the CARD on sight did the same under
 * 20× throttle on 2026-08-27. The verdict below keeps polling until every
 * row's card is in AND interpolated, and still refuses a row whose label
 * carries no identity — the completion signal is WHEN to read, never WHAT
 * was read.
 *
 * Pinned RED before the fix: with the extracted on-sight verdict every
 * `hydrating` case below returned `results`.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  judgeSearchRender,
  parseSlatIdentity,
  slatRenderComplete,
  type SlatRenderFact,
} from "../../../../../../../src/backend/systems/new-kronos/driver/search-render.js";

const COMPLETE: SlatRenderFact = Object.freeze({ label: "Name Cleckoa, Crithe ID 10000001", cardRendered: true });
/** Stage 1: the row exactly as the 2026-08-19 refusal observed it — present, empty, no card. */
const HOST_ONLY: SlatRenderFact = Object.freeze({ label: "", cardRendered: false });
/** Stage 3 as observed under throttle: the card is in, its text nodes are not yet interpolated. */
const CARD_EMPTY: SlatRenderFact = Object.freeze({ label: "", cardRendered: true });
/** Stage 3, the raw bindings the MutationObserver recorded as `old` text on 2026-08-27. */
const CARD_RAW_BINDINGS: SlatRenderFact = Object.freeze({
  label: "{{::row.label ? row.label : row.name}} {{context.data[slatIndex][row.name]}}",
  cardRendered: true,
});

describe("slatRenderComplete — the four stages, only the last of which is readable", () => {
  it("names each mid-render stage as incomplete", () => {
    assert.equal(slatRenderComplete(HOST_ONLY), false);
    assert.equal(slatRenderComplete(CARD_EMPTY), false);
    assert.equal(slatRenderComplete(CARD_RAW_BINDINGS), false);
    // text without the card is not a completed render either — the card is where the identity lives
    assert.equal(slatRenderComplete({ label: "Name Cleckoa, Crithe ID 10000001", cardRendered: false }), false);
  });

  it("a row whose card is in and interpolated is complete", () => {
    assert.equal(slatRenderComplete(COMPLETE), true);
  });
});

describe("judgeSearchRender — the Employee Search render verdict", () => {
  it("no rows is `absent`, so the sentinel logic decides", () => {
    assert.equal(judgeSearchRender([]), "absent");
  });

  it("a host without its card is `hydrating`, not a result", () => {
    assert.equal(judgeSearchRender([HOST_ONLY]), "hydrating");
  });

  it("a card whose bindings have not been interpolated is still `hydrating`", () => {
    assert.equal(judgeSearchRender([CARD_EMPTY]), "hydrating");
    assert.equal(judgeSearchRender([CARD_RAW_BINDINGS]), "hydrating");
  });

  it("one incomplete row among complete ones keeps the whole render `hydrating`", () => {
    assert.equal(judgeSearchRender([COMPLETE, HOST_ONLY, COMPLETE]), "hydrating");
    assert.equal(judgeSearchRender([COMPLETE, CARD_RAW_BINDINGS]), "hydrating");
  });

  it("every row complete is `results`", () => {
    assert.equal(judgeSearchRender([COMPLETE]), "results");
    assert.equal(judgeSearchRender([COMPLETE, { label: "Name Roe, Richard ID 10000002", cardRendered: true }]), "results");
  });
});

describe("parseSlatIdentity — the row's subject, or nothing", () => {
  it("reads `Name <name> ID <eid>` off a completed row's label", () => {
    assert.deepEqual(parseSlatIdentity(COMPLETE.label), { displayName: "Cleckoa, Crithe", employeeId: "10000001" });
    assert.deepEqual(parseSlatIdentity("  Name   Cleckoa,  Crithe \n ID  10000001 "), { displayName: "Cleckoa, Crithe", employeeId: "10000001" });
  });

  it("the empty label the 2026-08-19 run observed carries no subject", () => {
    assert.equal(parseSlatIdentity(HOST_ONLY.label), null);
  });

  it("the raw bindings carry no subject either", () => {
    assert.equal(parseSlatIdentity(CARD_RAW_BINDINGS.label), null);
  });

  it("the nested krn-slat's own accessible name (a name, no EID) is not the identity", () => {
    // Observed live 2026-08-27 on the inner `krn-slat`, one digest BEFORE the
    // tabular card: it names the person but not the EID, and must not pass.
    assert.equal(parseSlatIdentity("Item Name Cleckoa, Crithe not checked"), null);
  });

  it("completion says WHEN to read, never WHAT was read: a complete row with a foreign label still parses to nothing", () => {
    const foreign: SlatRenderFact = { label: "Employee Cleckoa, Crithe #10000001", cardRendered: true };
    assert.equal(judgeSearchRender([foreign]), "results");
    assert.equal(parseSlatIdentity(foreign.label), null);
  });
});
