import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";
import { redactObservedDataPoints } from "../../../src/backend/logs/observed-data.js";
import { ExtractPdfPages } from "../../../src/models/processing/extraction/extract-pdf-pages.js";
import { classifyEvidenceLeaf, evidenceScopeKey, type EvidenceValueScope } from "../../../src/models/trust/evidence-classification.js";
import { OcrInputSchema } from "../../../src/models/workflows/ocr/input.js";
import { ReadOcrResult } from "../../../src/models/workflows/ocr/read-result.js";
import { ReadOcrReviewSeed } from "../../../src/models/workflows/ocr/read-review-seed.js";
import { ReadOcrSourcePages } from "../../../src/models/workflows/ocr/read-source-pages.js";
import { OcrApprovalReferenceSchema, OcrWorkflowResultSchema } from "../../../src/models/workflows/ocr/result.js";
import { OcrPageWorkflowInputSchema } from "../../../src/models/workflows/ocr-page/input.js";
import { ReadManualOcrReading } from "../../../src/models/workflows/ocr-page/read-manual-reading.js";
import { ReadOcrPageReading } from "../../../src/models/workflows/ocr-page/read-page-reading.js";
import { GateIdSchema, TaskIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { redactValue } from "../../../src/rules/redaction/redaction.js";
import { JsonValueSchema } from "../../../src/rules/validation/canonical-json.js";
import { RecordedDataPointSchema } from "../../../src/rules/workflow/task-provenance.js";

function schemaLeaves(schema: JSONSchema.JSONSchema | boolean, prefix = ""): readonly string[] {
  if (typeof schema === "boolean") throw new Error("OCR evidence requires an explicit schema");
  assert.equal(schema.$ref, undefined, "OCR evidence schemas must be inspected without unresolved references");
  if (schema.anyOf !== undefined || schema.oneOf !== undefined) {
    const variants = schema.anyOf ?? schema.oneOf;
    assert.ok(variants);
    return [...new Set(variants.flatMap(variant => schemaLeaves(variant, prefix)))];
  }
  if (schema.type === "object") {
    const properties = schema.properties;
    assert.ok(properties);
    const entries = Object.entries(properties);
    if (entries.length > 0) return entries.flatMap(([key, value]) => schemaLeaves(value, `${prefix}${key}.`));
  }
  assert.ok(prefix.length > 0);
  return [prefix.slice(0, -1)];
}

const contracts = [ExtractPdfPages, ReadOcrSourcePages, ReadOcrReviewSeed, ReadOcrResult,
  ReadManualOcrReading, ReadOcrPageReading] as const;
const scopes: readonly Readonly<{ scope: EvidenceValueScope; schema: z.ZodType }>[] = [
  ...contracts.map(contract => ({ scope: { kind: "task-output" as const, taskId: contract.id }, schema: contract.output })),
  ...["ocr", "ocr-source-pages"].map(id => ({
    scope: { kind: "workflow-input" as const, workflowId: WorkflowIdSchema.parse(id) }, schema: OcrInputSchema,
  })),
  ...["ocr-page", "ocr-page-reading"].map(id => ({
    scope: { kind: "workflow-input" as const, workflowId: WorkflowIdSchema.parse(id) }, schema: OcrPageWorkflowInputSchema,
  })),
  ...["ocr-page", "ocr-page-reading"].map(id => ({
    scope: { kind: "workflow-result" as const, workflowId: WorkflowIdSchema.parse(id) }, schema: ReadOcrPageReading.output,
  })),
  { scope: { kind: "workflow-result", workflowId: WorkflowIdSchema.parse("ocr") }, schema: OcrWorkflowResultSchema },
  { scope: { kind: "workflow-result", workflowId: WorkflowIdSchema.parse("ocr-source-pages") }, schema: ReadOcrSourcePages.output },
  { scope: { kind: "gate-result", workflowId: WorkflowIdSchema.parse("ocr"), gateId: GateIdSchema.parse("approve-records") }, schema: OcrApprovalReferenceSchema },
];

describe("OCR producer evidence classifications", () => {
  for (const { scope, schema } of scopes) {
    it(`declares every schema arm of ${evidenceScopeKey(scope)}`, () => {
      const projection = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" });
      for (const path of schemaLeaves(projection)) classifyEvidenceLeaf(scope, path);
      for (const path of ["unexpected", "record.unexpected", "extraction.unexpected", "manifest.document.unexpected"]) {
        assert.throws(() => classifyEvidenceLeaf(scope, path), /no declared evidence classification/u);
      }
    });
  }

  for (const contract of contracts) {
    it(`admits ${contract.id} observations through the executor's redactor`, () => {
      const output = JsonValueSchema.parse(contract.output.parse(contract.example));
      assert.ok(output !== null && typeof output === "object" && !Array.isArray(output));
      const points = Object.entries(output).map(([field, value]) => RecordedDataPointSchema.parse({
        direction: "read", field, value, recordedAt: "2026-11-02T00:00:00.000Z",
        execution: { runId: "11111111-2222-4333-8444-555555555555", traceId: "oc-000000-1111",
          attempt: 1, workflowId: "ocr", nodeId: "read-source", taskId: contract.id },
      }));
      const observed = redactObservedDataPoints(contract.id, points);
      assert.deepEqual(observed.map(point => point.field), Object.keys(output));
      assert.ok(observed.every(point => point.values.length > 0));
    });
  }

  it("drops captured readings, identities and source references at diagnostic export", () => {
    const declarations = [
      [ExtractPdfPages.id, "pages"], [ReadOcrSourcePages.id, "pages"],
      [ReadOcrReviewSeed.id, "records"], [ReadOcrReviewSeed.id, "accounting.outcomes"],
      [ReadOcrResult.id, "identities"], [ReadOcrResult.id, "review.roster.rows"],
      [ReadManualOcrReading.id, "extraction.record.answers"], [ReadManualOcrReading.id, "extraction.source.actorId"],
      [ReadOcrPageReading.id, "extraction.source.modelId"], [ReadOcrPageReading.id, "extraction.source.providerId"],
      [ReadOcrPageReading.id, "input.image.sha256"],
    ] as const;
    for (const [taskId, path] of declarations) {
      const declaration = classifyEvidenceLeaf({ kind: "task-output", taskId }, path);
      assert.equal(declaration.classification, "sensitive-hr");
      assert.equal(declaration.transform, "drop");
      assert.deepEqual(redactValue(declaration.classification, declaration.transform, "synthetic-sensitive"),
        { state: "redacted", classification: "sensitive-hr", transform: "drop" });
    }
  });

  it("does not lend an OCR producer's declarations to a foreign task", () => {
    assert.throws(() => classifyEvidenceLeaf({ kind: "task-output", taskId: TaskIdSchema.parse("ucpath/search-person-org") },
      "extraction.record.answers"), /no declared evidence classification/u);
  });

  it("retains the local-agent refusal after classifying rejected input metadata", () => {
    const reading = ReadManualOcrReading.example;
    assert.equal(ReadManualOcrReading.output.safeParse({ ...reading, extraction: { ...reading.extraction,
      source: { kind: "local-agent", agentId: "fixture-agent", invocation: "fixture-call" },
    } }).success, false);
  });
});
