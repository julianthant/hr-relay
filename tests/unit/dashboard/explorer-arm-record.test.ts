/**
 * D304 — the task record lives INSIDE the arm's card, headed once, with
 * `Freshness` and `Provenance` gone (they are the Outputs group head) and its
 * facts drawn as wrapping lines rather than clipped chips.
 *
 * Every claim here is about the rendered tree, so the instrument is
 * `renderToStaticMarkup` over the REAL projection, and each case was run
 * against the record this replaces: there the arm id appeared twice (card head
 * and record head), both policy rows were present, and every error code sat
 * inside a `whitespace-nowrap` token.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import type { ExplorerWorkflowWire } from "../../../src/domain/dashboard/explorer.js";
import { buildWorkflowExplorer } from "../../../src/server/dashboard/queries/explorer.js";
import { explorerQueryDeps } from "../../fixtures/explorer-seams.js";
import { NodeDetail } from "../../../src/dashboard/surfaces/explorer/explorer.js";

const CLOCK = manualClock(new Date("2026-08-09T12:00:00.000Z"));
const HASH = FingerprintSchema.parse("b".repeat(64));

/** A served node whose read arm declares both policies and names UI ids and errors. */
function servedNode(): { workflow: ExplorerWorkflowWire; node: ExplorerWorkflowWire["nodes"][number] } {
  for (const workflow of buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH)).workflows) {
    const node = workflow.nodes.find((one) => one.tasks.some((task) =>
      task.effect === "read"
        && task.freshness !== undefined
        && task.provenance !== undefined
        && task.ui.length >= 2
        && task.errorCodes.length >= 2));
    if (node !== undefined) return { workflow, node };
  }
  throw new Error("no served read arm declares both policies with two UI ids and two error codes");
}

function render(): { html: string; node: ExplorerWorkflowWire["nodes"][number] } {
  const { workflow, node } = servedNode();
  return { html: renderToStaticMarkup(createElement(NodeDetail, { workflow, node })), node };
}

describe("D304 — the arm record is drawn inside the arm's card", () => {
  it("heads each arm exactly once", () => {
    const { html, node } = render();
    for (const task of node.tasks) {
      // The id as a TEXT node: the card head. Aria labels carry it with a
      // suffix (`… contract`, `… inputs`) and do not match `>id<`.
      const count = html.split(`>${String(task.taskId)}<`).length - 1;
      assert.equal(count, 1, `arm ${String(task.taskId)} is headed ${String(count)} times`);
    }
  });

  it("draws the record AFTER the arm's field groups, inside the same card", () => {
    const { html, node } = render();
    const task = node.tasks.find((one) => one.effect === "read");
    if (task === undefined) throw new Error("no read arm");
    const card = html.indexOf(`aria-label="${String(task.taskId)} contract"`);
    const outputs = html.indexOf(`aria-label="${String(task.taskId)} outputs"`, card);
    const record = html.indexOf("Implemented by", outputs);
    assert.ok(card >= 0 && outputs > card && record > outputs, "the record must follow the outputs group in the card");
    // …and it is inside the card: the NEXT card's group (or the contract
    // section's end) comes after it. The first `role="group"` after `card` is
    // this card's own tag, so the next card is the one after that.
    const thisGroup = html.indexOf('role="group"', card);
    const nextGroup = html.indexOf('role="group"', thisGroup + 1);
    const sectionEnd = html.indexOf("</section>", card);
    assert.ok(nextGroup === -1 || record < nextGroup, "the record escaped its arm's card");
    assert.ok(sectionEnd > record, "the record escaped the contract section");
  });

  it("no longer draws Freshness or Provenance rows — they are the Outputs head", () => {
    const { html } = render();
    assert.equal(html.includes(">Freshness<"), false);
    assert.equal(html.includes(">Provenance<"), false);
    // The negative control's other half: the fact is still on the page, once
    // per arm, on the group head — D302's pin counts that.
    assert.equal(html.includes("Outputs · "), true);
  });

  it("draws error codes and UI ids as wrapping text, never inside a single-line token", () => {
    const { html, node } = render();
    const task = node.tasks.find((one) => one.effect === "read" && one.ui.length >= 2);
    if (task === undefined) throw new Error("no read arm with UI ids");
    for (const value of [...task.errorCodes, ...task.ui.map((link) => link.catalogId)]) {
      const at = html.indexOf(`>${value}<`);
      assert.ok(at >= 0, `${value} must be printed whole as its own text node`);
      // The nearest enclosing element must not be a clipping token. Walk back
      // to the opening tag of the span that holds the value.
      const open = html.lastIndexOf("<span", at);
      const tag = html.slice(open, at + 1);
      assert.equal(tag.includes("whitespace-nowrap"), false, `${value} sits in a clipping token`);
      assert.equal(tag.includes("truncate"), false, `${value} sits in a truncating span`);
    }
  });

  it("groups UI ids by kind with the kind named once per line", () => {
    const { html, node } = render();
    const task = node.tasks.find((one) => one.effect === "read" && one.ui.length >= 2);
    if (task === undefined) throw new Error("no read arm with UI ids");
    const kinds = new Set(task.ui.map((link) => link.kind));
    for (const kind of kinds) {
      // The kind label is rendered as `kind ` (trailing space) in the muted ink.
      const count = html.split(`>${kind} <`).length - 1;
      assert.equal(count, 1, `kind ${kind} is labelled ${String(count)} times for one arm`);
    }
  });
});
