import { createKualiTaskTestWorld } from "../../../../support/helpers/backend/kuali-task-world.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { readSeparationDocumentTask } from "../../../../../src/backend/systems/kuali/tasks/read-separation-document.js";

const { MATCH_EXAMPLE, DOCUMENT, READ_INPUT, recordingDriver, invocation, point } = createKualiTaskTestWorld();

if (MATCH_EXAMPLE.state !== "present") throw new Error("Kuali match example must carry a present proof");

describe("Kuali task wrappers at their semantic-driver boundary", () => {

  describe("readSeparationDocumentTask", () => {
    it("returns the RRSS document facts from one read-only operation", async () => {
      const { driver, calls } = recordingDriver({
        readSeparationDocument: async () => ({ state: "read", document: DOCUMENT }),
      });
      const call = invocation(readSeparationDocumentTask, READ_INPUT, driver);

      const result = await call.run() as typeof DOCUMENT;

      assert.equal(result.documentNumber, "4510");
      assert.equal(result.actionId, DOCUMENT.actionId);
      assert.deepEqual(result.employee.eid, DOCUMENT.employee.eid);
      assert.deepEqual(result.options, DOCUMENT.options);
      assert.deepEqual(calls, [{
        operation: "readSeparationDocument",
        args: [READ_INPUT],
      }]);
      assert.deepEqual(call.points, [
        point("read", "pageStateId", DOCUMENT.pageStateId),
        point("read", "actionId", DOCUMENT.actionId),
        point("read", "documentNumber", DOCUMENT.documentNumber),
        point("read", "formType", DOCUMENT.formType),
        point("read", "employee", DOCUMENT.employee),
        point("read", "separation", DOCUMENT.separation),
        point("read", "timekeeper", DOCUMENT.timekeeper),
        point("read", "finalTransactions", DOCUMENT.finalTransactions),
        point("read", "options", DOCUMENT.options),
        point("read", "observedAt", DOCUMENT.observedAt),
      ]);
    });
  });
});
