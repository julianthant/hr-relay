import { expect, it } from "vitest";
import { summarize } from "../../../scripts/bench/queue-day.js";

const run = { day: "2026-08-03", dayRuns: 40, timelineHighWater: 9000, laneReadyMs: 900, coldFoldMs: 700, foldBeforeReady: true,
  laneBuildMs: 60, requestThreadBuildMs: 50, stampMs: [0.2, 0.3], sse: [{ wallMs: 70, stallMs: 4 }], get: [{ wallMs: 65, stallMs: 3 }], bodyBytes: 120_000,
  phases: { requestThread: { foldMs: 700, buildMs: 50, serializeMs: 2 }, laneReadPathHere: { foldMs: 690, buildMs: 51, serializeMs: 2 }, laneWorkerAndTransferMs: 7 } };

it("passes a run inside every G1 bound and reports the ranges it measured", () => {
  expect(summarize([run, { ...run, laneBuildMs: 64 }])).toMatchObject({ verdict: "pass", limiters: [], runCount: 2,
    ranges: { sseStallMs: [4, 4], getStallMs: [3, 3], laneBuildRatio: [1.2, 1.28], stampMs: [0.2, 0.3] },
    phases: { requestThreadBuildMs: [50, 50], laneReadPathHereBuildMs: [51, 51], laneWorkerAndTransferMs: [7, 7] } });
});

it("names each bound a run misses", () => {
  const slow = { ...run, laneBuildMs: 80, foldBeforeReady: false, sse: [{ wallMs: 90, stallMs: 25 }], get: [{ wallMs: 80, stallMs: 21 }] };
  expect(summarize([run, slow])).toMatchObject({ verdict: "fail", limiters: ["sse-stall", "get-stall", "lane-build-ratio", "fold-after-ready"] });
});
