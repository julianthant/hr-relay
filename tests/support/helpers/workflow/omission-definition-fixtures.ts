



import { z } from "zod";

import { CANONICAL_FIELDS } from "../../../../src/models/fields/registry.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";

import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import type { WorkflowAuthor } from "../../../../src/workflow-kit/workflow-definition.js";






export function createOmissionDefinitionFixtures() {
  const FixtureInput = z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema });
  const FixtureCanonicalInput = defineCanonicalInput(
    FixtureInput,
    z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema }),
    [{ emplId: "10800000", expectedName: "Fixture, Person" }],
  );
  const ReviewResultSchema = z.strictObject({ approved: z.boolean() });
  const FixtureResultSchema = z.strictObject({ verified: z.boolean() });

  type Author = WorkflowAuthor<typeof FixtureInput>;

  function fixture(id: string, code: string, steps: (author: Author) => ReturnType<Parameters<typeof defineWorkflow<typeof FixtureInput, typeof FixtureResultSchema>>[0]["steps"]>) {
    return defineWorkflow({
      id,
      version: 1,
      code,
      label: "D313 fixture",
      icon: "Search",
      category: "operations",
      input: FixtureInput,
      canonicalInput: FixtureCanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      details: [],
      identity: { matchKey: (input) => `eid:${input.emplId}` },
      presentation: { title: (input) => `EID ${input.emplId}` },
      scenarios: [`${id}/happy`],
      role: defineWorkflowRole({ kind: "standalone" }),
      steps,
    });
  }

  return { FixtureInput, FixtureCanonicalInput, ReviewResultSchema, FixtureResultSchema, fixture };
}
