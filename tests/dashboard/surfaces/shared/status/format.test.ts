
import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import { elapsedSecondsBetween as elapsedSecondsBetween_m0,fmtActionClock as fmtActionClock_m0,fmtClock as fmtClock_m0,fmtElapsed as fmtElapsed_m0 } from "../../../../../src/dashboard/surfaces/shared/status/format.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import { runTiming as runTiming_m1 } from "../../../../../src/dashboard/surfaces/shared/status/format.js";
import { isTerminalQueueStatus as isTerminalQueueStatus_m1 } from "../../../../../src/models/dashboard/projection.js";

import assert_m2 from "node:assert/strict";
import { describe as describe_m2,it as it_m2 } from "vitest";
import { versionTag as versionTag_m2 } from "../../../../../src/dashboard/surfaces/shared/status/format.js";
import { WORKFLOW_DESCRIPTORS as WORKFLOW_DESCRIPTORS_m2 } from "../../../../../src/workflows/descriptor-registry.js";

import assert_m3 from "node:assert/strict";
import { describe as describe_m3,it as it_m3 } from "vitest";
import { appVersionTag as appVersionTag_m3,fmtAppVersion as fmtAppVersion_m3 } from "../../../../../src/dashboard/surfaces/shared/status/format.js";


{


/** The proof's own numbers: the tab loaded at 15:03:32, the run started at 15:12:17. */
const BOOTSTRAP_INSTANT = "2026-08-20T15:03:32.000Z";
const RUN_STARTED = "2026-08-20T15:12:17.000Z";

describe_m0("confirmed action timestamps", () => {
  it_m0("distinguishes successive seconds in the operator's local clock", () => {
    const at = new Date(2026, 8, 30, 9, 31, 14);
    assert_m0.equal(fmtActionClock_m0(at.toISOString()), "09:31:14");
    assert_m0.equal(fmtActionClock_m0(new Date(at.getTime() + 1_000).toISOString()), "09:31:15");
    assert_m0.equal(fmtClock_m0(at.toISOString()), "9:31 AM");
  });

  it_m0("keeps midnight and end-of-day readings unambiguous", () => {
    assert_m0.equal(fmtActionClock_m0(new Date(2026, 8, 30, 0, 0, 0).toISOString()), "00:00:00");
    assert_m0.equal(fmtActionClock_m0(new Date(2026, 8, 30, 23, 59, 59).toISOString()), "23:59:59");
  });

  it_m0("refuses an invalid served instant", () => {
    assert_m0.throws(() => fmtActionClock_m0("after the click"), /fmtActionClock: not an ISO instant/u);
  });
});

describe_m0("a backwards elapsed is drawn, not clamped", () => {
  it_m0("returns the SIGNED interval so 'the clock is behind' cannot read as 'just now'", () => {
    assert_m0.equal(elapsedSecondsBetween_m0(RUN_STARTED, BOOTSTRAP_INSTANT), -525);
    assert_m0.equal(elapsedSecondsBetween_m0(BOOTSTRAP_INSTANT, RUN_STARTED), 525);
  });

  it_m0("still renders a sub-second skew as 0s — this arm fires only on a real defect", () => {
    assert_m0.equal(fmtElapsed_m0(elapsedSecondsBetween_m0("2026-08-20T15:00:00.400Z", "2026-08-20T15:00:00.000Z")), "0s");
  });

  it_m0("spells a genuinely negative interval with its sign, at every magnitude", () => {
    assert_m0.equal(fmtElapsed_m0(-9), "-9s");
    assert_m0.equal(fmtElapsed_m0(-525), "-8m 45s");
    assert_m0.equal(fmtElapsed_m0(-7_260), "-2h 1m");
  });
});
}

{


const STARTED = "2026-08-04T07:06:26.828Z";

const ENDED = "2026-08-04T07:20:59.888Z";

const MUCH_LATER = "2026-08-04T09:53:00.000Z";

const terminalRow = {
  status: "done",
  startedAt: STARTED,
  endedAt: { state: "present", value: ENDED },
} as const;

describe_m1("queue row timing", () => {
  it_m1("shows a settled run's DURATION, not the time since it started", () => {
    const timing = runTiming_m1(terminalRow, MUCH_LATER, isTerminalQueueStatus_m1);
    assert_m1.deepEqual(timing, { text: "14m 33s" });
  });

  it_m1("does not move as the browser clock advances past a terminal run", () => {
    const first = runTiming_m1(terminalRow, ENDED, isTerminalQueueStatus_m1);
    const hoursLater = runTiming_m1(terminalRow, "2026-08-04T23:59:00.000Z", isTerminalQueueStatus_m1);
    assert_m1.deepEqual(first, hoursLater);
  });

  it_m1("keeps live elapsed for a run that is genuinely still in flight", () => {
    const timing = runTiming_m1(
      { status: "running", startedAt: STARTED, endedAt: { state: "absent", reason: "run is running and has not ended" } },
      "2026-08-04T07:07:26.828Z",
      isTerminalQueueStatus_m1,
    );
    assert_m1.deepEqual(timing, { text: "1m 0s" });
  });

  it_m1("keeps counting for a parked run — blocked and awaiting-approval have not ended", () => {
    for (const status of ["blocked", "awaiting-approval"]) {
      const timing = runTiming_m1(
        { status, startedAt: STARTED, endedAt: { state: "absent", reason: `run is ${status} and has not ended` } },
        "2026-08-04T07:08:26.828Z",
        isTerminalQueueStatus_m1,
      );
      assert_m1.deepEqual(timing, { text: "2m 0s" }, status);
    }
  });

  it_m1("shows no timer at all for a run that has started nothing", () => {
    assert_m1.equal(
      runTiming_m1(
        { status: "queued", startedAt: STARTED, endedAt: { state: "absent", reason: "run is queued and has not ended" } },
        MUCH_LATER,
        isTerminalQueueStatus_m1,
      ),
      undefined,
    );
  });

  it_m1("renders an explicit unknown — never `now` — when a terminal row carries no end instant", () => {
    const timing = runTiming_m1(
      {
        status: "failed",
        startedAt: STARTED,
        endedAt: { state: "absent", reason: "neither authority nor its run span recorded an end instant" },
      },
      MUCH_LATER,
      isTerminalQueueStatus_m1,
    );
    assert_m1.deepEqual(timing, {
      text: "duration unknown",
      title: "neither authority nor its run span recorded an end instant",
    });
  });
});
}

{


describe_m2("the descriptor version in Run Modal facts", () => {
  it_m2("prints the stored integer with no fabricated minor version", () => {
    for (const descriptor of WORKFLOW_DESCRIPTORS_m2) {
      const tag = versionTag_m2(descriptor.version);
      assert_m2.equal(tag, `v${String(descriptor.version)}`, `${descriptor.id} footer tag`);
      assert_m2.doesNotMatch(tag, /\./u, `${descriptor.id} has no recorded minor version`);
    }
  });
});
}

{


describe_m3("app version tag", () => {
  it_m3("prints the two components the tooltip beside it explains", () => {
    assert_m3.equal(fmtAppVersion_m3("0.1.0"), "0.1");
    assert_m3.equal(appVersionTag_m3("0.1.0"), "app 0.1");
    assert_m3.equal(appVersionTag_m3("12.34.56-rc.1"), "app 12.34");
    // A served two-part version is already the tag.
    assert_m3.equal(appVersionTag_m3("3.1"), "app 3.1");
  });

  it_m3("THROWS on a shape it does not recognise rather than printing the raw string", () => {
    // The arm a `?? appVersion` fallback would delete: a wrong version drawn
    // beside a right-sounding sentence is worse than a loud failure.
    for (const bad of ["", "1", "v1.2", "1.x", "one.two", ".1"]) {
      assert_m3.throws(() => fmtAppVersion_m3(bad), /is not MAJOR\.MINOR/u, `expected "${bad}" to be refused`);
    }
  });
});
}
