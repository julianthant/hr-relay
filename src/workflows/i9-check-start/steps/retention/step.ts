import { ReadWorkbookResult } from "../../../../models/processing/workbooks/read-result.js";
import { ReadRetentionRow } from "../../../../models/workflows/i9-check/read-retention-row.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import { ReadI9CheckRows } from "../../../../models/workflows/i9-check-start/read-rows.js";
import { ReadI9CheckPublication } from "../../../../models/workflows/i9-check-start/read-publication.js";
import { I9CheckStartInput, i9CheckStartMatchKey } from "../../../../models/workflows/i9-check/start.js";
import { FingerprintSchema, WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { i9CheckWorkbookTable } from "../../../../rules/i9-check/workbook.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildDocuments } from "../documents/step.js";
import { buildRosterReference } from "../roster-reference/step.js";

const step = Object.freeze({
  ...defineWorkflowStep({ key: "retention", label: "Check retention and save results" }),
  review: {
    pages: [
      {
        id: "results-workbook",
        title: "I-9 Check results",
        mode: "Read only",
        nodeIds: ["read-rows", "save-workbook", "publish-results"],
        lines: [
          { id: "rows", kind: "check", text: "Account for each approved person’s settled retention result.", nodeIds: ["read-rows"] },
          { id: "save", kind: "action", text: "Save one results workbook and verify its publication receipt.", nodeIds: ["save-workbook", "publish-results"] }
        ],
        fields: []
      }
    ],
    branchLabels: []
  } as const
});
const entries = defineStepEntries(step);
type Author = WorkflowAuthor<typeof I9CheckStartInput>;
export function buildRetention(author: Author, reference: ReturnType<typeof buildRosterReference>) {
  const children = author.delegate({ id: "check-people", label: "Check each approved person in UCPath",
    target: { id: WorkflowIdSchema.parse("i9-check"), input: I9CheckInput, result: ReadRetentionRow.output },
    edgeId: "i9-people", cardinality: "many", await: "terminal", join: "all-settled",
    policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
  }, [reference.prepared], { bind: ({ outputs }) => outputs["read-requests"].children, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
  const rows = author.task(entries.task("read-rows", ReadI9CheckRows, { replay: "checkpoint" }), [reference.prepared, children], ({ input, outputs }) => ({
    batchKey: FingerprintSchema.parse(i9CheckStartMatchKey(input)), prepared: outputs["read-requests"], outcomes: [...outputs["check-people"]],
  }));
  const workbook = author.task(entries.task("save-workbook", ReadWorkbookResult, { replay: "checkpoint", dryRun: "stop-before-publish" }), [rows], ({ outputs }) => ({
    name: "I-9 Check results", table: i9CheckWorkbookTable(outputs["read-rows"].tracker.rows),
  }));
  const published = author.task(entries.task("publish-results", ReadI9CheckPublication, { replay: "checkpoint" }), [rows, workbook], ({ outputs }) => ({ rows: outputs["read-rows"], workbook: outputs["save-workbook"] }));
  return { published, steps: [[step, [children, rows, workbook, published]]] as const,
    result: author.result(ReadI9CheckPublication.output, [published], ({ outputs }) => outputs["publish-results"]) };
}
export const i9CheckStartRetentionDefinition = defineStep({ group: step, build: buildRetention,
  nodePurposes: [
    { nodeId: "check-people", purpose: "Run the existing read-only I-9 person child once for each approved person." },
    { nodeId: "read-rows", purpose: "Require every exact person child before collecting one retention row per person." },
    { nodeId: "save-workbook", purpose: "Publish one run-owned results workbook through the existing workbook library." },
    { nodeId: "publish-results", purpose: "Require the workbook receipt and project the retained rows to the configured tracker." },
  ],
  proof: { id: "i9-check-start-retention", order: 27, build: (parent: WorkflowDefinition<typeof I9CheckStartInput>) => ({
    ...inheritStepProof(parent), artifactProjections: parent.artifactProjections,
    code: "icsp", label: "I-9 retention publication", summary: "Proves person checks and one complete results publication with source review and reference prerequisites.",
    steps: (author: Author) => {
      const documents = buildDocuments(author), reference = buildRosterReference(author, documents), retained = buildRetention(author, reference);
      return { steps: [...documents.steps, ...reference.steps, ...retained.steps], result: retained.result };
    },
  }) },
});
