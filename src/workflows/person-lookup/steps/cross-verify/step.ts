import { z } from "zod";
import { CrmReadOnboardingResults } from "../../../../models/systems/crm/read-onboarding-results.js";
import { CrmSearchOnboardingRecords } from "../../../../models/systems/crm/search-onboarding-records.js";
import { CrmVerifyOnboardingRecord } from "../../../../models/systems/crm/verify-onboarding-record.js";
import { SearchPersonMatch } from "../../../../models/systems/ucpath/search-person-match.js";
import { SearchPersonOrg, type SearchPersonOrgOutput, type UcpathCandidate } from "../../../../models/systems/ucpath/search-person-org.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { PERSON_LOOKUP_EXAMPLE_EID, PersonLookupInput, personLookupTitle } from "../../../../models/workflows/person-lookup/input.js";
import { ReadResolvedIdentity, ResolvedIdentitySchema } from "../../../../models/workflows/person-lookup/read-resolved-identity.js";
import { personLookupKnownEid, typedCrmIdentity } from "../../../../rules/matching/person-lookup.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../../../workflow-kit/workflow.js";
import { buildSearching, lookupMethodDisplay, SEARCHING_NODE } from "../searching/step.js";

/** The CRM search for this person; a person typed by hand under Search for person is searched by the typed name. */
export function crmQuery(input: z.output<typeof PersonLookupInput>, person?: z.output<typeof SearchPersonOrg.output>, match?: z.output<typeof SearchPersonMatch.output>, typedPerson = false) {
  const name = input.mode === "match" ? personLookupTitle(input) : "name" in input && !typedPerson ? input.name : person?.selection.selected?.name;
  return { ...(name === undefined ? {} : { name }), ...("emplId" in input ? { eid: input.emplId } : input.mode === "match" ? { eid: match?.confirmed[0]?.emplId } : {}) };
}

/** Match mode reads no UCPath person; one the UCPath identity already holds (typed by hand) is the person the CRM check resolves over. */
function matchModePerson(selected: UcpathCandidate | null | undefined): SearchPersonOrgOutput | undefined {
  return selected == null ? undefined : { results: [selected], selection: { status: "resolved", selected, candidateEids: [selected.emplId] } };
}

export const CROSS_VERIFY_NODE = "cross-verify";
export const CRM_IDENTITY_NODE = "crm-identity";

const CrossVerifyFactsSchema = z.strictObject({ name: z.string().min(1), firstDayOfService: z.string().min(1) });

/** Typed CRM name and start date for the Employee ID the UCPath search resolved; CRM is not searched. */
export const CROSS_VERIFY_MANUAL: StepManualDeclaration = {
  form: {
    fields: [
      { key: "name", label: "CRM name", kind: "text", replaces: { nodeId: CRM_IDENTITY_NODE, path: "crmIdentity.name" } },
      { key: "firstDayOfService", label: "Start date", kind: "us-date", replaces: { nodeId: CRM_IDENTITY_NODE, path: "crmIdentity.firstDayOfService" } },
    ],
  },
  produces: {
    [CRM_IDENTITY_NODE]: ({ facts, scope }) => {
      const input = PersonLookupInput.parse(scope.input);
      const identity = ResolvedIdentitySchema.parse(scope.outputs["search-identity"]);
      return typedCrmIdentity(input, identity, requireFact(personLookupKnownEid(input, identity), "search-identity", "candidateEids"), CrossVerifyFactsSchema.parse(facts));
    },
  },
  skips: [CROSS_VERIFY_NODE],
};

export const CROSS_VERIFY_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "cross-verify", label: "Cross-check identity" }),
  description: "Compare the person’s name, department and employee ID with CRM records.",
  system: "crm",
  selection: { inputField: "crmCheck", selectedWhen: true },
  manual: CROSS_VERIFY_MANUAL,
  operatorFields: [
    ...[["name", "Name", "Quillan, Petra A."], ["department", "Department", "CAMPUS DINING OPERATIONS"], ["emplId", "Employee ID", PERSON_LOOKUP_EXAMPLE_EID], ["firstDayOfService", "Start date", "3/14/2031"]].map(([path, label, example]) => ({
      label, example, sources: [
        ...["cross-verify", "crm-selected-record", "crm-results"].map(nodeId => ({ nodeId, kind: "output" as const, fieldPath: `records.${path}` })),
        ...["crmIdentity", "crmRecord", "unselectedCrmRecords"].map(prefix => ({ nodeId: "crm-identity", kind: "output" as const, fieldPath: `${prefix}.${path}` })),
      ]
    })),
    { label: "CRM", visibility: "logs", example: "Found", sources: [{ nodeId: "crm-identity", kind: "output", fieldPath: "crmState" }] },
    { label: "How found", visibility: "logs", display: lookupMethodDisplay, sources: [{ nodeId: "crm-identity", kind: "output", fieldPath: "method" }] },
  ],
  review: {
    // Match mode checks CRM only for the one person it confirmed (shouldCheckCrm in rules/matching/person-lookup.ts).
    when: [{ mode: ["search"] }, { mode: ["match"], "search-result": ["resolved"] }],
    pages: [
      {
        id: "crm-search",
        title: "CRM onboarding search",
        mode: "Fill form",
        nodeIds: ["cross-verify", "crm-identity"],
        lines: [
          { id: "match-records", kind: "check", text: "Matches CRM records to UCPath by employee ID, else by start date", nodeIds: ["crm-identity"] },
          { id: "search", kind: "click", target: "Search", nodeIds: ["cross-verify"] }
        ],
        fields: [
          {
            id: "search-name",
            label: "Name",
            example: "Quillan, Petra A.",
            taskFields: [{ nodeId: "cross-verify", kind: "input", fieldPath: "name" }],
            source: {
              origin: "UCPath",
              detail: "The name UCPath returned, or the name entered when the run starts.",
              chain: [],
              read: { stepKey: "searching", page: "Person Organizational Summary detail", field: "Name" }
            }
          }
        ]
      },
      {
        id: "crm-record",
        title: "CRM onboarding record",
        mode: "Read only",
        nodeIds: ["cross-verify", "crm-identity", "crm-selected-record", "crm-results"],
        when: [{ "crm-result": ["Found"] }],
        lines: [],
        fields: [
          {
            id: "name",
            operatorField: "Name",
            source: {
              origin: "CRM",
              detail: "Name on the selected onboarding record.",
              chain: [],
              read: { stepKey: "cross-verify", page: "CRM onboarding record", field: "Name" }
            }
          },
          {
            id: "department",
            operatorField: "Department",
            source: {
              origin: "CRM",
              detail: "Department on the selected onboarding record.",
              chain: [],
              read: { stepKey: "cross-verify", page: "CRM onboarding record", field: "Department" }
            }
          },
          {
            id: "employee-id",
            operatorField: "Employee ID",
            source: {
              origin: "CRM",
              detail: "Employee ID on the selected onboarding record.",
              chain: [],
              read: { stepKey: "cross-verify", page: "CRM onboarding record", field: "Employee ID" }
            }
          },
          {
            id: "start-date",
            operatorField: "Start date",
            source: {
              origin: "CRM",
              detail: "First day of service on the selected onboarding record.",
              chain: [],
              read: { stepKey: "cross-verify", page: "CRM onboarding record", field: "Start date" }
            }
          }
        ]
      }
    ],
    branchLabels: [],
    decisions: [
      {
        id: "crm-result",
        label: "CRM cross-check result",
        reads: { nodeId: "crm-identity", fieldPath: "crmState" },
        nodeIds: ["cross-verify", "crm-identity", "crm-selected-record", "crm-results"],
        initial: "Found",
        outcomes: [
          { value: "Found", label: "Records agree" },
          { value: "Not found", label: "No CRM record", then: "Continues without a CRM record." },
          { value: "Check failed", label: "CRM check fails", then: "Continues; the result notes the failed CRM check." }
        ]
      }
    ]
  } as const,
} as const);

const crossVerifyEntries = defineStepEntries(CROSS_VERIFY_STEP);

export const crossVerifyNode = crossVerifyEntries.task(CROSS_VERIFY_NODE, CrmSearchOnboardingRecords, {
  label: "Cross-check identity",
  replay: "checkpoint",
  when: { kind: "is-true", of: { from: "node", nodeId: "search-identity", path: "shouldCheckCrm" } }
});

export const crmIdentityNode = crossVerifyEntries.task(CRM_IDENTITY_NODE, ReadResolvedIdentity, {
  label: "Resolve cross-checked identity",
  replay: "always-rerun",
  when: { kind: "is-true", of: { from: "node", nodeId: "search-identity", path: "shouldCheckCrm" } }
});

export const SELECTED_RECORD_NODE = "crm-selected-record";

export const selectedRecordNode = crossVerifyEntries.task(SELECTED_RECORD_NODE, CrmVerifyOnboardingRecord, {
  replay: "checkpoint",
  when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "crmRecord" } }
});

export const CRM_RESULTS_NODE = "crm-results";

export const crmResultsNode = crossVerifyEntries.task(CRM_RESULTS_NODE, CrmReadOnboardingResults, {
  replay: "checkpoint",
  when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "unselectedCrmRecords" } }
});

export function buildCrossVerify(author: WorkflowAuthor<typeof PersonLookupInput>, search: ReturnType<typeof buildSearching>) {
  const { task, result } = author;
  const { searching, matching, initial } = search;
  const crossVerify = task(crossVerifyNode, [initial, searching, matching], ({ input, outputs, asserted }) => crmQuery(input, outputs.searching, outputs.matching, asserted?.includes(SEARCHING_NODE)));
  const identity = task(crmIdentityNode, [initial, crossVerify, searching, matching], ({ input, outputs }) => ({ input, person: outputs.searching ?? matchModePerson(outputs["search-identity"]?.selected), match: outputs.matching, crm: outputs["cross-verify"] }));
  const selectedRecord = task(selectedRecordNode, [identity], ({ outputs }) => {
    const record = requireFact(outputs["crm-identity"]?.crmRecord, "crm-identity", "crmRecord"); return record;
  });
  const crmResults = task(crmResultsNode, [initial, identity, searching, matching], ({ input, outputs, asserted }) => ({
    query: crmQuery(input, outputs.searching, outputs.matching, asserted?.includes(SEARCHING_NODE)), records: requireFact(outputs["crm-identity"]?.unselectedCrmRecords, "crm-identity", "unselectedCrmRecords"),
  }));
  return {
    crossVerify, identity, selectedRecord, crmResults, steps: [[CROSS_VERIFY_STEP, [crossVerify, identity, selectedRecord, crmResults]]] as const,
    result: result(z.strictObject({ identity: ReadResolvedIdentity.output, verifiedCrm: CrmVerifyOnboardingRecord.output.optional(), crmResults: CrmReadOnboardingResults.output.optional() }), [initial, identity, selectedRecord, crmResults], ({ outputs }) => ({ identity: outputs["crm-identity"] ?? outputs["search-identity"], ...(outputs["crm-selected-record"] === undefined ? {} : { verifiedCrm: outputs["crm-selected-record"] }), ...(outputs["crm-results"] === undefined ? {} : { crmResults: outputs["crm-results"] }) }))
  };
}

export const personLookupCrossVerifyDefinition = defineStep({
  group: CROSS_VERIFY_STEP,
  build: buildCrossVerify,
  proof: {
    id: "person-lookup-cross-verify", order: 6,
    build: (parent: WorkflowDefinition<typeof PersonLookupInput>) => ({
      ...inheritStepProof(parent), code: "plc", label: CROSS_VERIFY_STEP.label,
      summary: "Proves the Person Lookup cross-verify step with its prerequisite reads.",
      steps: (author: WorkflowAuthor<typeof PersonLookupInput>) => {
        const searching = buildSearching(author);
        const built = buildCrossVerify(author, searching);
        return { steps: [...searching.steps, ...built.steps], result: built.result };
      },
    }),
  },
});
