/**
 * ONE refusal notice, TWO ceremonies — and the copy must stay truthful in each
 * (D273 item 10).
 *
 * `park-resolve.tsx` and `identity-approve.tsx` each carried a near-identical
 * `RefusedNotice`. The defect that motivated the merge was not the duplication
 * itself but what duplication does: the park copy's uncoded arm had drifted to
 * repeating its own banner title ("Nothing was recorded and your answer below
 * is untouched") while the gate copy said the fact that was actually still true
 * of the gate. Two sentences describing the same event, one of them empty.
 *
 * This tree renders no React in the unit lane, so a decision left inside a
 * component is pinned only by a screenshot. The copy therefore lives in a pure
 * fold and the assertions below are on the STRINGS, verbatim — a reworded
 * refusal has to come through here.
 */
import { describe, expect, it } from "vitest";
import {
  REFUSED_NOTICE_TITLE,
  refusedNoticeCopy,
  type RefusedCeremony,
} from "../../../../src/dashboard/surfaces/refused-notice-model.js";

const CEREMONIES: readonly RefusedCeremony[] = ["parked-write", "identity-gate"];

describe("refusedNoticeCopy", () => {
  /**
   * The two coded outcomes, byte for byte as the two surfaces drew them before
   * the merge. This is the regression that says the extraction changed no
   * ratified word: both of these strings are lifted from the pre-merge files.
   */
  it("keeps each ceremony's ratified coded outcome exactly", () => {
    expect(refusedNoticeCopy("parked-write").outcome).toBe(
      "the write is still parked · your answer below is untouched",
    );
    expect(refusedNoticeCopy("identity-gate").outcome).toBe(
      "the gate is still open · your answer below is untouched",
    );
  });

  /**
   * The uncoded arm is where the drift was. The gate's sentence is unchanged
   * from what it always said; the park's now states the parked write instead of
   * echoing the banner title above it.
   */
  it("states what is still TRUE of each ceremony in the uncoded arm", () => {
    expect(refusedNoticeCopy("parked-write").uncoded).toBe(
      "The write is still parked and your answer below is untouched — but the server sent no "
      + "refusal code, so there is nothing here to quote in a bug report.",
    );
    expect(refusedNoticeCopy("identity-gate").uncoded).toBe(
      "The gate is still open and your answer below is untouched — but the server sent no "
      + "refusal code, so there is nothing here to quote in a bug report.",
    );
  });

  /**
   * The negative control for the merge itself: if the parameter stopped
   * reaching the copy — a hardcoded clause, a ceremony ignored — both
   * ceremonies would read the same, and the notice would be telling one of the
   * two operators something false about a live HR write. Nothing else in the
   * suite can fail when that happens, because both strings would still be
   * grammatical English.
   */
  it("never gives the two ceremonies the same sentence", () => {
    const [parked, gate] = CEREMONIES.map(refusedNoticeCopy);
    expect(parked).toBeDefined();
    expect(gate).toBeDefined();
    expect(parked?.outcome).not.toBe(gate?.outcome);
    expect(parked?.uncoded).not.toBe(gate?.uncoded);
  });

  /**
   * The park ceremony's uncoded arm may not restate the banner title. That
   * sentence is the exact drift D273 item 10 ruled on, and a future edit that
   * reintroduced it would read fine in a diff.
   */
  it("does not repeat the banner title inside the body", () => {
    for (const ceremony of CEREMONIES) {
      expect(refusedNoticeCopy(ceremony).uncoded).not.toContain(REFUSED_NOTICE_TITLE);
    }
  });

  /**
   * Neither string carries a slot for the server's message. The message is
   * rendered as its own node beside this copy, so a refusal sentence containing
   * a brace or a percent cannot be re-read as a template — and a `${}` that
   * survived into a literal here would ship to an operator as-is.
   */
  it("composes no template slot for the server's own sentence", () => {
    for (const ceremony of CEREMONIES) {
      const copy = refusedNoticeCopy(ceremony);
      expect(copy.outcome).not.toMatch(/[{}%]/);
      expect(copy.uncoded).not.toMatch(/[{}%]/);
    }
  });

  /** The title is one sentence for both arms and both ceremonies. */
  it("names what did not happen", () => {
    expect(REFUSED_NOTICE_TITLE).toBe("Nothing was recorded");
  });
});
