import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { runsPlugin } from "../../../../../src/backend/assistant/plugins/runs/index.js";
import { AssistantToolRefusal } from "../../../../../src/backend/assistant/plugins/plugin.js";
import type { AssistantPluginDeps } from "../../../../../src/backend/assistant/plugins/registry.js";
import { createAssistantReferenceTable } from "../../../../../src/backend/assistant/references.js";
import { RunDetailWireSchema, type RunDetailWire } from "../../../../../src/models/dashboard/run-detail.js";
import type { SpanNotRunReasonSchema } from "../../../../../src/models/events/types.js";
import { NodeIdSchema } from "../../../../../src/rules/identity/ids.js";
import type { z } from "zod";

const AT = "2026-11-08T12:00:00.000Z";
function failedRun(skipped: z.infer<typeof SpanNotRunReasonSchema> = "branch-not-selected"): RunDetailWire {
  const runId = randomUUID(), traceId = "ws-120000-abcd";
  return RunDetailWireSchema.parse({ runId, rowRevision: 3, panelKind: "run",
    header: { runId, traceId, workflowId: "work-study", title: "Synthetic private run title", status: "failed", attempt: 1 },
    timeline: {
      events: [
        { nodeId: "ucpath-login", label: "Open UCPath", state: "done" },
        { nodeId: "paypath-open", label: "Open PayPath Actions", state: "failed" },
        { nodeId: "paypath-update", label: "Update Work-Study", state: "skipped" },
      ].map((event, index) => ({ noteId: randomUUID(), sequence: index + 1, at: AT, label: event.label, state: event.state,
        native: { eventId: randomUUID(), order: index + 1, runId, traceId, attempt: 1, nodeId: event.nodeId },
        notRun: event.state === "skipped" ? { state: "present", reason: skipped } : { state: "absent", reason: "this step ran" } })),
      steps: [
        { key: "update", label: "Update the appointment", state: "skipped",
          members: [{ nodeId: "paypath-update", label: "Update Work-Study", state: "skipped", notRunReason: skipped }] },
        { key: "sign-in", label: "Sign in to UCPath", state: "failed", members: [
          { nodeId: "ucpath-login", label: "Open UCPath", state: "done" },
          { nodeId: "paypath-open", label: "Open PayPath Actions", state: "failed" },
        ] },
      ],
    },
    gate: { state: "absent", reason: "Synthetic private gate reason" },
    outcome: { state: "terminal", result: "failed", completedAt: AT },
    context: { dataFacts: 7, evidenceFacts: 2, attempts: 1 }, availableSections: ["logs"],
  });
}

function logs(detail: RunDetailWire, version: number = detail.rowRevision) {
  const unused = () => { throw new Error("not read by read_run_logs"); };
  const deps: AssistantPluginDeps = { runDetail(id) { assert.equal(id, detail.runId); return detail; },
    search: unused, runReferenceLabel: unused, findLookupRuns: unused, notifications: unused, workbooks: unused,
    attachment: unused, settings: unused, facts: unused };
  const tool = runsPlugin(deps, id => id).tools.find(candidate => candidate.name === "read_run_logs");
  assert.ok(tool?.kind === "read");
  const references = createAssistantReferenceTable(3), run = references.issue("R", detail.runId, "selected run", detail.runId, version);
  const context = { references, signal: new AbortController().signal, actorId: "local-operator", conversationId: randomUUID(),
    operatorText: "", assertCurrent() {}, assertRetainedCurrent() {} };
  return { read: async (last: number) => tool.output.parse(await tool.invoke({ run, last }, context)) };
}

it("names each action's served Logs step, including the failed step, without returning other run values", async () => {
  const detail = failedRun(), tool = logs(detail);
  assert.deepEqual(await tool.read(5), { total: 3, steps: [
    { at: AT, label: "Open UCPath", stepLabel: "Sign in to UCPath", state: "done", skipped: null },
    { at: AT, label: "Open PayPath Actions", stepLabel: "Sign in to UCPath", state: "failed", skipped: null },
    { at: AT, label: "Update Work-Study", stepLabel: "Update the appointment", state: "skipped", skipped: "branch-not-selected" },
  ] });
  assert.deepEqual(await tool.read(1), { total: 3, steps: [
    { at: AT, label: "Update Work-Study", stepLabel: "Update the appointment", state: "skipped", skipped: "branch-not-selected" },
  ] });
});

it("refuses events without one served Logs step instead of inventing a step name", async () => {
  const detail = failedRun(), { events, steps } = detail.timeline, unmatched = NodeIdSchema.parse("unmatched");
  assert.ok(steps);
  const timelines: RunDetailWire["timeline"][] = [
    { events },
    { events: events.map(event => ({ ...event, native: undefined })), steps },
    { events, steps: steps.map(step => ({ ...step, members: step.members.map(member => ({ ...member, nodeId: unmatched })) })) },
    { events, steps: [...steps, ...steps] },
  ];
  for (const timeline of timelines) await assert.rejects(logs({ ...detail, timeline }).read(5),
    (error: unknown) => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_READ_UNAVAILABLE");
});

it("returns the skipped action when required evidence is unavailable", async () => {
  assert.deepEqual(await logs(failedRun("required-evidence-unavailable")).read(1), { total: 3, steps: [
    { at: AT, label: "Update Work-Study", stepLabel: "Update the appointment", state: "skipped", skipped: "required-evidence-unavailable" },
  ] });
});

it("keeps an empty timeline readable without inventing step metadata", async () => {
  const detail = failedRun();
  assert.deepEqual(await logs({ ...detail, timeline: { events: [] } }).read(5), { total: 0, steps: [] });
});

it("refuses a stale selected run before returning its step names", async () => {
  await assert.rejects(logs(failedRun(), 2).read(5),
    (error: unknown) => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_READ_STALE");
});
