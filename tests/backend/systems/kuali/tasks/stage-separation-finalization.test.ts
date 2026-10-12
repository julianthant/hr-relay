import { createKualiTaskTestWorld } from "../../../../support/helpers/backend/kuali-task-world.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { stageSeparationFinalizationTask } from "../../../../../src/backend/systems/kuali/tasks/stage-separation-finalization.js";

const { TARGET, MATCH_EXAMPLE, STAGING, recordingDriver, invocation, point } = createKualiTaskTestWorld();

if (MATCH_EXAMPLE.state !== "present") throw new Error("Kuali match example must carry a present proof");

describe("Kuali task wrappers at their semantic-driver boundary", () => {

  describe("stageSeparationFinalizationTask", () => {
    it("returns the staged identity and fields without committing", async () => {
      const { driver, calls } = recordingDriver({
        stageSeparationFinalization: async () => STAGING,
      });
      const call = invocation(stageSeparationFinalizationTask, TARGET, driver);

      const result = await call.run();

      assert.deepEqual(result, STAGING);
      assert.deepEqual(calls, [{ operation: "stageSeparationFinalization", args: [TARGET] }]);
      assert.deepEqual(call.points, [
        point("read", "stagedPageState", STAGING.stagedPageState),
        point("read", "actionId", STAGING.actionId),
        point("read", "documentNumber", STAGING.documentNumber),
        point("read", "observedEid", STAGING.observedEid),
        point("read", "previousFields", STAGING.previousFields),
        point("write", "stagedFields", STAGING.stagedFields),
        point("read", "observedDepartmentOptions", STAGING.observedDepartmentOptions),
        point("read", "observedAt", STAGING.observedAt),
      ]);
    });
  });
});
