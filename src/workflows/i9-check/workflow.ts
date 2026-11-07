import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { I9CheckCanonicalInput, I9CheckInput, i9CheckMatchKey } from "../../models/workflows/i9-check/input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { i9CheckPersonLookupDefinition } from "./steps/person-lookup/step.js";
import { i9CheckPersonMatchDefinition } from "./steps/person-match/step.js";
import { i9CheckRosterMatchDefinition } from "./steps/roster-match/step.js";
export const I9_CHECK_NODE_PURPOSES = [
  { nodeId: "identifier-match", purpose: "Search UCPath using usable identifiers without changing HR records." },
  { nodeId: "initial-name-search", purpose: "Read UCPath candidates when OCR supplied no usable identifier tuple." },
  { nodeId: "match-outcome", purpose: "Accept only a unique confirmed identifier match." },
  { nodeId: "name-search", purpose: "Read all departments for hire-date corroboration when identifiers did not resolve identity." },
  { nodeId: "retention-row", purpose: "Rematch the Action History evidence and derive one retention row." },
] as const;
export const i9CheckWorkflow = defineWorkflow({
  id: "i9-check",
  requiredWorkbookTypeIds: [],
  version: 1,
  code: "ic",
  label: "I-9 Check",
  icon: "ClipboardCheck",
  category: "separation",
  summary: "Checks one OCR-derived person in UCPath and produces an I-9 retention row for the workbook library.",
  input: I9CheckInput,
  canonicalInput: I9CheckCanonicalInput,
  inputSubject: "name",
  identity: { matchKey: i9CheckMatchKey },
  presentation: { title: input => input.person.name, subtitle: () => "I-9 retention check" },
  surface: { shape: "operation-member" },
  surfaces: {},
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  role: defineWorkflowRole({ kind: "composition" }),
  scenarios: ["i9-check/person"],
  details: [
    { key: "outcome", label: "UCPath", source: { kind: "result", fieldPath: "row.foundInUcpath" }, display: "text" },
    { key: "action", label: "Retention action", source: { kind: "result", fieldPath: "row.action" }, display: "text" },
    { key: "pps", label: "PPS ID", source: { kind: "result", fieldPath: "row.ppsEid" }, display: "text" },
    { key: "separation", label: "Separation date", source: { kind: "result", fieldPath: "row.separationDate" }, display: "text" },
  ],
  nodePurposes: I9_CHECK_NODE_PURPOSES,
  steps: author => {
    const matched = i9CheckPersonMatchDefinition.build(author);
    const looked = i9CheckPersonLookupDefinition.build(author, matched);
    const roster = i9CheckRosterMatchDefinition.build(author, matched, looked.search);
    return { steps: [...matched.steps, ...looked.steps, ...roster.steps], result: roster.result };
  },
});
