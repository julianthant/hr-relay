



import { z } from "zod";

import { CANONICAL_FIELDS } from "../../../../src/models/fields/registry.js";
import { CrmReadOnboardingRecord } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";

import type { StepOmissionDeclaration } from "../../../../src/models/workflow/step-omission.js";
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

  const VERIFY_OMISSION: StepOmissionDeclaration = {
    form: { fields: [{ key: "verifiedByHand", label: "Verified by hand", kind: "boolean" }] },
    produces: {
      verify: ({ facts, scope }) => {
        const input = scope.input as { emplId: string };
        return {
          state: "absent" as const,
          queriedEid: input.emplId,
          reason: facts.verifiedByHand === true ? "verified by the operator outside the CRM" : "not verified",
        };
      },
    },
  };

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

  const gateInsideOmittableStep = fixture("omission-gate-inside-omitted-step", "dg", ({ task, gate, group, result }) => {
    const search = task({ id: "search", contract: SearchPersonOrg, label: "Search", replay: "checkpoint" }, [], ({ input }) => ({
      kind: "by-eid" as const, emplId: input.emplId,
    }));
    const review = gate({ id: "review", label: "Review", statusKey: "awaitingReview", result: ReviewResultSchema }, [search]);
    const verify = task({ id: "verify", contract: CrmReadOnboardingRecord, label: "Verify", replay: "checkpoint" }, [search, review], ({ input }) => ({
      eid: input.emplId, name: input.expectedName,
    }));
    return {
      steps: [
        [{ key: "reads", label: "Reads" }, [search]],
        [group({ key: "deciding", label: "Deciding" }, { omission: VERIFY_OMISSION }), [review, verify]],
      ],
      result: result(FixtureResultSchema, [verify], ({ outputs }) => ({ verified: outputs.verify.state === "found" })),
    };
  });

  return { FixtureInput, FixtureCanonicalInput, ReviewResultSchema, FixtureResultSchema, VERIFY_OMISSION, fixture, gateInsideOmittableStep };
}
