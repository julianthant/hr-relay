import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createOcrReviewAdapter } from "../../../../src/backend/processing/providers/ocr-review-adapter.js";
import { createApprovedOcrRecordReader } from "../../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import { readDelegationEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { delegationEvidenceOutput } from "../../../../src/models/run/result.js";
import { ReadApprovedOcrRecords } from "../../../../src/models/processing/ocr/read-approved-records.js";
import { OcrWorkflowResultSchema } from "../../../../src/models/workflows/ocr/result.js";
import { OcrInputSchema, OcrCanonicalInputSchema, OCR_INPUT_EXAMPLE } from "../../../../src/models/workflows/ocr/input.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflow, composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { compileFixtureWorkflow } from "../../../support/fixtures/workflow-definition-fixtures.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { WorkflowIdSchema, NodeIdSchema } from "../../../../src/rules/identity/ids.js";
import type { z } from "zod";

const parent = composeWorkflowModule(compileFixtureWorkflow(defineWorkflow({
  id: "ocr-selection-parent", version: 1, code: "osp", label: "Selection parent", icon: "FileScan", category: "documents",
  input: OcrInputSchema, canonicalInput: defineCanonicalInput(OcrInputSchema, OcrCanonicalInputSchema, [OCR_INPUT_EXAMPLE]),
  inputSubject: "document", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], role: defineWorkflowRole({ kind: "composition" }), scenarios: ["ocr/approved-records"],
  identity: { matchKey: input => input.document.sha256 }, presentation: { title: () => "Selection parent" },
  steps: ({ delegate, result }) => {
    const source = delegate({ id: "read-documents", target: { id: WorkflowIdSchema.parse("ocr"), input: OcrInputSchema, result: OcrWorkflowResultSchema },
      edgeId: "documents", cardinality: "many", await: "terminal", join: "all-settled",
      policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
    }, [], { bind: ({ input }) => [input], deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "documents", label: "Documents" }, [source]]], result: result(OcrCanonicalInputSchema, [], ({ input }) => input) };
  },
})), []);
const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("ocr/approved-records — reads only the corrected, explicitly selected records from an authenticated OCR child", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2, parent });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1, 1)).state, "applied");
  const revision = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(revision);
  const approval = f.approval([revision.records[1].recordId]);
  assert.equal(f.canonical.kernel.execute(approval).state, "applied");
  await f.canonical.execute(f.parentRun, new AbortController().signal);
  const run = f.database.authority.runs.get(f.parentRun.envelope.runId); assert.ok(run);
  const outcomes = ReadApprovedOcrRecords.input.shape.outcomes.parse(delegationEvidenceOutput(readDelegationEvidence(f.database.authority, run.envelope.runId, "read-documents"), OcrWorkflowResultSchema));
  const adapter = createOcrReviewAdapter({ read: createApprovedOcrRecordReader({ database: f.database, reader: f.canonical.lifecycle, run }), clock: f.clock });
  const invoke = async (value: z.input<typeof ReadApprovedOcrRecords.input>) => adapter.invoke({ capability: "ocr.review",
    payload: { schemaHash: deriveSchemaHash(ReadApprovedOcrRecords.input, "output"), value: ReadApprovedOcrRecords.input.parse(value) } },
  { signal: new AbortController().signal, deadlineMonotonicMs: Infinity, requestId: "fixture" });
  const input = { delegationNodeId: NodeIdSchema.parse("read-documents"), outcomes };
  const response = await invoke(input);
  assert.equal(response.response.state, "produced");
  if (response.response.state !== "produced") assert.fail("Selection read refused");
  const result = ReadApprovedOcrRecords.output.parse(response.response.value.value);
  assert.equal(result.state, "ready");
  if (result.state !== "ready") assert.fail("Selection read refused");
  assert.deepEqual(result.sources[0].snapshot.records.map(record => record.recordId), [revision.records[1].recordId]);
  assert.deepEqual(result.sources[0].snapshot.records[0].fields, f.corrected);
  assert.notDeepEqual(result.sources[0].snapshot.records[0].fields, result.sources[0].review.records[1].fields);
  const generation = f.database.getMeta().authorityGeneration;
  await assert.rejects(invoke({ ...input, delegationNodeId: NodeIdSchema.parse("foreign") }));
  await assert.rejects(invoke({ ...input, outcomes: [] }));
  for (const change of ["missing", "foreign", "altered"] as const) {
    const altered = input.outcomes.map(outcome => {
      assert.equal(outcome.state, "done");
      if (outcome.state !== "done" || outcome.output.approvedSnapshot === null) assert.fail("Missing fixture selection");
      return { ...outcome, output: { ...outcome.output, approvedSnapshot: change === "missing" ? null : {
        ...outcome.output.approvedSnapshot,
        ...(change === "foreign" ? { sourceRunId: run.envelope.runId } : { digest: "f".repeat(64) }),
      } } };
    });
    await assert.rejects(invoke({ ...input, outcomes: altered }));
  }
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 2, 1)).state, "applied");
  await assert.rejects(invoke(input), /OCR_REVIEW_REFUSED/u);
  assert.ok(f.database.getMeta().authorityGeneration >= generation);
});
