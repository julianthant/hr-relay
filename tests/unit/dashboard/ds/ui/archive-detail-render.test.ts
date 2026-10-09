
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  archivedNotRunNote,
} from "../../../../../src/dashboard/surfaces/archive/archive-model.js";
import {
  ArchivedRunDetailWireSchema,
  type ArchivedRunDetailWire,
} from "../../../../../src/models/dashboard/archive.js";
import { FIXTURE_ARCHIVED_RUN } from "../../../../parity/helpers/fixture-archive.js";


describe("a skipped step whose span recorded no reason", () => {
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
