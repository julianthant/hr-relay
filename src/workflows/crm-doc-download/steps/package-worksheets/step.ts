import type { z } from "zod";
import { CrmDocDownloadInput } from "../../../../models/workflows/crm-doc-download/input.js";
import { ReadCrmWorksheetArchives } from "../../../../models/workflows/crm-doc-download/read-worksheet-archives.js";
import { CrmDocumentRowsSchema, CrmDocumentRowChoiceSchema } from "../../../../models/workflows/crm-doc-download/read-document-rows.js";
import { bindCrmWorksheetPeople } from "../../../../rules/crm-doc-download/reference.js";
import { defineStep, defineStepEntries, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition, type WorkflowEntry } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import type { buildReadIdocs } from "../read-idocs/step.js";

const group = Object.freeze({
  ...defineWorkflowStep({ key: "package-worksheets", label: "Package worksheet archives" }), system: "local",
  operatorFields: [
    { label: "Worksheet archives", sources: [{ nodeId: "worksheet-archives", kind: "output", fieldPath: "worksheetCount" }] },
    { label: "People", sources: [{ nodeId: "worksheet-archives", kind: "output", fieldPath: "personCount" }] },
    { label: "PDF documents", sources: [{ nodeId: "worksheet-archives", kind: "output", fieldPath: "documentCount" }] },
    { label: "Archive", sources: [{ nodeId: "worksheet-archives", kind: "output", fieldPath: "worksheets.relativePath" }] },
  ],
  review: {
    pages: [
      {
        id: "worksheet-archives",
        title: "Worksheet archives",
        mode: "Read only",
        nodeIds: ["worksheet-archives"],
        lines: [
          { id: "package", kind: "action", text: "Package the verified PDFs into one archive for each resolved worksheet.", nodeIds: ["worksheet-archives"] },
          { id: "check", kind: "check", text: "Retain every person and document in the archive counts.", nodeIds: ["worksheet-archives"] }
        ],
        fields: [
          {
            id: "worksheet-archives",
            operatorField: "Worksheet archives",
            source: {
              origin: "Downloaded PDFs and saved roster",
              detail: "Number of worksheet archives.",
              chain: [],
              read: { stepKey: "package-worksheets", page: "Worksheet archives", field: "Worksheet archives" }
            }
          },
          {
            id: "people",
            operatorField: "People",
            source: {
              origin: "Downloaded PDFs and saved roster",
              detail: "Number of people included.",
              chain: [],
              read: { stepKey: "package-worksheets", page: "Worksheet archives", field: "People" }
            }
          },
          {
            id: "pdf-documents",
            operatorField: "PDF documents",
            source: {
              origin: "Downloaded PDFs and saved roster",
              detail: "Number of downloaded PDF documents included.",
              chain: [],
              read: { stepKey: "package-worksheets", page: "Worksheet archives", field: "PDF documents" }
            }
          },
          {
            id: "archive",
            operatorField: "Archive",
            source: {
              origin: "Downloaded PDFs and saved roster",
              detail: "The archive associated with the resolved worksheet.",
              chain: [],
              read: { stepKey: "package-worksheets", page: "Worksheet archives", field: "Archive" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} as const);
const entries = defineStepEntries(group);

export function buildPackageWorksheets(author: WorkflowAuthor<typeof CrmDocDownloadInput>, downloaded: ReturnType<typeof buildReadIdocs>, reference: Readonly<{
  rows: WorkflowEntry<"document-rows", z.output<typeof CrmDocumentRowsSchema>, false>;
  choice: WorkflowEntry<"document-row-choice", z.output<typeof CrmDocumentRowChoiceSchema>, true>;
}>) {
  const archives = author.task(entries.task("worksheet-archives", ReadCrmWorksheetArchives, { replay: "checkpoint" }),
    [downloaded.documents, reference.rows, reference.choice], ({ outputs }) => ({ people: bindCrmWorksheetPeople(
      outputs["document-pdfs"], outputs["document-rows"], outputs["document-row-choice"]),
    }));
  return { archives, steps: [[group, [archives]]] as const,
    result: author.result(ReadCrmWorksheetArchives.output, [archives], ({ outputs }) => outputs["worksheet-archives"]) };
}

export const crmDocumentPackageWorksheetsDefinition = defineStep({
  group, build: buildPackageWorksheets,
  nodePurposes: [{ nodeId: "worksheet-archives", purpose: "Verify retained PDFs and exact row choices, then retain one ZIP per worksheet and one publication collection." }],
  proof: { id: "crm-doc-download-package-worksheets", order: 24,
    build: (parent: WorkflowDefinition<typeof CrmDocDownloadInput>) => ({
      ...inheritStepProof(parent), code: "cdp", label: group.label,
      summary: "Proves the complete identity-to-worksheet archive path and its retained output collection.",
      steps: () => ({ steps: parent.steps, result: parent.result }),
    }),
  },
});
