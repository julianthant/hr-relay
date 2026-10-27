import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createIntakeAuthority } from "./fixture-intake-authority.js";
import { CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { DashboardDayWireSchema } from "../../../../src/models/dashboard/projection.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { CONFIG_SNAPSHOT, NOW } from "../phase1c-contract-fixtures.js";

const authorities: Awaited<ReturnType<typeof createIntakeAuthority>>[] = [];
afterEach(async () => { for (const authority of authorities.splice(0)) await authority.close(); });

it("serves actual Intake fan-out relationships over the production HTTP day query without read effects, including restart", async () => {
  const authority = await createIntakeAuthority(); authorities.push(authority);
  let session = (await authority.upload()).session;
  for (const [targetFieldId, column] of [["emplId", 0], ["effectiveDate", 1]] as const) {
    const result = CommandResultSchema.parse(await (await authority.post(authority.request(session, "confirm-intake-mapping", {
      targetFieldId, sourceColumnId: session.columns[column].sourceColumnId, headerFingerprint: session.headerFingerprint,
    }))).json());
    assert.equal(result.state, "applied");
    session = await authority.intake.read(session.intakeSessionId);
  }
  for (const [type, payload] of [["exclude-intake-row", { sourceRow: 2, reason: "Synthetic invalid row" }], ["validate-intake", undefined]] as const) {
    const result = CommandResultSchema.parse(await (await authority.post(authority.request(session, type, payload))).json());
    assert.equal(result.state, "applied"); session = await authority.intake.read(session.intakeSessionId);
  }
  const result = CommandResultSchema.parse(await (await authority.post(authority.request(session, "enqueue-intake-manifest", {
    dryRun: false, reviewBinding: session.reviewBinding,
  }))).json());
  assert.equal(result.state, "applied");
  if (result.state !== "applied") throw new Error("fixture enqueue did not apply");
  session = await authority.intake.read(session.intakeSessionId);
  assert.ok(session.manifest);
  const manifest = session.manifest;
  assert.equal(manifest.createdAt, NOW);
  const day = NOW.slice(0, 10);
  const runIds = result.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []);
  const minted = authority.mintedIds;
  const generation = authority.database.getMeta().authorityGeneration;
  for (const restart of [false, true]) {
    if (restart) authority.restart();
    const response = await authority.app.request(`http://127.0.0.1/api/v1/dashboard?day=${day}`);
    assert.equal(response.status, 200);
    const wire = DashboardDayWireSchema.parse(await response.json());
    assert.equal(wire.day, day);
    assert.deepEqual(wire.queueSurfaces.map(row => row.runId).sort(), [...runIds].sort());
    assert.deepEqual(wire.queueSurfaces.map(row => row.itemId).sort(), manifest.validRows.map(row => row.itemId).sort());
    for (const row of wire.queueSurfaces) {
      assert.equal(row.workflowId, session.workflow);
      assert.equal(row.actorId, LOCAL_OPERATOR_ACTOR_ID);
      assert.equal(row.descriptorHash, manifest.workflowContractFingerprint);
      assert.equal(row.configFingerprint, CONFIG_SNAPSHOT.fingerprint);
      assert.equal(row.dryRun, false);
      assert.equal(row.session.state, "present");
      if (row.session.state !== "present") throw new Error("fixture fan-out session relationship missing");
      assert.deepEqual(row.session.origin, { kind: "intake-manifest", intakeManifestId: manifest.manifestId, actorId: LOCAL_OPERATOR_ACTOR_ID });
    }
    assert.equal(new Set(wire.queueSurfaces.flatMap(row => row.session.state === "present" ? [row.session.sessionId] : [])).size, 1);
    assert.equal(authority.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(authority.mintedIds, minted);
  }
});
