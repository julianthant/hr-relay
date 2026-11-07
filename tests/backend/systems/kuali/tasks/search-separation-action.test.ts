import { createKualiTaskTestWorld } from "../../../../support/helpers/backend/kuali-task-world.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { searchSeparationActionTask } from "../../../../../src/backend/systems/kuali/tasks/search-separation-action.js";

const { NOW, TARGET, MATCH_EXAMPLE, recordingDriver, invocation, point } = createKualiTaskTestWorld();

if (MATCH_EXAMPLE.state !== "present") throw new Error("Kuali match example must carry a present proof");

describe("Kuali task wrappers at their semantic-driver boundary", () => {
  describe("searchSeparationActionTask", () => {
    it("returns the uniquely resolved document and records the observed Action List facts", async () => {
      const actionHref = "/build/space/5e47518b90adda9474c14adb/actions/0123456789abcdef01234567";
      const observation = {
        pageStateId: "kuali.action-list.ready",
        space: "5e47518b90adda9474c14adb",
        requestedDocumentNumber: TARGET.documentNumber,
        matchedLinks: [
          { name: TARGET.documentNumber, href: actionHref },
          { name: TARGET.documentNumber, href: actionHref },
        ],
        listedDocumentNumbers: [TARGET.documentNumber],
        observedAt: NOW,
      };
      const { driver, calls } = recordingDriver({
        readActionListForDocument: async () => observation,
      });
      const call = invocation(searchSeparationActionTask, { documentNumber: TARGET.documentNumber }, driver);

      const result = await call.run();

      assert.deepEqual(result, {
        pageStateId: "kuali.action-list.ready",
        documentNumber: TARGET.documentNumber,
        actionId: TARGET.actionId,
        actionHref,
        matchedLinkCount: 2,
        observedAt: NOW,
      });
      assert.deepEqual(calls, [{
        operation: "readActionListForDocument",
        args: [{ documentNumber: TARGET.documentNumber }],
      }]);
      assert.deepEqual(call.points, [
        point("read", "documentNumber", TARGET.documentNumber),
        point("read", "actionId", TARGET.actionId),
        point("read", "actionHref", actionHref),
        point("read", "matchedLinkCount", 2),
        point("read", "pageStateId", "kuali.action-list.ready"),
        point("read", "observedAt", NOW),
      ]);
    });
  });
});
