import { createStepOmissionTestWorld } from "../../../support/helpers/backend/step-omission-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { buildExplainRunView, renderExplainRun } from "../../../../src/backend/runs/explain/explain-run.js";

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
