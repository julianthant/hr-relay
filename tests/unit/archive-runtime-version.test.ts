import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  INITIAL_RUNTIME_VERSION,
  formatRuntimeVersion,
  planRuntimeVersionTransition,
  RuntimeVersionStateSchema,
} from "../../src/domain/archive/runtime-version.js";

const current = RuntimeVersionStateSchema.parse({
  dashboard: INITIAL_RUNTIME_VERSION,
  workflows: [
    { workflowId: "separations", version: INITIAL_RUNTIME_VERSION },
    { workflowId: "intake", version: INITIAL_RUNTIME_VERSION },
    { workflowId: "access", version: INITIAL_RUNTIME_VERSION },
  ],
});

describe("operator-managed runtime versions", () => {
  it("advances only selected workflows and leaves the dashboard unchanged", () => {
    const first = planRuntimeVersionTransition(current, { kind: "workflows", workflowIds: ["separations", "intake"] });
    assert.equal(first.kind, "minor");
    assert.equal(formatRuntimeVersion(first.after.dashboard), "1.0");
    assert.deepEqual(first.after.workflows.map(({ version }) => formatRuntimeVersion(version)), ["1.1", "1.1", "1.0"]);
    const second = planRuntimeVersionTransition(first.after, { kind: "workflows", workflowIds: ["separations"] });
    assert.deepEqual(second.after.workflows.map(({ version }) => formatRuntimeVersion(version)), ["1.2", "1.1", "1.0"]);
  });

  it("moves every workflow and dashboard to the next major version", () => {
    const prior = planRuntimeVersionTransition(current, { kind: "workflows", workflowIds: ["separations"] });
    const major = planRuntimeVersionTransition(prior.after, { kind: "dashboard" });
    assert.equal(major.kind, "major");
    assert.equal(formatRuntimeVersion(major.after.dashboard), "2.0");
    assert.deepEqual(major.after.workflows.map(({ version }) => formatRuntimeVersion(version)), ["2.0", "2.0", "2.0"]);
    assert.deepEqual(major.affectedWorkflowIds, ["access", "intake", "separations"]);
  });

  it("refuses a selection that silently acts as a dashboard bump", () => {
    assert.throws(() => planRuntimeVersionTransition(current, {
      kind: "workflows", workflowIds: ["separations", "intake", "access"],
    }), /runtime-version-all-workflows-requires-dashboard-scope/u);
    assert.throws(() => planRuntimeVersionTransition(current, {
      kind: "workflows", workflowIds: ["intake", "intake"],
    }), /runtime-version-invalid-selection/u);
    assert.throws(() => planRuntimeVersionTransition(current, {
      kind: "workflows", workflowIds: ["unknown"],
    }), /runtime-version-invalid-selection/u);
  });
});
