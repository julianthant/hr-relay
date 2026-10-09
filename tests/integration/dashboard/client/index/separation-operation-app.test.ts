import assert from "node:assert/strict";
import { z } from "zod";
import { describe, it } from "vitest";
import { startOperationAuthorityServer } from "../../../../support/fixtures/dashboard/fixture-operation-authority.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { appendLogPage } from "../../../../../src/dashboard/surfaces/run-detail/logs-model.js";
import { RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { separationCommentTemplate, fictionalSeparationDocument, reconcileFictionalSeparation } from "../../../../support/fixtures/plan1-separation-operation.js";
import { KualiReadSeparationDocument } from "../../../../../src/models/systems/kuali/read-separation-document.js";
import { classifyEvidenceLeaf, redactEvidenceLeaf } from "../../../../../src/models/trust/evidence-classification.js";
import { taskId } from "../../../../../src/rules/identity/ids.js";
import { renderOperationTemplate } from "../../../../../src/models/workflow/operation-display.js";

describe("fictional separation run through production authority", () => {
  it("keeps fixture outputs outside active schemas and retains classified local evidence", () => {
    assert.equal(KualiReadSeparationDocument.output.safeParse({ ...KualiReadSeparationDocument.example, fictional: fictionalSeparationDocument }).success, false);
    const scope = { kind: "task-output" as const, taskId: taskId("kuali/read-separation-document") };
    const employee = redactEvidenceLeaf(scope, { path: "fictional.employee", field: "employee", value: "10800000" });
    assert.ok(employee.state === "allowed" && employee.transform === "allow");
    assert.equal(employee.value, "10800000");
    for (const path of ["fictional.comments", "fictional.managerComments"]) assert.equal(classifyEvidenceLeaf(scope, path).transform, "drop");
    assert.throws(() => classifyEvidenceLeaf(scope, "fictional.undeclared"), /no declared evidence classification/u);
  });
  it("uses one exact template for computed comments and applies its optional holiday clause", () => {
    const fields = reconcileFictionalSeparation(fictionalSeparationDocument);
    assert.equal(fields.effectiveDate, "09/26/2026");
    assert.equal(fields.comments, fields.managerComments);
    assert.equal(fields.comments, renderOperationTemplate(separationCommentTemplate, { effective: fields.effectiveDate, "last-day": fields.lastDayWorked, holiday: fields.holidayPay, document: fields.documentNumber }));
    assert.ok(fields.comments.includes("Holiday Pay on 09/25/2026."));
    assert.ok(!reconcileFictionalSeparation({ ...fictionalSeparationDocument, holidayPay: "" }).comments.includes("Holiday Pay"));
  });
  it("retains complete computed and staged comments while withholding unregistered browser observations", async () => {
    const server = await startOperationAuthorityServer("separation");
    try {
      const response = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/logs`);
      assert.equal(response.status, 200);
      const section = RunDetailSectionResponseSchema.parse(await response.json());
      if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("separation-frozen-logs-missing");
      let page = section.payload;
      const client = createDashboardClient({ baseUrl: server.baseUrl });
      const cursors = new Set<string>();
      for (let count = 0; page.nextCursor.state === "present"; count += 1) {
        assert.ok(count < 128, "bounded complete log traversal");
        const cursor = page.nextCursor.value;
        assert.ok(!cursors.has(cursor), "log cursor must advance"); cursors.add(cursor);
        const next = await client.runSection(server.runId, "logs", cursor);
        assert.equal(next.section, "logs");
        if (next.section !== "logs") throw new Error("separation-pagination-section-mismatch");
        page = appendLogPage(page, cursor, next.payload);
      }
      assert.ok(page.operationStructure?.state === "observed");
      const structure = page.operationStructure;
      const confirmed = structure.observations.filter((item) => item.occurrence.state === "confirmed");
      assert.equal(confirmed.length, 37);
      assert.deepEqual(confirmed.filter((item) => item.action === "computed" && !item.occurrence.logicalActionId.includes("comments")).map((item) => item.occurrence.value?.value), ["09/25/2026", "09/25/2026", "09/26/2026"]);
      const comments = confirmed.filter((item) => item.occurrence.logicalActionId === "fill-comments" || item.occurrence.logicalActionId === "fill-managercomments");
      assert.equal(comments.length, 3);
      const exactComments = reconcileFictionalSeparation(fictionalSeparationDocument).comments;
      const computedComments = confirmed.filter((item) => item.action === "computed"
        && ["compute-comments", "compute-managercomments"].includes(item.occurrence.logicalActionId));
      assert.equal(computedComments.length, 2);
      assert.deepEqual(computedComments.map((item) => item.occurrence.value?.state === "observed" ? item.occurrence.value.value : item.occurrence.value?.state), [exactComments, exactComments]);
      assert.deepEqual(comments.map((item) => item.occurrence.value?.state), ["withheld", "withheld", "withheld"]);
      for (const item of comments) assert.equal("value" in (item.occurrence.value ?? {}), false);
      const run = server.database.authority.runs.get(server.runId);
      assert.ok(run);
      const staged = z.object({ fictional: z.object({ comments: z.string(), managerComments: z.string() }) });
      for (const node of ["ucpath", "kuali"]) {
        const checkpoint = server.database.authority.runCheckpoints.latest(run.envelope.workflow, run.envelope.itemId, node);
        assert.ok(checkpoint);
        const output = staged.parse(checkpoint.output.value);
        assert.equal(output.fictional.comments, exactComments);
        assert.equal(output.fictional.managerComments, exactComments);
      }
      assert.ok(structure.definition.invocations.some((invocation) => invocation.operation.actions.some((action) => action.kind === "resume-page")));
      const lifecycle = server.database.authority.runs.get(server.runId)?.lifecycle;
      assert.ok(lifecycle?.state === "terminal" && lifecycle.outcome === "done");
    } finally { await server.close(); }
  });
  it("parks before staging when an explicit operator decision is required", async () => {
    const server = await startOperationAuthorityServer("separation-ambiguous");
    try {
      const run = server.database.authority.runs.get(server.runId);
      assert.equal(run?.lifecycle.state, "parked-gate");
      const detail = RunDetailWireSchema.parse(await (await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}`)).json());
      assert.ok(detail.gate.state === "open");
      assert.equal(detail.gate.label, "Resolve conflicting separation dates");
      const response = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/logs`);
      const section = RunDetailSectionResponseSchema.parse(await response.json());
      if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("separation-gate-logs-missing");
      assert.ok(!section.payload.operationStructure.observations.some((item) => item.occurrence.logicalActionId.startsWith("fill-")));
    } finally { await server.close(); }
  });
  it("retains a named reload failure without inventing a confirmed field value", async () => {
    const server = await startOperationAuthorityServer("separation-failed");
    try {
      const lifecycle = server.database.authority.runs.get(server.runId)?.lifecycle;
      assert.ok(lifecycle?.state === "terminal" && lifecycle.outcome === "failed");
      assert.ok(server.database.authority.failures.listByRun(server.runId).some((item) => item.code === "DOCUMENT_READ_TIMEOUT"));
      const response = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/logs`);
      const section = RunDetailSectionResponseSchema.parse(await response.json());
      if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("separation-failure-logs-missing");
      const failed = section.payload.operationStructure.observations.find((item) => item.occurrence.invocationId === "verify-operation" && item.occurrence.state === "failed");
      assert.ok(failed);
      assert.equal(failed.occurrence.value, undefined);
      assert.ok(!section.payload.operationStructure.observations.some((item) => item.occurrence.invocationId === "verify-operation" && item.occurrence.state === "confirmed"));
      const responseFailure = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/failure`);
      assert.equal(responseFailure.status, 200);
      const failure = RunDetailSectionResponseSchema.parse(await responseFailure.json());
      assert.equal(failure.section, "failure");
      assert.match(JSON.stringify(failure.payload), /DOCUMENT_READ_TIMEOUT/u);
    } finally { await server.close(); }
  });
});
