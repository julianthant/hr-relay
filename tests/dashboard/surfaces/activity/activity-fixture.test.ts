import { default as assert_m0,default as assert_m1,default as assert_m2 } from 'node:assert/strict';
import { describe as describe_m0,describe as describe_m1,describe as describe_m2,it as it_m0,it as it_m1,it as it_m2 } from 'vitest';
import { ACTIVITY_SAMPLE_RANGE as ACTIVITY_SAMPLE_RANGE_m0,ACTIVITY_SAMPLE_RANGE as ACTIVITY_SAMPLE_RANGE_m1,ACTIVITY_SAMPLE_RANGE as ACTIVITY_SAMPLE_RANGE_m2,activitySample as activitySample_m0,activitySample as activitySample_m1,activitySample as activitySample_m2 } from '../../../../src/dashboard/surfaces/activity/activity-fixture.js';
import { activityDuration as activityDuration_m1,activityFailureRate as activityFailureRate_m1 } from "../../../../src/dashboard/surfaces/activity/activity-view-model.js";
import { ActivityVolumeSchema as ActivityVolumeSchema_m1 } from "../../../../src/models/dashboard/activity-volume.js";


{


describe_m0('Activity median duration', () => {
  it_m0('derives the median from the measured successful population the tiles count', () => {
    const data = activitySample_m0(ACTIVITY_SAMPLE_RANGE_m0, 'normal');
    assert_m0.equal(data.state, 'loaded');
    if (data.state !== 'loaded') return;
    const runs = data.report.runs; assert_m0.ok(runs);
    assert_m0.equal(runs.filter(run => run.status === 'completed').length, data.report.duration.measured + data.report.duration.unmeasured);
    const measured = runs.filter(run => run.status === 'completed' && run.seconds !== null).map(run => run.seconds as number).sort((a, b) => a - b);
    assert_m0.equal(measured.length, data.report.duration.measured);
    const middle = Math.floor(measured.length / 2);
    const expected = measured.length % 2 === 1 ? measured[middle] : Math.round(((measured[middle - 1] ?? 0) + (measured[middle] ?? 0)) / 2);
    assert_m0.equal(data.report.duration.medianSeconds, expected);
    const incomplete = activitySample_m0(ACTIVITY_SAMPLE_RANGE_m0, 'incomplete');
    assert_m0.equal(incomplete.state === 'loaded' ? incomplete.report.duration.medianSeconds : undefined, null);
  });
});
}

{

describe_m1("frontend presentation producers", () => {
  it_m1("keeps the approved report's counts, cohorts and distinct receipt ledger coherent", () => {
    const data = activitySample_m1(ACTIVITY_SAMPLE_RANGE_m1, "normal");
    assert_m1.equal(data.state, "loaded");
    if (data.state !== "loaded") throw new Error("sample must load");
    const report = data.report;
    assert_m1.deepEqual([report.total, report.completed, report.outstanding, report.failed], [44, 38, 4, 2]);
    assert_m1.deepEqual([report.running, report.waiting, report.terminal], [3, 1, 40]);
    assert_m1.deepEqual(report.duration, { medianSeconds: 134, longestSeconds: 281, totalSeconds: 4643, measured: 34, unmeasured: 4 });
    assert_m1.deepEqual(report.failures, [{ label: "Document read timeout", runs: 2 }]);
    assert_m1.deepEqual(report.evidence, { verified: 35, unread: 3 });
    assert_m1.deepEqual(report.workflows.map(row => [row.completed, row.outstanding, row.failed, row.total]), [[24, 3, 2, 29], [14, 1, 0, 15]]);
    assert_m1.deepEqual(report.transactions.map(row => row.count), [18, 17]);
    const volume = ActivityVolumeSchema_m1.parse(report.volume);
    assert_m1.deepEqual(volume.buckets.map(row => row.runs), [0, 5, 8, 7, 6, 9, 9]);
  });
  it_m1("changes all local sample measurements with the applied range and preserves measured zero", () => {
    const data = activitySample_m1({ from: "2026-09-26", to: "2026-09-26" }, "normal");
    assert_m1.equal(data.state, "loaded");
    if (data.state !== "loaded") throw new Error("sample must load");
    assert_m1.equal(data.report.total, 9);
    assert_m1.equal(ActivityVolumeSchema_m1.parse(data.report.volume).coveredRuns, 9);
    const empty = activitySample_m1({ from: "2026-08-01", to: "2026-08-31" }, "normal");
    assert_m1.equal(empty.state, "loaded");
    if (empty.state !== "loaded") throw new Error("empty period must load");
    assert_m1.equal(empty.report.total, 0);
    assert_m1.equal(empty.report.duration.medianSeconds, null);
    assert_m1.equal(empty.report.evidence.verified, 0);
    assert_m1.ok(ActivityVolumeSchema_m1.parse(empty.report.volume).buckets.every(bucket => bucket.runs === 0));
  });
  it_m1("distinguishes unknown, loading and failure from a successful empty report", () => {
    const incomplete = activitySample_m1(ACTIVITY_SAMPLE_RANGE_m1, "incomplete");
    if (incomplete.state !== "loaded") throw new Error("incomplete report must load");
    assert_m1.equal(incomplete.report.evidence.verified, null);
    assert_m1.equal(incomplete.report.evidence.unread, null);
    assert_m1.equal(incomplete.report.duration.medianSeconds, null);
    assert_m1.equal(incomplete.report.volume, undefined);
    assert_m1.equal(incomplete.report.total, 44);
    assert_m1.deepEqual(activitySample_m1(ACTIVITY_SAMPLE_RANGE_m1, "loading"), { state: "loading" });
    assert_m1.equal(activitySample_m1(ACTIVITY_SAMPLE_RANGE_m1, "unavailable").state, "unavailable");
    assert_m1.equal(activityFailureRate_m1(0, 0), "No terminal runs");
    assert_m1.equal(activityFailureRate_m1(2, 40), "2 of 40 terminal runs · 5%");
    assert_m1.equal(activityDuration_m1(null), "Unavailable");
    assert_m1.equal(activityDuration_m1(134), "2m 14s");
  });
});
}

{


describe_m2('Relay presentation models', () => {
  it_m2('supplies per-workflow timings for successes only, preserving unavailable measurements', () => {
    const full = activitySample_m2(ACTIVITY_SAMPLE_RANGE_m2, 'normal');
    assert_m2.equal(full.state, 'loaded'); if (full.state !== 'loaded') return;
    assert_m2.deepEqual(full.report.workflows[0].successfulTiming, { totalSeconds: 3303, measured: 24, unmeasured: 0 });
    assert_m2.deepEqual(full.report.workflows[1].successfulTiming, { totalSeconds: 1340, measured: 10, unmeasured: 4 });
    const partial = activitySample_m2(ACTIVITY_SAMPLE_RANGE_m2, 'incomplete');
    assert_m2.equal(partial.state, 'loaded'); if (partial.state !== 'loaded') return;
    assert_m2.deepEqual(partial.report.workflows[0].successfulTiming, { totalSeconds: null, measured: 0, unmeasured: 24 });
    const empty = activitySample_m2(ACTIVITY_SAMPLE_RANGE_m2, 'empty');
    assert_m2.equal(empty.state, 'loaded'); if (empty.state === 'loaded') assert_m2.equal(empty.report.workflows.length, 0);
  });
});
}
