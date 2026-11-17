import { SearchPersonMatch } from "../../../../models/systems/ucpath/search-person-match.js";
import { SearchPersonOrg, UcpathCandidateSchema } from "../../../../models/systems/ucpath/search-person-org.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { PERSON_LOOKUP_EXAMPLE_EID, PersonLookupInput } from "../../../../models/workflows/person-lookup/input.js";
import { ReadResolvedIdentity } from "../../../../models/workflows/person-lookup/read-resolved-identity.js";
import { typedSearchMatch, typedSearchPerson, typedSearchIdentity } from "../../../../rules/matching/person-lookup.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";


export const lookupMethodDisplay = {
  cases: [
    { value: "ucpath", text: "UCPath search" }, { value: "eid-match", text: "Employee ID agrees with CRM" },
    { value: "date-match", text: "Start dates within one week" }, { value: "crm-only", text: "CRM only" },
    { value: "multiple-matches", text: "Multiple matches" }, { value: "no-match", text: "No match" }, { value: "match", text: "UCPath Match" },
  ]
} as const;

export const SEARCHING_NODE = "searching";
export const MATCHING_NODE = "matching";
export const SEARCH_IDENTITY_NODE = "search-identity";

const SearchFactsSchema = UcpathCandidateSchema.pick({ emplId: true, name: true, department: true, jobTitle: true, hrStatus: true, employeeStatus: true, hdh: true });
const selectedLeaf = (path: string) => ({ nodeId: SEARCH_IDENTITY_NODE, path: `selected.${path}` });

/** The typed UCPath person stands for the search in either mode: the mode's own read is built from it and the identity resolved over it. */
export const SEARCHING_MANUAL: StepManualDeclaration = {
  form: {
    fields: [
      { key: "emplId", label: "Employee ID", kind: "eid", replaces: selectedLeaf("emplId") },
      { key: "name", label: "Name", kind: "text", replaces: selectedLeaf("name") },
      { key: "department", label: "Department", kind: "text", replaces: selectedLeaf("department") },
      { key: "jobTitle", label: "Job title", kind: "text", replaces: selectedLeaf("jobTitle") },
      { key: "hrStatus", label: "HR status", kind: "text", replaces: selectedLeaf("hrStatus") },
      { key: "employeeStatus", label: "Employee status", kind: "enum", values: ["active", "inactive", "terminated", "unknown"], replaces: selectedLeaf("employeeStatus") },
      { key: "hdh", label: "HDH employee", kind: "boolean", replaces: selectedLeaf("hdh") },
    ],
  },
  produces: {
    [SEARCHING_NODE]: ({ facts, scope }) => typedSearchPerson(PersonLookupInput.parse(scope.input), SearchFactsSchema.parse(facts)),
    [MATCHING_NODE]: ({ facts }) => typedSearchMatch(SearchFactsSchema.parse(facts)),
    [SEARCH_IDENTITY_NODE]: ({ facts, scope }) => typedSearchIdentity(PersonLookupInput.parse(scope.input), SearchFactsSchema.parse(facts)),
  },
};

export const SEARCHING_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "searching", label: "Search for person" }),
  description: "Search UCPath by employee ID or name and read the matching person records.",
  system: "ucpath",
  manual: SEARCHING_MANUAL,
  operatorFields: [
    ...[["emplId", "Employee ID", PERSON_LOOKUP_EXAMPLE_EID], ["name", "Name", "Quillan, Petra A."], ["department", "Department", "CAMPUS DINING OPERATIONS"], ["jobTitle", "Job title", "Fictional analyst"], ["hrStatus", "HR status", "Active"]].map(([path, label, example]) => ({
      label, example, sources: [
        ...(["emplId", "name"].includes(path) ? [{ nodeId: "searching", kind: "input" as const, fieldPath: path }] : []),
        ...["results", "selection.selected"].map(prefix => ({ nodeId: "searching", kind: "output" as const, fieldPath: `${prefix}.${path}` })),
        { nodeId: "search-identity", kind: "output" as const, fieldPath: `selected.${path}` },
        ...(["emplId", "name"].includes(path) ? ["hits", "confirmed", "dropped"].map(prefix => ({ nodeId: "matching", kind: "output" as const, fieldPath: `${prefix}.${path}` })) : []),
      ]
    })),
    { label: "Drop reason", visibility: "logs", sources: [{ nodeId: "matching", kind: "output", fieldPath: "dropped.reason" }] },
    { label: "How found", visibility: "logs", display: lookupMethodDisplay, sources: [{ nodeId: "search-identity", kind: "output", fieldPath: "method" }] },
  ],
  review: {
    pages: [
      {
        id: "person-search",
        title: "Person Organizational Summary search",
        mode: "Fill form",
        nodeIds: ["searching"],
        lines: [{ id: "search", kind: "action", text: "In Search mode, enter the requested employee ID or name and search.", nodeIds: ["searching"] }],
        fields: []
      },
      {
        id: "person-match",
        title: "Smart HR person search",
        mode: "Fill form",
        nodeIds: ["matching"],
        lines: [{ id: "match", kind: "action", text: "In Match mode, search by name with the supplied date of birth or SSN.", nodeIds: ["matching"] }],
        fields: []
      },
      {
        id: "person-details",
        title: "Person Organizational Summary detail",
        mode: "Read only",
        nodeIds: ["searching", "matching", "search-identity"],
        lines: [
          { id: "read-person", kind: "read", text: "Read candidate names, employee IDs and employment assignments.", nodeIds: ["searching", "matching"] },
          { id: "confirm-person", kind: "check", text: "Confirm a unique identity or retain the unresolved matches.", nodeIds: ["search-identity"] }
        ],
        fields: [
          {
            id: "employee-id",
            operatorField: "Employee ID",
            source: {
              origin: "UCPath",
              detail: "Employee ID from the search result or confirmed match.",
              chain: [],
              read: { stepKey: "searching", page: "Person Organizational Summary detail", field: "Employee ID" }
            }
          },
          {
            id: "name",
            operatorField: "Name",
            source: {
              origin: "UCPath",
              detail: "Name shown on the matching person record.",
              chain: [],
              read: { stepKey: "searching", page: "Person Organizational Summary detail", field: "Name" }
            }
          },
          {
            id: "department",
            operatorField: "Department",
            source: {
              origin: "UCPath",
              detail: "Department shown for the selected person.",
              chain: [],
              read: { stepKey: "searching", page: "Person Organizational Summary detail", field: "Department" }
            }
          },
          {
            id: "job-title",
            operatorField: "Job title",
            source: {
              origin: "UCPath",
              detail: "Job title shown for the selected person.",
              chain: [],
              read: { stepKey: "searching", page: "Person Organizational Summary detail", field: "Job title" }
            }
          },
          {
            id: "hr-status",
            operatorField: "HR status",
            source: {
              origin: "UCPath",
              detail: "HR status shown for the selected person.",
              chain: [],
              read: { stepKey: "searching", page: "Person Organizational Summary detail", field: "HR status" }
            }
          }
        ]
      }
    ],
    branchLabels: []
  } as const,
} as const);

const searchingEntries = defineStepEntries(SEARCHING_STEP);

export const searchingNode = searchingEntries.task(SEARCHING_NODE, SearchPersonOrg, {
  label: "Search for person",
  replay: "checkpoint",
  when: { kind: "equals", of: { from: "input", path: "mode" }, value: "search" }
});

export const matchingNode = searchingEntries.task(MATCHING_NODE, SearchPersonMatch, {
  label: "Match person",
  replay: "checkpoint",
  when: { kind: "equals", of: { from: "input", path: "mode" }, value: "match" }
});

export const searchIdentityNode = searchingEntries.task(SEARCH_IDENTITY_NODE, ReadResolvedIdentity, {
  label: "Resolve UCPath identity",
  replay: "always-rerun"
});

export function buildSearching(author: WorkflowAuthor<typeof PersonLookupInput>) {
  const { task, result } = author;

  const searching = task(searchingNode, [], ({ input }) => {
    if (input.mode !== "search") throw new Error("Search node requires Search mode");
    return "emplId" in input ? { kind: "by-eid" as const, emplId: input.emplId } : { kind: "by-name" as const, name: input.name, keepNonHdh: input.keepNonHdh };
  });
  const matching = task(matchingNode, [searching], ({ input }) => {
    if (input.mode !== "match") throw new Error("Match node requires Match mode");
    return { lastName: input.lastName, firstName: input.firstName, ...(input.dob === undefined ? {} : { dob: input.dob }), ...(input.ssn === undefined ? {} : { ssn: input.ssn }) };
  });
  const initial = task(searchIdentityNode, [searching, matching], ({ input, outputs }) => ({ input, person: outputs.searching, match: outputs.matching }));
  return {
    searching, matching, initial, steps: [[SEARCHING_STEP, [searching, matching, initial]]] as const,
    result: result(ReadResolvedIdentity.output, [initial], ({ outputs }) => outputs["search-identity"])
  };
}

export const personLookupSearchingDefinition = defineStep({
  group: SEARCHING_STEP,
  build: buildSearching,
  proof: {
    id: "person-lookup-searching", order: 5,
    build: (parent: WorkflowDefinition<typeof PersonLookupInput>) => ({
      ...inheritStepProof(parent), code: "pls", label: SEARCHING_STEP.label,
      summary: "Proves the Person Lookup searching step with its prerequisite reads.",
      steps: (author: WorkflowAuthor<typeof PersonLookupInput>) => {
        const built = buildSearching(author);
        return { steps: [...built.steps], result: built.result };
      },
    }),
  },
});
