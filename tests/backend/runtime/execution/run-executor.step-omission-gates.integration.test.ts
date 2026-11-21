import { createOmissionDefinitionFixtures } from "../../../support/helpers/workflow/omission-definition-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";

import { CrmReadOnboardingRecord } from "../../../../src/models/systems/crm/read-onboarding-record.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";

import { type StepManualDeclaration } from "../../../../src/models/workflow/step-omission.js";



const { ReviewResultSchema, FixtureResultSchema, fixture } = createOmissionDefinitionFixtures();

describe("definition-time omission completeness", () => {
  it("refuses an omittable step whose unproduced task is read from outside, and a producer naming a non-member or a gate", () => {
    const unproduced: StepManualDeclaration = { form: { fields: [] }, produces: {}, skips: ["verify"] };
    assert.throws(() => fixture("omission-task-read-outside", "dtr", ({ task, group, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint" }, [], ({ input }) => ({
        kind: "by-eid" as const, emplId: input.emplId,
      }));
      const verify = task({ id: "verify", contract: CrmReadOnboardingRecord, replay: "checkpoint" }, [search], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      const after = task({ id: "after", contract: CrmReadOnboardingRecord, replay: "checkpoint" }, [verify], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      return {
        steps: [
          [{ key: "reads", label: "Reads" }, [search]],
          [group({ key: "deciding", label: "Deciding" }, { manual: unproduced }), [verify]],
          [{ key: "after", label: "After" }, [after]],
        ],
        result: result(FixtureResultSchema, [after], ({ outputs }) => ({ verified: outputs.after.state === "found" })),
      };
    }), /reads its task entry "verify", which omitting the step leaves unread; rebuild "verify" from the step's omission form/u);

    const foreignProducer: StepManualDeclaration = { form: { fields: [] }, produces: { search: () => ({}) }, skips: ["verify"] };
    assert.throws(() => fixture("omission-foreign-producer", "dfp", ({ task, group, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint" }, [], ({ input }) => ({
        kind: "by-eid" as const, emplId: input.emplId,
      }));
      const verify = task({ id: "verify", contract: CrmReadOnboardingRecord, replay: "checkpoint" }, [search], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      return {
        steps: [
          [{ key: "reads", label: "Reads" }, [search]],
          [group({ key: "deciding", label: "Deciding" }, { manual: foreignProducer }), [verify]],
        ],
        result: result(FixtureResultSchema, [verify], ({ outputs }) => ({ verified: outputs.verify.state === "found" })),
      };
    }), /step "deciding" omission produces "search", which is not an entry of that step/u);

    const gateProducer: StepManualDeclaration = { form: { fields: [] }, produces: { review: () => ({ approved: true }) }, skips: [] };
    assert.throws(() => fixture("omission-gate-producer", "dgp", ({ task, gate, group, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint" }, [], ({ input }) => ({
        kind: "by-eid" as const, emplId: input.emplId,
      }));
      const review = gate({ id: "review", label: "Review", result: ReviewResultSchema }, [search]);
      return {
        steps: [
          [{ key: "reads", label: "Reads" }, [search]],
          [group({ key: "deciding", label: "Deciding" }, { manual: gateProducer }), [review]],
        ],
        result: result(FixtureResultSchema, [search], ({ outputs }) => ({ verified: outputs.search.selection.selected !== null })),
      };
    }), /omission produces "review", which is a gate entry; only task entries are ever rebuilt from operator facts/u);
  });
});
