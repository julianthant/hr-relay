
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
judgeSearchRender,
parseSlatIdentity,
slatRenderComplete,
type SlatRenderFact,
} from "../../../../../src/backend/systems/new-kronos/driver/search-render.js";

const COMPLETE: SlatRenderFact = Object.freeze({ label: "Name Morrow, Bea ID 10000001", cardRendered: true });

const HOST_ONLY: SlatRenderFact = Object.freeze({ label: "", cardRendered: false });
/** Stage 3 as observed under throttle: the card is in, its text nodes are not yet interpolated. */
const CARD_EMPTY: SlatRenderFact = Object.freeze({ label: "", cardRendered: true });

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
    assert.equal(slatRenderComplete({ label: "Name Morrow, Bea ID 10000001", cardRendered: false }), false);
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
    assert.deepEqual(parseSlatIdentity(COMPLETE.label), { displayName: "Morrow, Bea", employeeId: "10000001" });
    assert.deepEqual(parseSlatIdentity("  Name   Morrow,  Bea \n ID  10000001 "), { displayName: "Morrow, Bea", employeeId: "10000001" });
  });

  it("an empty label carries no subject", () => {
    assert.equal(parseSlatIdentity(HOST_ONLY.label), null);
  });

  it("the raw bindings carry no subject either", () => {
    assert.equal(parseSlatIdentity(CARD_RAW_BINDINGS.label), null);
  });

  it("the nested krn-slat's own accessible name (a name, no EID) is not the identity", () => {

    assert.equal(parseSlatIdentity("Item Name Morrow, Bea not checked"), null);
  });

  it("completion says WHEN to read, never WHAT was read: a complete row with a foreign label still parses to nothing", () => {
    const foreign: SlatRenderFact = { label: "Employee Morrow, Bea #10000001", cardRendered: true };
    assert.equal(judgeSearchRender([foreign]), "results");
    assert.equal(parseSlatIdentity(foreign.label), null);
  });
});
