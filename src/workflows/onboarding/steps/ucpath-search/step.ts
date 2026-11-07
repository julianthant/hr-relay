import { OnboardingInput } from "../../../../models/workflows/onboarding/input.js";
import { OnboardingMatchHireSubject } from "../../../../models/workflows/onboarding/match-hire-subject.js";
import { SearchPersonMatch } from "../../../../models/systems/ucpath/search-person-match.js";
import type { HireEmployee } from "../../../../models/people/hire-employee.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof, reuseTask } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { buildCrmData } from "../crm-data/step.js";

const group = defineWorkflowStep({ key: "ucpath-search", label: "Check UCPath duplicates" });
const entries = defineStepEntries(group);

export function buildUcpathSearch(author: WorkflowAuthor<typeof OnboardingInput>, crm: ReturnType<typeof buildCrmData>) {
  const call = reuseTask(group, { id: "ucpath-source", contract: SearchPersonMatch, replay: "always-rerun" },
    (employee: HireEmployee) => ({ firstName: employee.firstName, lastName: employee.lastName,
      dob: `${employee.dob.slice(5, 7)}/${employee.dob.slice(8, 10)}/${employee.dob.slice(0, 4)}`,
      ...(employee.ssn === null ? {} : { ssn: employee.ssn }) }));
  const matches = author.task(call.identity, [crm.plan], ({ outputs }) => call.bind({ input: outputs["hire-plan"].employee }));
  const subject = author.task(entries.task("hire-subject", OnboardingMatchHireSubject, { replay: "always-rerun" }), [crm.plan, matches], ({ input, outputs }) => ({
    mode: input.mode, firstName: outputs["hire-plan"].employee.firstName, lastName: outputs["hire-plan"].employee.lastName,
    match: outputs["ucpath-source"],
  }));
  return { matches, subject, steps: [[group, [matches, subject]]] as const,
    result: author.result(OnboardingMatchHireSubject.output, [subject], ({ outputs }) => OnboardingMatchHireSubject.output.parse(outputs["hire-subject"])) };
}

export const onboardingUcpathSearchDefinition = defineStep({
  group, build: buildUcpathSearch,
  nodePurposes: [
    { nodeId: "ucpath-source", purpose: "Read UCPath duplicate candidates using the validated legal name and identifiers." },
    { nodeId: "hire-subject", purpose: "Keep unresolved UCPath identities separate from a new hire." },
  ],
  proof: {
    id: "onboarding-ucpath-search", order: 16,
    build: (parent: WorkflowDefinition<typeof OnboardingInput>) => ({
      ...inheritStepProof(parent), code: "onu", label: group.label, summary: parent.summary,
      steps: (author: WorkflowAuthor<typeof OnboardingInput>) => {
        const crm = buildCrmData(author);
        const ucpath = buildUcpathSearch(author, crm);
        return { steps: [...crm.steps, ...ucpath.steps], result: ucpath.result };
      },
    }),
  },
});
