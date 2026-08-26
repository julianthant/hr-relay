/**
 * A row's outcome facts are drawn as CHIPS, and a chip is a single-line token
 * that clips its paint (`ds/primitives-core.tsx`). The full value used to be
 * reachable one way only — the element's `title` — which is a hover surface: a
 * touch user has no hover, and a keyboard user is never shown one. DESIGN.md
 * bans exactly that ("Put load-bearing information in a tooltip only … it goes
 * in the UI or in a Popover"), and the row already HAS the sanctioned Popover.
 *
 * So the ⓘ now carries both halves of the fact story: why a fact is missing,
 * and — the half it was silently short of — what a present fact says IN FULL.
 * The decision is a pure fold so it is pinned here rather than by a screenshot.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-day.js";
import { rowInfoFacts, type QueueSurfaceWire } from "../../../src/dashboard/surfaces/queue-model.js";

const [base] = FIXTURE_DAY_WIRE.queueSurfaces;
if (base === undefined) throw new Error("the parity day fixture must serve at least one queue surface");

const LONG_VALUE = "PPSMTCH-2026-08-26-oath-batch-7-amendment-third-pass-final-corrected";

function withFacts(facts: QueueSurfaceWire["facts"]): QueueSurfaceWire {
  return { ...base, facts };
}

describe("the ⓘ's fact list (the chip's clipped value, reachable without a mouse)", () => {
  it("carries a present fact's FULL value, not the label alone", () => {
    const entries = rowInfoFacts(withFacts({
      state: "present",
      value: [{ label: "Match", value: LONG_VALUE }],
    }));
    const match = entries.find((entry) => entry.label === "Match");
    assert.equal(match?.state, "present");
    assert.equal(
      match?.text,
      LONG_VALUE,
      "the popover exists to un-clip the chip, so it must hold the whole value verbatim",
    );
  });

  it("still reports an absent fact by the SERVER's reason, never as a blank", () => {
    const entries = rowInfoFacts(withFacts({ state: "absent", reason: "the run produced no outcome yet" }));
    const outcome = entries.find((entry) => entry.label === "Outcome");
    assert.equal(outcome?.state, "absent");
    assert.equal(outcome?.text, "the run produced no outcome yet");
    assert.equal(
      entries.some((entry) => entry.state === "present" && entry.label === "Match"),
      false,
      "an absent fact set has no values to un-clip",
    );
  });

  it("keeps absence and value distinguishable rather than folding both into one string", () => {
    const entries = rowInfoFacts(withFacts({
      state: "present",
      value: [{ label: "Match", value: "one" }, { label: "Filed", value: "two" }],
    }));
    assert.deepEqual(
      entries.filter((entry) => entry.state === "present").map((entry) => [entry.label, entry.text]),
      [["Match", "one"], ["Filed", "two"]],
      "every served fact is listed, in the order the server sent them",
    );
  });
});
