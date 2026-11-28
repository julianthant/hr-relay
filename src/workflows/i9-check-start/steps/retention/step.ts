import { z } from "zod";
import { ReadWorkbookResult } from "../../../../models/processing/workbooks/read-result.js";
import { OmittedStepResultArmSchema } from "../../../../models/workflow/step-omission.js";
import { ReadRetentionRow } from "../../../../models/workflows/i9-check/read-retention-row.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import { ReadI9CheckRows } from "../../../../models/workflows/i9-check-start/read-rows.js";
import { ReadI9CheckPublication } from "../../../../models/workflows/i9-check-start/read-publication.js";
import { I9CheckStartInput, i9CheckStartMatchKey } from "../../../../models/workflows/i9-check/start.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../../../models/workflows/person-lookup/input.js";
import { FingerprintSchema, WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { i9CheckWorkbookTable } from "../../../../rules/i9-check/workbook.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildDocuments, i9CheckStoppedResult, stopWithoutRead } from "../documents/step.js";
import { buildRosterReference } from "../roster-reference/step.js";

export const RETENTION_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "retention", label: "Check retention and collect results" }),
  manual: stopWithoutRead("Stops before saving without the person checks.", ["check-people", "read-rows"]),
  review: {
    starts: [{ nodeId: "check-people", each: "Each approved person" }],
    pages: [
      {
        id: "results-workbook",
        title: "I-9 Check results",
        mode: "Read only",
        nodeIds: ["read-rows"],
        lines: [
          { id: "rows", kind: "check", text: "Account for each approved person’s settled retention result.", nodeIds: ["read-rows"] },
          { id: "collect", kind: "read", text: "Collect one retention result for every approved person after the person checks finish.", nodeIds: ["read-rows"] },
        ],
        fields: [
          { id: "name", label: "Employee name", taskFields: [{ nodeId: "read-rows", kind: "output", fieldPath: "tracker.rows.employeeName" }], example: "Morrow, Bea",
            source: { origin: "Approved PDF records", detail: "The person whose I-9 sections you approved.",
              read: { stepKey: "documents", page: "I-9 PDFs and approved records", field: "Approved person" }, chain: [] } },
          { id: "eid", label: "Employee ID", taskFields: [{ nodeId: "read-rows", kind: "output", fieldPath: "tracker.rows.ucpathEmplId" }], example: PERSON_LOOKUP_EXAMPLE_EID,
            source: { origin: "Person check", detail: "The Employee ID confirmed by the delegated UCPath retention check; absent when identity is unresolved.", chain: [] } },
          { id: "result", label: "UCPath result", taskFields: [{ nodeId: "read-rows", kind: "output", fieldPath: "tracker.rows.foundInUcpath" }], example: "Yes",
            source: { origin: "Person check", detail: "Whether UCPath found one person, no person or an ambiguous identity.", chain: [] } },
          { id: "action", label: "Retention action", taskFields: [{ nodeId: "read-rows", kind: "output", fieldPath: "tracker.rows.action" }], example: "Keep",
            source: { origin: "Person check", detail: "Keep or Shred from the retention rule; left undecided when manual review is needed.", chain: [] } },
        ]
      }
    ],
    branchLabels: [],
  } as const
});

export const PUBLICATION_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "publication", label: "Save results and append to the tracker" }),
  manual: { off: "manual" as const, form: { fields: [] }, produces: {}, skips: ["save-workbook", "publish-results"] },
  review: {
    pages: [{
      id: "publish-results", title: "Publish I-9 Check results", mode: "Fill form", nodeIds: ["save-workbook", "publish-results"],
      lines: [
        { id: "save", kind: "action", text: "Save one results workbook and verify its publication receipt.", nodeIds: ["save-workbook", "publish-results"], when: [{ "dry-run": ["false"] }] },
        { id: "dry", kind: "check", text: "Preview the results workbook without saving it or changing the tracker.", nodeIds: ["save-workbook"], when: [{ "dry-run": ["true"] }] },
      ],
      fields: [{
        id: "workbook-state", label: "Results workbook", taskFields: [{ nodeId: "publish-results", kind: "output", fieldPath: "workbook.state" }],
        example: "Saved", source: { origin: "Spreadsheets", detail: "The workbook library receipt confirms the results were saved.", chain: [] },
      }],
    }],
    branchLabels: [],
    decisions: [{ id: "results-publication", label: "Results workbook", reads: { nodeId: "publish-results", fieldPath: "workbook.state" },
      nodeIds: ["save-workbook", "publish-results"], initial: "saved", outcomes: [
        { value: "saved", label: "Workbook saved", then: "Finishes with one results workbook and the retained rows for the tracker.", when: [{ "dry-run": ["false"] }] },
      ] }],
  } as const
});
const step = RETENTION_STEP, publication = PUBLICATION_STEP;
const entries = defineStepEntries(step);
const publicationEntries = defineStepEntries(publication);
const resultSchema = z.union([
  ReadI9CheckPublication.output,
  ReadI9CheckRows.output.extend({ workbook: OmittedStepResultArmSchema.extend({ step: z.literal(publication.key) }) }),
  i9CheckStoppedResult,
]);
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
  const workbook = author.task(publicationEntries.task("save-workbook", ReadWorkbookResult, { replay: "checkpoint", dryRun: "stop-before-publish" }), [rows], ({ outputs }) => ({
    name: "I-9 Check results", table: i9CheckWorkbookTable(outputs["read-rows"].tracker.rows),
  }));
  const published = author.task(publicationEntries.task("publish-results", ReadI9CheckPublication, { replay: "checkpoint" }), [rows, workbook], ({ outputs }) => ({ rows: outputs["read-rows"], workbook: outputs["save-workbook"] }));
  return { published, steps: [[step, [children, rows]], [publication, [workbook, published]]] as const,
    result: author.result(resultSchema, [rows, published], ({ outputs }): z.input<typeof resultSchema> => {
      const saved = outputs["publish-results"];
      if (saved !== undefined) return saved;
      const retained = outputs["read-rows"];
      return retained === undefined ? { state: "stopped", reason: "retention-results-unavailable" }
        : { ...retained, workbook: { state: "omitted", step: publication.key } };
    }) };
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
