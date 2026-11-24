import { expect, it } from "vitest";
import { compareIdleRuns, summarizeIdleRuns } from "../../../scripts/bench/idle-three-tab.js";

const mib = 1024 * 1024;
const first = { stalls: { count: 0, longestMs: 0, totalMs: 0 }, busyPercent: 1.2, rssStartBytes: 300 * mib, rssEndBytes: 304 * mib, errors: 0 };

it("reports both ranges and the limiting target across two idle runs", () => {
  const second = { ...first, stalls: { count: 2, longestMs: 145, totalMs: 260 }, busyPercent: 2, rssEndBytes: 318 * mib };
  expect(summarizeIdleRuns([first, second])).toEqual({
    verdict: "targets-missed", runCount: 2, limiters: ["event-loop-stalls", "backend-thread-cpu"],
    ranges: { stallCount: [0, 2], longestStallMs: [0, 145], totalStallMs: [0, 260], busyPercent: [1.2, 2], rssDeltaBytes: [4 * mib, 18 * mib] },
    rssStayedFlat: false, repeatability: "mixed", errors: 0,
  });
});

it("keeps a browser error from looking like a successful idle run", () => {
  expect(summarizeIdleRuns([first, { ...first, errors: 1 }])).toMatchObject({ verdict: "inconclusive", errors: 1 });
});

it("uses the run-to-run ranges when assessing a base comparison", () => {
  const base = summarizeIdleRuns([first, { ...first, busyPercent: 1.5 }]);
  const overlap = summarizeIdleRuns([{ ...first, busyPercent: 1.4 }, { ...first, busyPercent: 1.8 }]);
  const separated = summarizeIdleRuns([{ ...first, busyPercent: 0.5 }, { ...first, busyPercent: 1 }]);
  expect(compareIdleRuns(base, overlap)).toBe("no-measurable-difference");
  expect(compareIdleRuns(base, separated)).toBe("inconclusive-until-limiter-profiled");
});
