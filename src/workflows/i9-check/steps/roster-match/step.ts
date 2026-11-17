import { ReadRetentionRow } from "../../../../models/workflows/i9-check/read-retention-row.js";
import { I9CheckInput } from "../../../../models/workflows/i9-check/input.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { i9CheckPersonLookupDefinition, personLookupEntries } from "../person-lookup/step.js";
import { i9CheckPersonMatchDefinition, personMatchEntries } from "../person-match/step.js";
export const rosterMatch = Object.freeze({
  ...defineWorkflowStep({ key: "roster-match", label: "Match retention roster" }),
  review: {
    pages: [
      {
        id: "retention-roster",
        title: "Retention roster",
        mode: "Read only",
        nodeIds: ["retention-row"],
        lines: [
          { id: "derive", kind: "read", text: "Resolve the UCPath identity, match its captured roster evidence and derive one retention row.", nodeIds: ["retention-row"] },
          {
            id: "retention",
            kind: "check",
            text: "Compare UCPath employment details with the saved roster row and calculate retention.",
            nodeIds: ["retention-row"]
          },
          { id: "retention-rule", kind: "check", text: "Keep a found person's I-9 through five years after separation; shred it after that date. An unresolved identity or missing separation date needs manual review.", nodeIds: ["retention-row"] },
        ],
        fields: [
          { id: "name", label: "Employee name", inputField: "person.name", example: "Morrow, Bea",
            source: { origin: "Approved PDF record", detail: "The approved name retained on the results row.", chain: [] } },
          { id: "employee-id", label: "Employee ID", taskFields: [{ nodeId: "retention-row", kind: "output", fieldPath: "row.ucpathEmplId" }], example: "10000001", when: [{ "retention-identity": ["found"] }],
            source: { origin: "UCPath", detail: "The Employee ID confirmed by identifier matching or the hire-date comparison.", chain: [] } },
          { id: "pps-id", label: "PPS ID", taskFields: [{ nodeId: "retention-row", kind: "output", fieldPath: "row.ppsEid" }], example: "700001",
            source: { origin: "Captured retention roster", detail: "The matching roster row or the approved roster seed when no row matches.", chain: [] } },
          { id: "separation-date", label: "Separation date", taskFields: [{ nodeId: "retention-row", kind: "output", fieldPath: "row.separationDate" }], example: "2022-10-15",
            source: { origin: "Captured retention roster", detail: "The latest matching termination row, otherwise the available roster evidence.", chain: [] } },
          { id: "ucpath-result", label: "UCPath result", taskFields: [{ nodeId: "retention-row", kind: "output", fieldPath: "identity.status" }], example: "Found",
            display: { cases: [{ value: "found", text: "Found" }, { value: "not-found", text: "Not found" }, { value: "ambiguous", text: "Needs manual review" }] },
            source: { origin: "UCPath identity check", detail: "Whether matching identifiers or the hire date resolve exactly one person.", chain: [] } },
          { id: "action", label: "Retention action", taskFields: [{ nodeId: "retention-row", kind: "output", fieldPath: "row.action" }], example: "Keep",
            display: { cases: [{ value: "Keep", text: "Keep" }, { value: "Shred", text: "Shred" }, { value: "", text: "Manual review" }] },
            source: { origin: "Retention rule", detail: "Uses the UCPath identity, separation date and the run's as-of date; no document is actually shredded.", chain: [] } },
        ]
      }
    ],
    branchLabels: [],
    decisions: [
      { id: "retention-identity", label: "UCPath identity", reads: { nodeId: "retention-row", fieldPath: "identity.status" }, nodeIds: ["retention-row"], initial: "found", outcomes: [
        { value: "found", label: "One person found", then: "Uses the confirmed Employee ID and the available roster evidence." },
        { value: "not-found", label: "Nobody found", then: "Records Not found in UCPath and recommends Shred; continues without changing a record." },
        { value: "ambiguous", label: "Identity needs review", then: "Leaves the retention action undecided and records a note for manual review; continues." },
      ] },
      { id: "retention-action", label: "Retention action", reads: { nodeId: "retention-row", fieldPath: "row.action" }, nodeIds: ["retention-row"],
        initial: { by: "retention-identity", values: { "not-found": "Shred", ambiguous: "" }, otherwise: "Keep" }, outcomes: [
        { value: "Keep", label: "Keep", then: "Records Keep and the future shred date; continues without changing any HR record.", when: [{ "retention-identity": ["found"] }] },
        { value: "Shred", label: "Shred", then: "Records a Shred recommendation; continues without deleting a document.", when: [{ "retention-identity": ["found", "not-found"] }] },
        { value: "", label: "Manual review", then: "Leaves the action blank and records why the identity or separation date needs manual review; continues.", when: [{ "retention-identity": ["found", "ambiguous"] }] },
      ] },
    ],
  } as const
});
type I9Author = WorkflowAuthor<typeof I9CheckInput>;
const roster = defineStepEntries(rosterMatch);

export function buildStep(author: I9Author, matched: ReturnType<typeof personMatchEntries>, looked: ReturnType<typeof personLookupEntries>) {
  const { task, result } = author;
  const search = looked;
  const row = task(roster.task("retention-row", ReadRetentionRow, { replay: "always-rerun" }), [matched.initial, matched.initialSearch, search], ({ input, outputs }) => ({
    input, initial: outputs["match-outcome"].identity, search: input.person.useMatch ? outputs["name-search"] : outputs["initial-name-search"],
  }));
  return { row, steps: [[rosterMatch, [row]]] as const, result: result(ReadRetentionRow.output, [row], ({ outputs }) => outputs["retention-row"]) };
}
export const i9CheckRosterMatchDefinition = defineStep({
  group: rosterMatch, build: buildStep,
  proof: {
    id: "i9-check-roster-match", order: 12,
    build: (parent: WorkflowDefinition<typeof I9CheckInput>) => ({
      ...inheritStepProof(parent),
      code: "icr", label: "I-9 retention roster proof", summary: "Proves the I-9 roster/retention result with its prerequisite UCPath reads.",
      details: parent.details,
      steps: (author: I9Author) => {
        const matched = i9CheckPersonMatchDefinition.build(author), looked = i9CheckPersonLookupDefinition.build(author, matched);
        const roster = buildStep(author, matched, looked.search);
        return { steps: [...matched.steps, ...looked.steps, ...roster.steps], result: roster.result };
      },
    }),
  },
});
