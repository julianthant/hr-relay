/**
 * Two archived-run detail rows (unit F10c, ledger 3 AR150 and AR163) that only
 * the drawn tree can hold.
 *
 * AR150 is a REMOVAL, which is the hardest kind of row to pin: three counts
 * about the run — attempts, data facts, evidence facts — sat under a card
 * headed `Decision`, and each of them has an owner elsewhere on the same page
 * that derives its number from the FROZEN sections. Two sources for one fact
 * is the thing this bundle bans, and where a section was never frozen its
 * owner prints the REASON, which is a better answer than a number the archive
 * cannot corroborate. Nothing but an assertion about their absence can keep
 * them out.
 *
 * AR163 is the log line's shape: fixed clock and level columns so every
 * message starts on one x, and the level as a WORD so nothing is carried by
 * colour alone.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  archivedNotRunNote,
} from "../../../src/dashboard/surfaces/archive/archive-model.js";
import {
  ArchivedRunDetailWireSchema,
  type ArchivedRunDetailWire,
} from "../../../src/domain/dashboard/archive.js";
import { FIXTURE_ARCHIVED_RUN } from "../../parity/helpers/fixture-archive.js";

/*
 * D307 — the frozen timeline drew a note for a skipped step ONLY when its span
 * recorded a closed reason, and dropped the `absent` arm's served sentence. A
 * step that did not run then looked exactly like a step that ran: no note under
 * either. Both arms draw now, and this is the arm nobody would have written a
 * test for, because its absence is a blank rather than a wrong word.
 */
describe("a skipped step whose span recorded no reason (D307)", () => {
  const NO_REASON = "this step did not run; its span recorded no reason";

  function detailWithSkips(): ArchivedRunDetailWire {
    const timeline = FIXTURE_ARCHIVED_RUN.detail.timeline;
    return ArchivedRunDetailWireSchema.parse({
      ...FIXTURE_ARCHIVED_RUN,
      detail: {
        ...FIXTURE_ARCHIVED_RUN.detail,
        timeline: {
          ...timeline,
          events: [
            ...timeline.events,
            {
              noteId: "aa11bb22-0007-4000-8000-aa11bb220007",
              sequence: 2,
              at: FIXTURE_ARCHIVED_RUN.archivedAt,
              label: "Reconcile",
              state: "skipped",
              notRun: { state: "absent", reason: NO_REASON },
            },
            {
              noteId: "aa11bb22-0008-4000-8000-aa11bb220008",
              sequence: 3,
              at: FIXTURE_ARCHIVED_RUN.archivedAt,
              label: "Timecard",
              state: "skipped",
              notRun: { state: "present", reason: "step-omitted" },
            },
          ],
        },
      },
    });
  }

  it("leaves a step that RAN with no note at all", () => {
    assert.equal(archivedNotRunNote(detailWithSkips().detail.timeline.events[0]), undefined);
  });
});

// H: the served saved-document renderer never mounts the retired live detail actions.
