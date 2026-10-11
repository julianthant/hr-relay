import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { readFileSync as readFileSync_m0 } from "node:fs";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { visualLogSteps as visualLogSteps_m0,visualLogSteps as visualLogSteps_m1 } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { decisionScenarios as decisionScenarios_m1,previewScenarios as previewScenarios_m1,separationLogs as separationLogs_m0,separationLogs as separationLogs_m1 } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-fixture.js";


{

describe_m0("frontend presentation producers", () => {
  it_m0("binds classified captures to the filled fields, submission and matching person", () => {
    for (const step of visualLogSteps_m0(separationLogs_m0)) for (const entry of step.entries) {
      if (entry.kind === "note") continue;
      if (entry.kind === "fields" && entry.fields.some(field => field.kind === "fill")) assert_m0.ok(entry.screenshots?.some(shot => shot.kind === "fields"), `missing filled fields capture: ${entry.id}`);
      if (entry.kind === "click" && ["Save", "Save and Submit"].includes(entry.label)) assert_m0.ok(entry.screenshots?.some(shot => shot.kind === "form" && shot.height > shot.width && shot.time >= entry.time));
      for (const shot of (entry.kind === "decision" ? entry.decision.screenshots : entry.screenshots) ?? []) {
        assert_m0.equal(shot.system, step.system);
        const svg = readFileSync_m0(new URL(`../../../../../src/dashboard/public${shot.src}`, import.meta.url), "utf8");
        assert_m0.match(svg, new RegExp(`width="${shot.width}" height="${shot.height}"`));
        assert_m0.match(svg, /FICTIONAL/);
      }
    }
    const candidate = separationLogs_m0.find(step => step.id === "search-person")?.entries.find(entry => entry.id === "person-match");
    assert_m0.ok(candidate?.kind === "fields" && candidate.screenshots?.some(shot => shot.kind === "person"));
  });
});
}

{


describe_m1("frontend timeline and sessions", () => {
  it_m1("every available timeline jump targets a displayed confirmed-action step", () => {
    for (const scenario of [...previewScenarios_m1, ...decisionScenarios_m1]) {
      const visual = new Set(visualLogSteps_m1(scenario.steps).map(step => step.id));
      assert_m1.equal(scenario.timeline.length, 5);
      for (const stage of scenario.timeline) {
        if (stage.stepId) assert_m1.ok(visual.has(stage.stepId), `${scenario.id}: ${stage.id}`);
        if (stage.state === "pending") { assert_m1.equal(stage.time, undefined); assert_m1.equal(stage.durationLabel, undefined); assert_m1.equal(stage.stepId, undefined); }
      }
    }
    assert_m1.ok(previewScenarios_m1.find(item => item.id === "waiting")?.timeline.some(stage => stage.state === "waiting"));
    assert_m1.ok(previewScenarios_m1.find(item => item.id === "failed")?.timeline.some(stage => stage.state === "failed"));
  });
  it_m1("timeline substep durations match fixture boundaries and incomplete steps do not claim measurements", () => {
    const seconds = (time: string) => time.split(":").map(Number).reduce((total, value) => total * 60 + value, 0);
    const full = previewScenarios_m1.find(item => item.id === "separation")!;
    const substeps = full.timeline.flatMap(stage => stage.substeps);
    assert_m1.deepEqual(substeps.map(step => step.id), separationLogs_m1.map(step => step.id));
    const durations = substeps.map((substep, index) => {
      const start = seconds(separationLogs_m1[index].time);
      const end = seconds(separationLogs_m1[index + 1]?.time ?? "09:33:36");
      assert_m1.equal(substep.durationLabel, `${end - start}s`);
      assert_m1.equal(substep.state, "completed");
      return end - start;
    });
    assert_m1.equal(durations.reduce((sum, duration) => sum + duration, 0), 156);
    for (const scenario of previewScenarios_m1) for (const stage of scenario.timeline) for (const substep of stage.substeps) {
      if (substep.state !== "completed") assert_m1.equal(substep.durationLabel, undefined, `${scenario.id}: ${substep.id}`);
    }
    assert_m1.equal(previewScenarios_m1.find(item => item.id === "failed")?.timeline.at(-1)?.substeps.at(-1)?.state, "failed");
    assert_m1.ok(previewScenarios_m1.find(item => item.id === "waiting")?.timeline.some(stage => stage.substeps.some(substep => substep.state === "waiting")));
  });
  it_m1("preserves completed stages and grays later stages around the affected portion", () => {
    const full = previewScenarios_m1.find(item => item.id === "separation")!;
    const failure = decisionScenarios_m1.find(item => item.id === "failure-prepared")!;
    assert_m1.equal(failure.timeline.length, 5);
    assert_m1.deepEqual(failure.timeline.slice(0, 3), full.timeline.slice(0, 3));
    assert_m1.equal(failure.timeline[3].label, "File termination");
    assert_m1.equal(failure.timeline[3].state, "failed");
    assert_m1.equal(failure.timeline[4].state, "pending");
    assert_m1.equal(failure.timeline[4].durationLabel, undefined);
    const review = decisionScenarios_m1.find(item => item.id === "review-employment")!;
    assert_m1.deepEqual(review.timeline[0], full.timeline[0]);
    assert_m1.equal(review.timeline[1].label, "Verify employee");
    assert_m1.equal(review.timeline[1].state, "waiting");
    assert_m1.ok(review.timeline.slice(2).every(stage => stage.state === "pending"));
  });
});
}
