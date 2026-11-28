import { I9LookupInputSchema, I9ReadSection2Signer, I9SignerOutputSchema, manualI9Signer } from "../../../../models/systems/i9/read-section2-signer.js";
import { ReadI9LookupResult } from "../../../../models/workflows/i9-lookup/read-result.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";

const lookupManual: StepManualDeclaration = {
  off: "values",
  form: { format: "i9-signer-result", fields: [
    { key: "i9Status", label: "I-9 status", kind: "enum", values: ["signed", "unsigned", "historical", "not-found", "unable-to-access"] },
    { key: "signerName", label: "Authorized official signer", kind: "text", optional: true },
    { key: "profileId", label: "I-9 profile ID", kind: "text", optional: true, withheld: true, help: "Digits only. Required for Signed and Historical." },
    { key: "i9Id", label: "I-9 record ID", kind: "text", optional: true, withheld: true, help: "Digits only. Required for Signed and Historical." },
  ] },
  keeps: ["lookup"],
  produces: { "lookup-source": ({ facts }) => I9SignerOutputSchema.parse(manualI9Signer(facts)) },
};

export const I9_LOOKUP_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "lookup", label: "Look up Section 2 signer" }),
  manual: lookupManual,
  description: "Search I-9 Complete by name and read the electronic Section 2 audit signer.",
  system: "i9",
  operatorFields: [
    {
      label: "Authorized official signer", example: "Quillan, Petra", sources: [
        { nodeId: "lookup-source", kind: "output", fieldPath: "signerName" },
        { nodeId: "lookup", kind: "output", fieldPath: "signerName" },
      ]
    },
    {
      label: "I-9 status", sources: [
        { nodeId: "lookup-source", kind: "output", fieldPath: "i9Status" },
        { nodeId: "lookup", kind: "output", fieldPath: "i9Status" },
      ], display: { cases: [
        { value: "signed", text: "Signed" }, { value: "unsigned", text: "Unsigned" },
        { value: "historical", text: "Historical" }, { value: "not-found", text: "Not found" },
        { value: "unable-to-access", text: "Unable to access" },
      ] },
    },
  ],
  review: {
    pages: [
      {
        id: "employee-search",
        title: "Search for Existing Employee",
        mode: "Fill form",
        nodeIds: ["lookup-source"],
        lines: [
          { id: "search-by-name", kind: "action", text: "Search I-9 Complete using the name and any additional identity details supplied by the parent workflow.", nodeIds: ["lookup-source"] },
          { id: "options", kind: "click", target: "Search Options", nodeIds: ["lookup-source"] },
          { id: "clear", kind: "click", target: "Clear Search Filters & Results", nodeIds: ["lookup-source"] },
          { id: "search", kind: "click", target: "Search", nodeIds: ["lookup-source"] },
          {
            id: "check-search-results",
            kind: "check",
            text: "Check exact displayed names and require one matching profile before opening a record.",
            nodeIds: ["lookup-source"]
          }
        ],
        fields: [
          { id: "last-name", label: "Last name", inputField: "lastName", example: "Morrow",
            source: { origin: "Parent workflow", detail: "The person's last name supplied by the workflow that requests this lookup.", chain: [] } },
          { id: "first-name", label: "First name", inputField: "firstName", example: "Bea",
            source: { origin: "Parent workflow", detail: "The person's first name supplied by the workflow that requests this lookup.", chain: [] } },
        ]
      },
      {
        id: "i9-record-summary",
        title: "I-9 Record Summary Information",
        mode: "Read only",
        when: [{ "signer-status": ["signed"] }],
        nodeIds: ["lookup-source", "lookup"],
        lines: [
          {
            id: "read-section-two",
            kind: "read",
            text: "Read the Section 2 signing event from the record audit history when a matching record is available.",
            nodeIds: ["lookup-source"]
          },
          { id: "report-signer-status", kind: "check", text: "Return the signer and I-9 status from the verified lookup outcome.", nodeIds: ["lookup"] }
        ],
        fields: [
          {
            id: "authorized-official-signer",
            operatorField: "Authorized official signer",
            source: {
              origin: "I-9 Complete",
              detail: "The official named on the Signed Section 2 audit event; blank when there is no signed Section 2.",
              read: { stepKey: "lookup", page: "I-9 Record Summary Information", field: "Authorized official signer" },
              chain: [
                { label: "Employee search", detail: "Confirm one exact displayed name and profile before reading its I-9 summary." },
                { label: "Section 2 audit", detail: "Read the signer name from the Signed Section 2 audit row when present." },
                { label: "Lookup result", detail: "Carry the verified signer into the workflow result." }
              ]
            }
          }
        ]
      },
      {
        id: "lookup-result", title: "I-9 lookup result", mode: "Read only", nodeIds: ["lookup-source", "lookup"],
        lines: [],
        fields: [
          {
            id: "i9-status",
            operatorField: "I-9 status",
            source: {
              origin: "I-9 Complete",
              detail: "The lookup classification: signed, unsigned, historical, not found or unable to access.",
              read: { stepKey: "lookup", page: "I-9 lookup result", field: "I-9 status" },
              chain: [
                { label: "Employee search", detail: "Classify no results or restricted access from the employee search." },
                { label: "Record summary", detail: "For a matching record, classify historical routing or the Section 2 audit event." },
                { label: "Lookup result", detail: "Carry the verified status into the workflow result." }
              ]
            }
          }
        ]
      }
    ],
    branchLabels: [],
    decisions: [{ id: "signer-status", label: "Section 2 result", reads: { nodeId: "lookup", fieldPath: "i9Status" },
      nodeIds: ["lookup-source", "lookup"], initial: "signed", outcomes: [
        { value: "signed", then: "Returns the official named on the Signed Section 2 audit event and finishes." },
        { value: "unsigned", then: "Returns Unsigned without a signer and finishes; no Section 2 signature was found." },
        { value: "historical", then: "Returns Historical without a signer and finishes; the record uses the historical route." },
        { value: "not-found", then: "Returns Not found without a signer and finishes; no matching employee record was found." },
        { value: "unable-to-access", then: "Returns Unable to access without a signer and finishes; the search reports restricted access." },
      ] }],
  } as const,
} as const);
const entries = defineStepEntries(I9_LOOKUP_STEP);
const signer = entries.task("lookup-source", I9ReadSection2Signer, { label: "Read Section 2 signer", replay: "checkpoint" });
const lookup = entries.task("lookup", ReadI9LookupResult, { replay: "always-rerun" });

export function buildStep(author: WorkflowAuthor<typeof I9LookupInputSchema>) {
  const { task, result } = author;
  const source = task(signer, [], ({ input }) => input);
  const read = task(lookup, [source], ({ outputs }) => ({ signer: outputs["lookup-source"] }));
  return { steps: [[I9_LOOKUP_STEP, [source, read]]] as const, result: result(I9SignerOutputSchema, [read], ({ outputs }) => outputs.lookup) };
}

export const i9LookupStepDefinition = defineStep({
  group: I9_LOOKUP_STEP, build: buildStep,
  proof: {
    id: "i9-lookup-lookup", order: 9,
    build: (parent: WorkflowDefinition<typeof I9LookupInputSchema, typeof I9SignerOutputSchema>) => ({
      ...inheritStepProof(parent), code: "ilk", label: I9_LOOKUP_STEP.label, summary: "Proves the I-9 signer task and its workflow result in one lookup checkpoint.", details: parent.details,
      steps: () => ({ steps: parent.steps, result: parent.result }),
    }),
  },
});
