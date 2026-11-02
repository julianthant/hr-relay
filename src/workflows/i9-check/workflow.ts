import { defineWorkflow, defineStepEntries } from "../../workflow-kit/workflow-definition.js";
import type { WorkflowDefinitionSpec } from "../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../workflow-kit/workflow.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { I9CheckInput, I9CheckCanonicalInput } from "../../models/workflows/i9-check/input.js";
import { ReadSearchPlan, ReadMatchOutcome, ReadRetentionRow } from "../../models/workflows/i9-check/check.js";
import { SearchPersonMatch } from "../../models/systems/ucpath/search-person-match.js";
import { SearchPersonOrg } from "../../models/systems/ucpath/search-person-org.js";

const personMatch = defineWorkflowStep({ key: "person-match", label: "Match person" });
const personLookup = defineWorkflowStep({ key: "person-lookup", label: "Check hire date" });
const rosterMatch = defineWorkflowStep({ key: "roster-match", label: "Match retention roster" });
const match = defineStepEntries(personMatch), lookup = defineStepEntries(personLookup), roster = defineStepEntries(rosterMatch);

export const i9CheckSteps: WorkflowDefinitionSpec<typeof I9CheckInput, typeof ReadRetentionRow.output>["steps"] = ({ task, result }) => {
    const plan = task(match.task("search-plan", ReadSearchPlan, { replay: "always-rerun" }), [], ({ input }) => input);
    const matching = task(match.task("identifier-match", SearchPersonMatch, { replay: "checkpoint",
      when: { kind: "is-true", of: { from: "node", nodeId: "search-plan", path: "useMatch" } },
    }), [plan], ({ input }) => ({
      firstName: requireFact(input.person.firstName, "search-plan", "firstName"),
      lastName: requireFact(input.person.lastName, "search-plan", "lastName"),
      ...(input.person.dob === undefined ? {} : { dob: `${input.person.dob.slice(5, 7)}/${input.person.dob.slice(8, 10)}/${input.person.dob.slice(0, 4)}` }),
      ...(input.person.ssn === undefined ? {} : { ssn: input.person.ssn }),
    }));
    const initial = task(match.task("match-outcome", ReadMatchOutcome, { replay: "always-rerun" }), [matching], ({ outputs }) => ({ match: outputs["identifier-match"] }));
    const search = task(lookup.task("name-search", SearchPersonOrg, { replay: "checkpoint",
      when: { kind: "is-true", of: { from: "node", nodeId: "match-outcome", path: "shouldLookup" } },
    }), [initial], ({ input }) => ({ kind: "by-name" as const, name: input.person.name, keepNonHdh: true }));
    const row = task(roster.task("retention-row", ReadRetentionRow, { replay: "always-rerun" }), [initial, search], ({ input, outputs }) => ({
      input, initial: outputs["match-outcome"].identity, search: outputs["name-search"],
    }));
    return { steps: [[personMatch, [plan, matching, initial]], [personLookup, [search]], [rosterMatch, [row]]],
      result: result(ReadRetentionRow.output, [row], ({ outputs }) => outputs["retention-row"]) };
  };

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
  nodePurposes: [
    { nodeId: "search-plan", purpose: "Check whether the OCR identity supports an identifier search." },
    { nodeId: "identifier-match", purpose: "Search UCPath using usable identifiers without changing HR records." },
    { nodeId: "match-outcome", purpose: "Accept only a unique confirmed identifier match." },
    { nodeId: "name-search", purpose: "Read all departments for hire-date corroboration when identifiers did not resolve identity." },
    { nodeId: "retention-row", purpose: "Rematch the Action History evidence and derive one retention row." },
  ],
  steps: i9CheckSteps,
});
