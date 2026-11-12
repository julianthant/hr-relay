import { createStepOmissionTestWorld } from "../../../support/helpers/backend/step-omission-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { buildExplainRunView, renderExplainRun } from "../../../../src/backend/runs/explain/explain-run.js";
import { RunLifecycleSchema, RunPauseSchema } from "../../../../src/models/run/record.js";

const {STEP, TYPED_FACT, omittedStepFixture, cleanup } = createStepOmissionTestWorld();


afterEach(cleanup);

describe("explain run under step omission", () => {
  async function explainView() {
    const fixture = await omittedStepFixture();
    return buildExplainRunView({
      run: fixture.run,
      checkpoints: fixture.checkpoints,
      writes: [],
      nodeIds: fixture.result.dependencies.map((dependency) => String(dependency.nodeId)),
      dependencies: fixture.result.dependencies.map((dependency) => ({
        nodeId: String(dependency.nodeId),
        state: dependency.state === "not-run" ? dependency.reason : dependency.state,
      })),
    });
  }

  it("lists the omitted step keys and renders them as their own section", async () => {
    const view = await explainView();
    assert.deepEqual(view.omittedSteps, [STEP]);
    const rendered = renderExplainRun(view);
    assert.match(rendered, /omitted steps\n\s+crm-read — omitted at start/u);
    assert.equal(rendered.includes(TYPED_FACT), false);
  });
});

describe("explain run next safe action", () => {
  it("explains a run that is both pausing and stopping by its stop, as every other reader does", async () => {
    const fixture = await omittedStepFixture();
    const at = fixture.run.lifecycle.state === "terminal" ? fixture.run.lifecycle.endedAt : fixture.run.updatedAt;
    const { completion: _completion, ...unsettled } = fixture.run;
    const running = { ...unsettled, lifecycle: RunLifecycleSchema.parse({ state: "running", workerId: "person-lookup-worker-1", claimedAt: at, heartbeatAt: at }) };
    const pause = RunPauseSchema.parse({ state: "requested", commandId: "a1000000-0000-4000-8000-000000000090", requestedAt: at });
    const nextOf = (run: typeof running) => buildExplainRunView({ run, checkpoints: fixture.checkpoints, writes: [],
      nodeIds: [], dependencies: [] }).nextSafeAction;
    assert.match(nextOf({ ...running, pause }), /A pause is requested/u);
    assert.equal(nextOf({ ...running, pause, cancelRequested: true }), nextOf({ ...running, cancelRequested: true }));
    assert.doesNotMatch(nextOf({ ...running, pause, cancelRequested: true }), /pause/u);
  });
});
