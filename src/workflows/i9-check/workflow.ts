import { defineWorkflow, defineStepEntries } from "../../workflow-kit/workflow-definition.js";
import type { WorkflowDefinitionSpec } from "../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../workflow-kit/workflow.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { I9CheckInput, I9CheckCanonicalInput } from "../../models/workflows/i9-check/input.js";
import { ReadMatchOutcome, ReadRetentionRow } from "../../models/workflows/i9-check/check.js";
import { searchPersonMatchTask, personMatchInput } from "./tasks/search-person-match.js";
import { searchPersonOrgTask, personOrgInput } from "./tasks/search-person-org.js";

export const personMatch = defineWorkflowStep({ key: "person-match", label: "Match person" });
export const personLookup = defineWorkflowStep({ key: "person-lookup", label: "Check hire date" });
export const rosterMatch = defineWorkflowStep({ key: "roster-match", label: "Match retention roster" });
const match = defineStepEntries(personMatch), roster = defineStepEntries(rosterMatch);

type I9Author = Parameters<WorkflowDefinitionSpec<typeof I9CheckInput, typeof ReadRetentionRow.output>["steps"]>[0];
export function personMatchEntries({ task }: I9Author) {
  const matching = task(searchPersonMatchTask(personMatch), [], ({ input }) => personMatchInput(input));
  const initialSearch = task(searchPersonOrgTask(personMatch, "initial-name-search", { kind: "is-false", of: { from: "input", path: "person.useMatch" } }), [], ({ input }) => personOrgInput(input));
  const initial = task(match.task("match-outcome", ReadMatchOutcome, { replay: "always-rerun" }), [matching, initialSearch], ({ outputs }) => ({ match: outputs["identifier-match"] }));
  return { matching, initialSearch, initial };
}
export function personLookupEntries({ task }: I9Author, matched: ReturnType<typeof personMatchEntries>) {
  return task(searchPersonOrgTask(personLookup, "name-search", { kind: "is-true", of: { from: "node", nodeId: "match-outcome", path: "shouldLookup" } }), [matched.initial], ({ input }) => personOrgInput(input));
}
export const i9CheckSteps: WorkflowDefinitionSpec<typeof I9CheckInput, typeof ReadRetentionRow.output>["steps"] = author => {
  const { task, result } = author;
  const matched = personMatchEntries(author), search = personLookupEntries(author, matched);
  const row = task(roster.task("retention-row", ReadRetentionRow, { replay: "always-rerun" }), [matched.initial, matched.initialSearch, search], ({ input, outputs }) => ({
    input, initial: outputs["match-outcome"].identity, search: input.person.useMatch ? outputs["name-search"] : outputs["initial-name-search"],
  }));
  return { steps: [[personMatch, [matched.matching, matched.initialSearch, matched.initial]], [personLookup, [search]], [rosterMatch, [row]]],
    result: result(ReadRetentionRow.output, [row], ({ outputs }) => outputs["retention-row"]) };
};

export const I9_CHECK_NODE_PURPOSES = [
  { nodeId: "identifier-match", purpose: "Search UCPath using usable identifiers without changing HR records." },
  { nodeId: "initial-name-search", purpose: "Read UCPath candidates when OCR supplied no usable identifier tuple." },
  { nodeId: "match-outcome", purpose: "Accept only a unique confirmed identifier match." },
  { nodeId: "name-search", purpose: "Read all departments for hire-date corroboration when identifiers did not resolve identity." },
  { nodeId: "retention-row", purpose: "Rematch the Action History evidence and derive one retention row." },
] as const;

export const i9CheckWorkflow = defineWorkflow({
  id: "i9-check", version: 1, code: "ic", label: "I-9 Check", icon: "ClipboardCheck", category: "separation",
  summary: "Checks one OCR-derived person in UCPath and produces an I-9 retention row for the workbook library.",
  input: I9CheckInput, canonicalInput: I9CheckCanonicalInput, inputSubject: "name",
  identity: { matchKey: input => `${input.ocrRunId}:${input.recordId}` },
  presentation: { title: input => input.person.name, subtitle: () => "I-9 retention check" },
  surface: { shape: "operation-member" }, surfaces: {}, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  role: defineWorkflowRole({ kind: "composition" }), scenarios: ["i9-check/person"],
  details: [
    { key: "outcome", label: "UCPath", source: { kind: "result", fieldPath: "row.foundInUcpath" }, display: "text" },
    { key: "action", label: "Retention action", source: { kind: "result", fieldPath: "row.action" }, display: "text" },
    { key: "pps", label: "PPS ID", source: { kind: "result", fieldPath: "row.ppsEid" }, display: "text" },
    { key: "separation", label: "Separation date", source: { kind: "result", fieldPath: "row.separationDate" }, display: "text" },
  ],
  nodePurposes: I9_CHECK_NODE_PURPOSES,
  steps: i9CheckSteps,
});
