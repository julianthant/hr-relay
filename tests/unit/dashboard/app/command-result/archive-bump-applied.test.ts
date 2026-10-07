/**
 * The applied-bump banner (unit F10c, ledger 3 VB43/VB44 and AR241; unit
 * F10d finding 3).
 *
 * Apply settled in silence: the index re-read, the plan left `plans`, and
 * nothing on screen said the act had happened or where its runs had gone.
 * Nothing could fail on that — a surface that redraws after a command looks
 * exactly like one that reported success — so what is pinned here is the pair
 * of arms, and the negative control is the one that would otherwise pass for
 * the wrong reason: a MINOR bump archives nothing (D274 item 2), so its banner
 * may not offer a door onto rows that do not exist.
 *
 * D253's rule is that a wire result is turned into a verdict in exactly ONE
 * place — `settleCommandResult` — and every surface reads its answer rather
 * than re-deriving the same question from `result.state`. `BumpAppliedBanner`
 * used to read `result.state === "already-applied"` directly; it now takes
 * only the settled `replayed` boolean and never receives the raw
 * `CommandResult` at all, so there is no wire left inside the component for a
 * future edit to re-derive from.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { settleCommandResult } from "../../../../../src/dashboard/app/command-result.js";
import { BumpAppliedBanner } from "../../../../../src/dashboard/surfaces/archive.js";
import { CommandResultSchema, type CommandResult } from "../../../../../src/rules/commands/commands.js";

const noop = (): void => undefined;

const APPLIED = CommandResultSchema.parse({
  state: "applied",
  commandId: "aa11bb22-0009-4000-8000-aa11bb220009",
  affectedTargets: [{ family: "version-archive", versionPlanId: "aa11bb22-0007-4000-8000-aa11bb220007" }],
});

const REPLAYED = CommandResultSchema.parse({ ...APPLIED, state: "already-applied" });

function markup(replayed: boolean, kind: "major" | "minor" | undefined, archived: number): string {
  return renderToStaticMarkup(createElement(BumpAppliedBanner, {
    replayed,
    applied: { archived, kind },
    onOpenArchive: noop,
  }));
}

/** The one place a `CommandResult` becomes this banner's `replayed` boolean. */
function replayedOf(result: CommandResult): boolean {
  const settlement = settleCommandResult(result);
  assert.equal(settlement.kind, "applied");
  return settlement.kind === "applied" ? settlement.replayed : false;
}

describe("the applied-bump banner", () => {
  it("says how many runs left, and offers the archive after a major bump", () => {
    const html = markup(replayedOf(APPLIED), "major", 3);
    assert.equal(html.includes("The bump was applied"), true);
    assert.equal(html.includes("3 runs left the live surfaces"), true);
    assert.equal(html.includes("Open the archive"), true);
  });

  it("offers NO archive door after a minor bump, which archives nothing", () => {
    const html = markup(replayedOf(APPLIED), "minor", 0);
    assert.equal(html.includes("Open the archive"), false);
    assert.equal(html.includes("archives nothing"), true);
    // and it may not claim runs moved
    assert.equal(html.includes("left the live surfaces"), false);
  });

  it("keeps the door for a generation-1 plan that recorded no kind", () => {
    // `undefined` is not "minor": a plan with no recorded kind archived its
    // candidates like any other, so suppressing the door would hide them.
    const html = markup(replayedOf(APPLIED), undefined, 1);
    assert.equal(html.includes("Open the archive"), true);
    assert.equal(html.includes("1 run left the live surfaces"), true);
  });

  it("distinguishes a replay from a fresh application, by the SETTLEMENT's verdict", () => {
    assert.equal(markup(replayedOf(REPLAYED), "major", 2).includes("That bump had already been applied"), true);
    assert.equal(markup(replayedOf(APPLIED), "major", 2).includes("That bump had already been applied"), false);
  });

  it("draws the title from the `replayed` prop alone, not from any re-read wire state", () => {
    // The component receives no `CommandResult` at all (see the props type
    // above) — so distinct results that settle to the SAME `replayed` verdict
    // must draw identically, which is the negative control for "the fold's
    // verdict is the one consumed" rather than a second reading of the wire.
    assert.equal(markup(true, "major", 1), markup(true, "major", 1));
    assert.equal(markup(false, "major", 1), markup(false, "major", 1));
  });
});
