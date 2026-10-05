/**
 * The applied-bump banner's door (unit F10d finding 2).
 *
 * `onOpenArchive={() => onView("runs")}` switched the workspace back to the
 * runs ledger without touching whatever filter the operator had left
 * standing there — a text, workflow or status query from an earlier visit
 * that could hide every run the sweep this door names just archived. Nothing
 * could fail on that: a filtered ledger renders exactly as an unfiltered one
 * whenever the filter happens not to hide the interesting rows, and the two
 * halves of the wiring — `query`/`setQuery` on one side, `onOpenArchive` on
 * the other — are both `ArchiveWorkspace`'s own local state, never passed to
 * `VersionsView` or `BumpAppliedBanner` at all. So no fold and no render of
 * either component could ever see this; the assertion has to read the JSX
 * prop that connects them, which is exactly the shape
 * `command-result-exhaustive.test.ts` uses for a wiring fact of the same kind.
 *
 * A full runtime press test was attempted first and hit a genuine, separate
 * defect: `VersionsView`'s local `applied` state did not survive the index
 * re-read a successful apply triggers (the re-read's `useEffect` set the
 * parent's `index` resource back to `"loading"`, which unmounted `VersionsView`
 * entirely before the banner could render), so the door this finding is about
 * was not reliably reachable by a click in the first place. That was out of
 * F10d's scope (five specified fixes) and was reported rather than fixed
 * there; **unit F10e fixed it**, and the press test it unblocked —
 * `archive-bump-round-trip-press.test.ts` — types a filter, applies, presses
 * the door and asserts the ledger it opens is unfiltered. That is now the
 * load-bearing proof of this finding, and deleting the `setQuery` call turns
 * it red. The walker below stays as the cheaper SHAPE control on the same
 * line — it fails on the single-expression form before a browser is
 * involved — but the sentence above it, that no render could ever see this,
 * stopped being true the day the surface became pressable.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const ARCHIVE_SURFACE = fileURLToPath(new URL("../../../src/dashboard/surfaces/archive/archive.tsx", import.meta.url));

/**
 * Reads the `onOpenArchive` assignment site itself. The single-expression
 * form (`() => onView("runs")`) has no block to hold a second statement, so
 * it is the defect by construction; the block form must name BOTH the clear
 * and the switch, in one callback, or an editor could keep the block shape
 * while dropping the clear again.
 */
function doorClearsTheQuery(source: string): boolean {
  const open = source.indexOf("onOpenArchive={() => {");
  if (open === -1) return false;
  const close = source.indexOf("}}", open);
  if (close === -1) return false;
  const block = source.slice(open, close);
  return block.includes("setQuery(EMPTY_ARCHIVE_QUERY)") && block.includes('onView("runs")');
}

describe("the applied-bump banner's door (unit F10d finding 2)", () => {
  it("clears the standing filter before switching back to the runs ledger", () => {
    assert.equal(doorClearsTheQuery(readFileSync(ARCHIVE_SURFACE, "utf8")), true);
  });

  it("the walker sees the pattern it forbids (negative control)", () => {
    // The original defect: switches the view, leaves the filter alone.
    assert.equal(doorClearsTheQuery('onOpenArchive={() => onView("runs")}'), false);
    // The same defect wearing the block shape — a callback that switches the
    // view but never calls `setQuery` at all.
    assert.equal(
      doorClearsTheQuery('onOpenArchive={() => {\n  onView("runs");\n}}'),
      false,
    );
    // And the walker must not be satisfied by naming the clear without the
    // switch, or a refactor that drops `onView` would still read clean.
    assert.equal(
      doorClearsTheQuery('onOpenArchive={() => {\n  setQuery(EMPTY_ARCHIVE_QUERY);\n}}'),
      false,
    );
  });
});
