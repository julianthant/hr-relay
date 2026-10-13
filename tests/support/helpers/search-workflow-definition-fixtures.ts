import { type z } from "zod";
import type { WorkflowAuthor, WorkflowDefinitionSpec } from "../../../src/workflow-kit/workflow-definition.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { PersonLookupCanonicalInput, PersonLookupInput } from "../../../src/workflows/person-lookup/workflow.js";





type Author = WorkflowAuthor<typeof PersonLookupInput>;
type Authored = ReturnType<WorkflowDefinitionSpec<typeof PersonLookupInput, z.ZodType>["steps"]>;

export function createSearchWorkflowDefinitionFixtures() {
  const lookupInput = ({ input }: { input: z.output<typeof PersonLookupInput> }) =>
    input.mode === "match"
      ? { kind: "by-name" as const, name: `${input.lastName}, ${input.firstName}`, keepNonHdh: false }
      : !("emplId" in input)
      ? { kind: "by-name" as const, name: input.name ?? "Fixture Person", keepNonHdh: input.keepNonHdh }
      : { kind: "by-eid" as const, emplId: input.emplId };

  function fixtureWorkflow(id: string, steps: (author: Author) => Authored) {
    return defineWorkflow({
      id,
      version: 1,
      code: "fx",
      label: "Fixture",
      icon: "Search",
      category: "search",
      input: PersonLookupInput,
      canonicalInput: PersonLookupCanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      details: [],
      identity: { matchKey: () => "fixture" },
      presentation: { title: () => "Fixture" },
      scenarios: ["person-lookup/happy-by-eid"],
      role: defineWorkflowRole({ kind: "standalone" }),
      steps,
    });
  }
  return { lookupInput, fixtureWorkflow };
}
