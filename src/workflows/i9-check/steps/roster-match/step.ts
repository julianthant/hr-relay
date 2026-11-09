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
          {
            id: "retention",
            kind: "check",
            text: "Compare UCPath employment details with the saved roster row and calculate retention.",
            nodeIds: ["retention-row"]
          }
        ],
        fields: []
      }
    ],
    branchLabels: []
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
  return { steps: [[rosterMatch, [row]]] as const, result: result(ReadRetentionRow.output, [row], ({ outputs }) => outputs["retention-row"]) };
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
