// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { RerunValuesRequestSchema, RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);
const descriptor = WORKFLOW_DESCRIPTORS.find(workflow => workflow.id === "person-lookup"); assert.ok(descriptor);
const surface = descriptor.surfaces.inputRun; assert.ok(surface);
const workflow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, version: descriptor.version,
  steps: projectStartSteps(descriptor), inputRun: { state: "present", surface } };
const source = RerunValuesRequestSchema.parse({ runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 });

describe("served Person Lookup Run and Rerun", () => {
  it("sends canonical Search inputs with merged duplicates through the existing planner", async () => {
    let request: unknown;
    const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async input => { request = input; return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }), { workflows: [workflow], panelWorkflowId: descriptor.id });
    await dialog.type("10000001; 10000001; Example, Person");
    assert.ok([...document.querySelectorAll("label")].some(label => label.textContent === "Employee IDs or names"));
    assert.match(dialog.text(), /Lookup mode/u); assert.match(dialog.text(), /CRM check/u);
    await dialog.press("Continue"); await dialog.press("Continue");
    const planned = StartPlanRequestSchema.parse(request);
    assert.deepEqual(planned.submissions, [
      { mode: "search", emplId: "10000001", crmCheck: true, keepNonHdh: false, includeCrmDates: false },
      { mode: "search", name: "Example, Person", crmCheck: true, keepNonHdh: false, includeCrmDates: false },
    ]);
    assert.deepEqual(planned.selectedStepKeys, ["searching", "cross-verify", "active-status"]);
  });
  it("switches to Match defaults, rejects missing identifiers and masks confirmation", async () => {
    let request: unknown;
    const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async input => { request = input; return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }), { workflows: [workflow], panelWorkflowId: descriptor.id });
    const match = document.querySelector<HTMLInputElement>('input[type="radio"][value="match"]'); assert.ok(match);
    await act(async () => match.click()); await dialog.type("Example, Person, x, x");
    assert.match(dialog.text(), /Each entry starts one run\./u);
    assert.equal(/Enter employee IDs\./iu.test(dialog.text()), false);
    assert.equal(dialog.disabled("Continue"), true);
    await dialog.type("Example, Person, x, 123456789");
    await dialog.press("Continue"); await dialog.press("Continue");
    const planned = StartPlanRequestSchema.parse(request);
    assert.deepEqual(planned.submissions, [{ mode: "match", lastName: "Example", firstName: "Person", ssn: "123456789", crmCheck: false, includeCrmDates: false }]);
    assert.deepEqual(planned.selectedStepKeys, ["searching", "active-status"]);
    assert.equal(dialog.text().includes("123456789"), false);
  });
  it("keeps protected source input unavailable and never offers output values as its replacement", async () => {
    const snapshot = RerunValuesSnapshotSchema.parse({ source: { runId: source.runId, version: source.expectedVersion, workflow: descriptor.id,
      descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint, outcome: "done" },
      sourceInput: { state: "unavailable", reason: "protected" },
      steps: descriptor.timeline.map(step => ({ key: step.key, state: "completed", nodes: step.nodes.map(node => ({ nodeId: node.id, state: "completed", reason: "checkpoint" })) })), values: [], transactions: [] });
    const dialog = await h.openDialog(h.stubClient({ rerunValues: async () => ({ state: "available", snapshot }) }),
      { workflows: [workflow], panelWorkflowId: descriptor.id, rerunSource: source });
    assert.match(dialog.text(), /source input is protected/u);
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Steps");
    assert.equal(document.querySelector("textarea"), null);
  });
  it("blocks a cleared rerun input before planning and accepts fresh canonical replacement input", async () => {
    const input = { mode: "search", emplId: "10000001", crmCheck: true, keepNonHdh: false, includeCrmDates: false };
    const snapshot = RerunValuesSnapshotSchema.parse({ source: { runId: source.runId, version: source.expectedVersion, workflow: descriptor.id,
      descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint, outcome: "done" },
      sourceInput: { state: "available", value: input },
      steps: descriptor.timeline.map(step => ({ key: step.key, state: "completed", nodes: step.nodes.map(node => ({ nodeId: node.id, state: "completed", reason: "checkpoint" })) })), values: [], transactions: [] });
    const planned: unknown[] = [];
    const dialog = await h.openDialog(h.stubClient({ rerunValues: async () => ({ state: "available", snapshot }),
      previewRerunWarnings: async options => RerunWarningWireSchema.parse({ workflowId: descriptor.id, rerun: { source: RerunWarningRequestSchema.parse(options).source, warnings: [], warningDigest: h.HASH } }),
      submitStartPlan: async options => { planned.push(options); const parsed = StartPlanRequestSchema.parse(options); return StartPlanWireSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), rerun: { source: parsed.rerunSource, warnings: [], warningDigest: h.HASH, acknowledgment: parsed.warningAcknowledgment } }); },
    }), { workflows: [workflow], panelWorkflowId: descriptor.id, rerunSource: source });
    await dialog.press("Continue"); await dialog.type("");
    assert.equal(dialog.disabled("Continue"), true);
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Values"); assert.equal(planned.length, 0);
    await dialog.type("10000002");
    assert.equal(dialog.disabled("Continue"), false);
    await dialog.press("Continue"); await dialog.press("Continue");
    assert.equal(planned.length, 1);
    assert.deepEqual(StartPlanRequestSchema.parse(planned[0]).submissions, [{ ...input, emplId: "10000002" }]);
  });
  for (const input of [
    { mode: "search", name: "Example, Person", crmCheck: false, keepNonHdh: true, includeCrmDates: false },
    { mode: "search", emplId: "10000001", crmCheck: true, keepNonHdh: false, includeCrmDates: true },
    { mode: "match", lastName: "Example", firstName: "Person", ssn: "123456789", crmCheck: true, includeCrmDates: false },
  ]) it(`restores exact ${input.mode} source values and masks Match confirmation`, async () => {
    const snapshot = RerunValuesSnapshotSchema.parse({ source: { runId: source.runId, version: source.expectedVersion, workflow: descriptor.id,
      descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint, outcome: "done" },
      sourceInput: { state: "available", value: input },
      steps: descriptor.timeline.map(step => ({ key: step.key, state: "completed", nodes: step.nodes.map(node => ({ nodeId: node.id, state: "completed", reason: "checkpoint" })) })), values: [], transactions: [] });
    let request: unknown;
    const dialog = await h.openDialog(h.stubClient({ rerunValues: async () => ({ state: "available", snapshot }),
      previewRerunWarnings: async options => RerunWarningWireSchema.parse({ workflowId: descriptor.id, rerun: { source: RerunWarningRequestSchema.parse(options).source, warnings: [], warningDigest: h.HASH } }),
      submitStartPlan: async options => { request = options; const parsed = StartPlanRequestSchema.parse(options); return StartPlanWireSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), rerun: { source: parsed.rerunSource, warnings: [], warningDigest: h.HASH, acknowledgment: parsed.warningAcknowledgment } }); },
    }), { workflows: [workflow], panelWorkflowId: descriptor.id, rerunSource: source });
    await dialog.press("Continue");
    assert.equal(dialog.typedInput().value, input.mode === "match" ? "Example, Person, x, [masked]" : "emplId" in input ? input.emplId : "Example, Person");
    assert.equal(document.body.innerHTML.includes("123456789"), false);
    await dialog.press("Continue"); await dialog.press("Continue");
    const planned = StartPlanRequestSchema.parse(request);
    assert.deepEqual(planned.submissions, [input]);
    assert.equal(planned.rerunSource?.runId, source.runId);
    assert.equal(dialog.text().includes("123456789"), false);
    assert.deepEqual(snapshot.sourceInput, { state: "available", value: input });
    if (input.mode === "match") {
      await dialog.press("Back"); await dialog.press("Back");
      await dialog.type("Changed, Person, x, [masked]");
      assert.equal(dialog.disabled("Continue"), true);
      await dialog.type("Example, Person, x, [masked]");
      assert.equal(dialog.disabled("Continue"), true);
      const search = document.querySelector<HTMLInputElement>('input[type="radio"][value="search"]'); assert.ok(search);
      await act(async () => search.click());
      const match = document.querySelector<HTMLInputElement>('input[type="radio"][value="match"]'); assert.ok(match);
      await act(async () => match.click());
      assert.equal(dialog.disabled("Continue"), true);
      await dialog.type("Changed, Person, 01/15/2000, x");
      await dialog.press("Continue"); await dialog.press("Continue");
      assert.deepEqual(StartPlanRequestSchema.parse(request).submissions, [{ mode: "match", lastName: "Changed", firstName: "Person", dob: "01/15/2000", crmCheck: false, includeCrmDates: false }]);
      assert.deepEqual(snapshot.sourceInput, { state: "available", value: input });
    }
  });
});
