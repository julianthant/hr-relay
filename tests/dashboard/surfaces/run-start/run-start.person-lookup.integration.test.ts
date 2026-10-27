// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { rerunValuesHarness, rerunValuesDeps } from "../../../support/fixtures/rerun-values-fixtures.js";
import { readRerunValues } from "../../../../src/backend/runs/start/rerun-values.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);
const descriptor = WORKFLOW_DESCRIPTORS.find(workflow => workflow.id === "person-lookup"); assert.ok(descriptor);
const surface = descriptor.surfaces.inputRun; assert.ok(surface);
const workflow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, version: descriptor.version,
  steps: projectStartSteps(descriptor), inputRun: { state: "present", surface } };

describe("older typed Rerun backend prefill through mounted current form", () => {
  for (const kind of ["padded-name", "missing-control"] as const) it(`preserves exact accepted fields for ${kind}`, async () => {
    const backend = await rerunValuesHarness();
    try {
      const queued = backend.start(backend.proposal()); assert.equal((await backend.execute(queued)).state, "done");
      const completed = backend.fresh(queued);
      const { sessionId: _sessionId, ...sessionless } = completed;
      const oldInput = kind === "padded-name"
        ? { mode: "match", lastName: " Example ", firstName: "Person", dob: "01/15/2000", crmCheck: true, includeCrmDates: false }
        : { mode: "search", emplId: "10000001", crmCheck: false, keepNonHdh: true };
      const run = RunRecordSchema.parse({ ...sessionless, envelope: { ...completed.envelope, workflow: descriptor.id },
        input: { ...completed.input, parsed: { ...completed.input.parsed, value: oldInput } } });
      const result = readRerunValues({ ...rerunValuesDeps(backend), descriptors: { resolve: () => descriptor },
        reader: { read: () => ({ state: "present", disposition: "live", run }) } },
      { runId: run.envelope.runId, expectedVersion: run.version });
      assert.ok(result.state === "available", JSON.stringify(result));
      assert.equal(result.snapshot.sourceInput.state, "partial");
      let request: unknown;
      const dialog = await h.openDialog(h.stubClient({ rerunValues: async () => result,
        previewRerunWarnings: async options => RerunWarningWireSchema.parse({ workflowId: descriptor.id, rerun: { source: RerunWarningRequestSchema.parse(options).source, warnings: [], warningDigest: h.HASH } }),
        submitStartPlan: async options => { request = options; const parsed = StartPlanRequestSchema.parse(options);
          for (const submission of parsed.submissions) assert.deepEqual(descriptor.input.parse(submission), submission);
          return StartPlanWireSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), rerun: { source: parsed.rerunSource, warnings: [], warningDigest: h.HASH, acknowledgment: parsed.warningAcknowledgment } }); },
      }), { workflows: [workflow], panelWorkflowId: descriptor.id, rerunSource: { runId: run.envelope.runId, expectedVersion: run.version } });
      await dialog.press("Continue");
      if (kind === "padded-name") {
        assert.equal(dialog.typedInput().value, ""); assert.equal(dialog.disabled("Continue"), true); assert.equal(request, undefined);
        await dialog.type("Example, Person, 01/15/2000, x");
      } else assert.equal(dialog.typedInput().value, "10000001");
      await dialog.press("Continue"); await dialog.press("Continue");
      assert.deepEqual(StartPlanRequestSchema.parse(request).submissions, [kind === "padded-name"
        ? { mode: "match", lastName: "Example", firstName: "Person", dob: "01/15/2000", crmCheck: true, includeCrmDates: false }
        : { mode: "search", emplId: "10000001", crmCheck: false, keepNonHdh: true, includeCrmDates: false }]);
    } finally { await backend.dispose(); }
  });
});
