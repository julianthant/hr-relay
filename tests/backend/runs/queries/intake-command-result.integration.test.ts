import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createIntakeCommandResultQuery } from "../../../../src/backend/runs/queries/intake-command-result.js";
import { IntakeCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { foundationFixture } from "../../../support/helpers/database-foundation/fixtures.js";

it("keeps an admitted request UNKNOWN without a recorded audit and withholds another actor's request", () => {
  const f = foundationFixture();
  try {
    const query = createIntakeCommandResultQuery(f.db);
    for (const actor of ["local-operator", "other-actor"]) {
      const request = IntakeCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: f.clock.now().toISOString(), requestedBy: actor,
        source: "dashboard", family: "intake", type: "validate-intake", target: { intakeSessionId: randomUUID(), expectedVersion: 1 } });
      f.db.authority.commands.insert(request);
      const generation = f.db.getMeta().authorityGeneration;
      assert.deepEqual(query(request.target.intakeSessionId, request.commandId), { state: "unavailable" });
      assert.equal(f.db.getMeta().authorityGeneration, generation);
      assert.equal(f.db.authority.commandAudits.findByCommand(request.commandId), undefined);
      const result = { state: "rejected", commandId: request.commandId, code: "policy-refused", message: "Fixture refusal" };
      f.db.authority.commandAudits.insert({ auditId: randomUUID(), request, result, completedAt: f.clock.now().toISOString(), versionChanges: [], affectedDependencyIds: [] });
      const settledGeneration = f.db.getMeta().authorityGeneration;
      assert.deepEqual(query(request.target.intakeSessionId, request.commandId), actor === "local-operator"
        ? { state: "recorded", request, result } : { state: "unavailable" });
      assert.equal(f.db.getMeta().authorityGeneration, settledGeneration);
    }
  } finally { f.dispose(); }
});
