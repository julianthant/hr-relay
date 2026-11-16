import { expect, it } from "vitest";
import { i9CheckStartWorkflow } from "../../../src/workflows/i9-check-start/workflow.js";
import { I9CheckStartInput, i9CheckStartMatchKey } from "../../../src/models/workflows/i9-check/start.js";
import { OcrInputSchema } from "../../../src/models/workflows/ocr/input.js";
import { descriptorRuntimeNodes, workflowDryRunSupport, workflowPlanning, workflowProjections, workflowTerminalResultExecution } from "../../../src/workflow-kit/workflow.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { i9CheckModule, i9LookupModule, ocrModule } from "../../support/helpers/registered-workflows.js";
import { i9ApprovedSource } from "../../support/fixtures/i9-check-start.js";

it("compiles one PDF batch with admitted OCR and existing person children, one workbook and a blocking tracker projection", () => {
  const descriptor = compileWorkflow(i9CheckStartWorkflow).descriptor;
  const nodes = descriptorRuntimeNodes(descriptor);
  expect(descriptor.surface).toEqual({ shape: "single" });
  expect(descriptor.timeline.map(step => step.key)).toEqual(["documents", "roster-reference", "retention"]);
  expect(nodes.filter(node => node.kind === "child-run").map(node => node.target.id)).toEqual(["ocr", "i9-check"]);
  expect(nodes.every(node => node.kind === "task" || node.kind === "child-run")).toBe(true);
  expect(workflowProjections(descriptor).contracts.every(contract => contract.effect === "read")).toBe(true);
  expect(nodes.filter(node => node.kind === "task" && node.uses.id === "workbooks/read-result")).toHaveLength(1);
  expect(descriptor.artifactProjections).toEqual([{ id: "i9-check-tracker", source: { nodeId: "publish-results", fieldPath: "tracker" }, keyFields: ["batchKey"], sink: "xlsx-retention", blocking: true }]);
  expect(workflowTerminalResultExecution(descriptor).dependsOn).toEqual(["publish-results"]);
  const documents = nodes.find(node => node.id === "read-documents");
  if (documents?.kind !== "child-run" || documents.cardinality !== "many") throw new Error("Missing PDF delegation");
  const first = i9ApprovedSource(1, [{ eid: "10000001", kind: "i9-section1" }]);
  const second = i9ApprovedSource(2, [{ eid: "10000002", kind: "i9-section1" }]);
  const input = I9CheckStartInput.parse({ documents: [first.requestDocument, second.requestDocument], asOf: "2026-11-01", reviewerName: "Example Reviewer" });
  const children = OcrInputSchema.array().parse(documents.bind({ input, outputs: {} }));
  expect(children.map(child => child.document.id)).toEqual(input.documents.map(source => source.document.id));
  expect(children.every(child => child.formType === "i9" && child.approval === "release" && child.sourceRunId === undefined)).toBe(true);
  expect(children.map(child => child.fileName)).toEqual(input.documents.map(source => source.fileName));
  const { title } = workflowPlanning(descriptor);
  expect(title({ ...input, documents: [input.documents[0]] })).toBe(input.documents[0]?.fileName);
  expect(title(input)).toBe("I-9 Check · 2 PDFs");
  expect(i9CheckStartMatchKey(input)).toBe(i9CheckStartMatchKey({ ...input, documents: input.documents.toReversed() }));
  expect(I9CheckStartInput.safeParse({ ...input, documents: [input.documents[0], input.documents[0]] }).success).toBe(false);
});

it("supports a dry run that previews the results workbook; child-only workflows stay unsupported", () => {
  const descriptor = compileWorkflow(i9CheckStartWorkflow).descriptor;
  expect(workflowDryRunSupport(descriptor)).toEqual({ state: "supported", firstPublicationNodeId: "save-workbook" });
  expect(descriptor.surfaces?.uploadRun?.supportsDryRun).toBe(true);
  for (const module of [ocrModule, i9CheckModule, i9LookupModule]) {
    expect(workflowDryRunSupport(module.descriptor), module.descriptor.id).toEqual({ state: "unsupported", reason: "no-transaction-node" });
  }
});
