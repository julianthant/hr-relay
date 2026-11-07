import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach,it } from "vitest";
import { readArtifactBytes } from "../../../../src/backend/processing/spreadsheet/spreadsheet-grid.js";
import { IntakeSessionWireSchema } from "../../../../src/models/intake/wire.js";
import { CommandRequestSchema,CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { createIntakeAuthority,INTAKE_CSV } from "../../../support/fixtures/dashboard/fixture-intake-authority.js";
import { defineIntakeFixtureDescriptor,INTAKE_FIXTURE_WORKFLOW_ID } from "../../../support/fixtures/intake-workflow-fixture.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

type Harness = Awaited<ReturnType<typeof createIntakeAuthority>>;
const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) await h.close(); });
async function harness() { const h = await createIntakeAuthority(profileFixtures.create); opened.push(h); return h; }
async function send(h: Harness, wire: { intakeSessionId: string; expectedVersion: number }, type: string, payload?: unknown) {
  const response = await h.post(h.request(wire, type, payload));
  const result = CommandResultSchema.parse(await response.json());
  assert.equal(result.state, "applied", JSON.stringify(result));
  return h.intake.read(wire.intakeSessionId);
}
async function ready(h: Harness, csv = INTAKE_CSV) {
  let wire = (await h.upload(csv)).session;
  for (const [target, column] of [["emplId", 0], ["effectiveDate", 1]] as const) wire = await send(h, wire, "confirm-intake-mapping", { targetFieldId: target, sourceColumnId: wire.columns[column].sourceColumnId, headerFingerprint: wire.headerFingerprint });
  wire = await send(h, wire, "exclude-intake-row", { sourceRow: 2, reason: "Synthetic malformed identifier" });
  return send(h, wire, "validate-intake");
}
async function enqueue(h: Harness, wire: Awaited<ReturnType<typeof ready>>) {
  return send(h, wire, "enqueue-intake-manifest", { dryRun: false, reviewBinding: wire.reviewBinding });
}
function noEffects(h: Harness, wire: Awaited<ReturnType<typeof ready>>) {
  assert.equal(h.database.authority.intakeManifests.get(wire.reservedManifestId ?? ""), undefined);
  assert.equal(h.database.authority.intakeSessions.get(wire.intakeSessionId)?.state, "validated");
  assert.ok(h.database.authority.runSessions.list().every(session => session.origin.kind !== "intake-manifest" || session.origin.intakeManifestId !== wire.reservedManifestId));
}
it("real HTTP upload refuses malformed bytes and reports exact valid/unresolved/excluded rows", async () => {
  const h = await harness();
  const response = await h.app.request("http://127.0.0.1/api/v1/intake/files?workflow=intake-fixture&filename=broken.xlsx", { method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: "not a workbook" });
  assert.equal(response.status, 422);
  const wire = await ready(h); assert.ok(wire.reviewBinding);
  assert.equal(wire.validation.state, "validated");
  if (wire.validation.state !== "validated") throw new Error("validation missing");
  assert.deepEqual(wire.validation.unresolvedRows, []); assert.equal(wire.validation.validRows, 2); assert.deepEqual(wire.validation.excluded, [2]);
  assert.equal(wire.validation.validRows + wire.validation.excluded.length + wire.validation.unresolvedRows.length, wire.rowCount);
});
it("rejects missing, wrong-workflow, future and stale comparison selection without changing preparation", async () => {
  const h = await harness(); const first = await enqueue(h, await ready(h)); assert.ok(first.intakeManifestId);
  const wire = await ready(h, INTAKE_CSV.replace("Student Affairs", "Changed department"));
  const original = h.database.authority.intakeManifests.get(first.intakeManifestId); assert.ok(original);
  for (const [id, workflow, createdAt] of [["11111111-1111-4111-8111-111111111111", "different-workflow", original.createdAt], ["22222222-2222-4222-8222-222222222222", original.workflow, "2099-01-01T00:00:00.000Z"]]) {
    h.database.withAuthorityTransaction(r => r.intakeManifests.insert({ ...original, manifestId: id, workflow, createdAt }));
    const response = await h.post(h.request(wire, "inspect-intake", { comparisonManifestId: id })); assert.equal(response.status, 422);
  }
  const missing = await h.post(h.request(wire, "inspect-intake", { comparisonManifestId: "33333333-3333-4333-8333-333333333333" })); assert.equal(missing.status, 422);
  const stale = await h.post(h.request({ ...wire, expectedVersion: wire.expectedVersion - 1 }, "inspect-intake", { comparisonManifestId: first.intakeManifestId })); assert.equal(stale.status, 409);
  assert.deepEqual(await h.intake.read(wire.intakeSessionId), wire);
});
it("contract drift after review invalidates confirmation despite unchanged session revision", async () => {
  const h = await harness(); const wire = await ready(h);
  h.setDescriptor(defineIntakeFixtureDescriptor({ id: INTAKE_FIXTURE_WORKFLOW_ID, code: "if", contractFingerprint: "a".repeat(64), enqueue: "allow-parallel" }));
  const fresh = await h.intake.read(wire.intakeSessionId); assert.equal(fresh.expectedVersion, wire.expectedVersion); assert.notEqual(fresh.reviewBinding, wire.reviewBinding);
  const response = await h.post(h.request(wire, "enqueue-intake-manifest", { dryRun: false, reviewBinding: wire.reviewBinding })); assert.equal(response.status, 422); noEffects(h, wire);
  assert.equal((await enqueue(h, fresh)).state, "enqueued");
});
it("replays the exact applied command after restart and preserves source and terminal bytes across independent same-byte imports", async () => {
  const h = await harness(); const wire = await ready(h); const request = h.request(wire, "enqueue-intake-manifest", { dryRun: false, reviewBinding: wire.reviewBinding });
  const first = CommandResultSchema.parse(await (await h.post(request)).json()); assert.equal(CommandResultSchema.parse(first).state, "applied");
  const terminal = await h.intake.read(wire.intakeSessionId); const bytes = readFileSync(h.path); assert.ok(bytes.length > 0);
  h.restart(); assert.deepEqual(await (await h.post(request)).json(), { ...first, state: "already-applied" });
  const other = await ready(h); assert.notEqual(other.intakeSessionId, wire.intakeSessionId); assert.equal(other.artifact.sha256, wire.artifact.sha256);
  await enqueue(h, other); assert.deepEqual(await h.intake.read(wire.intakeSessionId), terminal);
  const divergent = await h.post({ ...request, payload: { ...request.payload as object, dryRun: true } }); assert.ok(divergent.status >= 400);
  IntakeSessionWireSchema.parse(terminal);
});

it("canonical schema drift without a revision change refuses the old review", async () => {
  const h = await harness(); const wire = await ready(h);
  h.setDescriptor(defineIntakeFixtureDescriptor({ id: INTAKE_FIXTURE_WORKFLOW_ID, code: "if", contractFingerprint: "f".repeat(64), enqueue: "allow-parallel", canonicalDepartmentMaxLength: 200 }));
  const fresh = await h.intake.read(wire.intakeSessionId); assert.equal(fresh.expectedVersion, wire.expectedVersion); assert.notEqual(fresh.reviewBinding, wire.reviewBinding);
  const response = await h.post(h.request(wire, "enqueue-intake-manifest", { dryRun: false, reviewBinding: wire.reviewBinding })); assert.equal(response.status, 422); noEffects(h, wire);
  assert.equal((await enqueue(h, fresh)).state, "enqueued");
});
it("keeps import evidence immutable and terminal after a member is explicitly deleted", async () => {
  const h = await harness(); const wire = await ready(h); const terminal = await enqueue(h, wire); assert.ok(terminal.manifest);
  const sourceBefore = await readArtifactBytes(() => h.artifacts.open(wire.artifact));
  const manifestBefore = JSON.stringify(h.database.authority.intakeManifests.get(terminal.manifest.manifestId));
  const member = h.database.authority.runs.listByItem({ workflow: terminal.workflow, itemId: terminal.manifest.validRows[0].itemId })[0]; assert.ok(member);
  assert.deepEqual(member.input.parsed.protectedBindings,[]);
  const outcome = h.database.authority.runs.transition({ runId: member.envelope.runId, expectedVersion: member.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() }, now: h.clock.now().toISOString() });
  assert.equal(outcome.state, "applied");
  const terminalMember=h.database.authority.runs.get(member.envelope.runId);assert.ok(terminalMember);
  const deletion=CommandRequestSchema.parse({commandId:randomUUID(),requestedAt:h.clock.now().toISOString(),
    requestedBy:"local-operator",source:"dashboard",family:"run",type:"delete",
    target:{runId:terminalMember.envelope.runId,expectedVersion:terminalMember.version}});
  assert.equal(h.kernel.execute(deletion).state,"applied");
  assert.equal(h.database.authority.runs.get(member.envelope.runId),undefined);
  assert.ok(h.database.authority.deletedRuns.get(member.envelope.runId));
  h.restart(); assert.deepEqual(await h.intake.read(wire.intakeSessionId), terminal);
  assert.equal(JSON.stringify(h.database.authority.intakeManifests.get(terminal.manifest.manifestId)), manifestBefore);
  assert.deepEqual(await readArtifactBytes(() => h.artifacts.open(wire.artifact)), sourceBefore);
  assert.equal((await h.post(h.request(terminal, "inspect-intake", { headerRowIndex: 1 }))).status, 422);
  const fresh = await ready(h); assert.notEqual(fresh.intakeSessionId, wire.intakeSessionId); assert.equal(fresh.rerun?.intakeManifestId, terminal.manifest.manifestId);
});

for (const [name, mediaType, bytes] of [
  ["partial.csv", "text/csv", Buffer.from('Employee ID#,Effective Date\n"10456712,2026-07-01')],
  ["partial.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from([0x50, 0x4b, 3, 4, 0, 0])],
] as const) it(`refuses ${name} before creating a session or runs`, async () => {
  const h = await harness();
  const response = await h.app.request(`http://127.0.0.1/api/v1/intake/files?workflow=intake-fixture&filename=${name}`, { method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": mediaType }, body: new Uint8Array(bytes) });
  assert.equal(response.status, 422);
  assert.deepEqual(h.database.authority.intakeSessions.findActiveBySource(createHash("sha256").update(bytes).digest("hex")), []);
  assert.deepEqual(h.database.authority.runSessions.list(), []);
  assert.equal((await ready(h)).state, "validated");
});

it.each(["mapping", "correction", "exclusion"])("%s decisions invalidate the reviewed plan before fan-out", async decision => {
  const h = await harness(); const original = await ready(h);
  const changed = decision === "mapping"
    ? await send(h, original, "confirm-intake-mapping", { targetFieldId: "department", sourceColumnId: original.columns[2].sourceColumnId, headerFingerprint: original.headerFingerprint })
    : decision === "correction"
      ? await send(h, original, "correct-intake-row", { sourceRow: 1, field: "emplId", correctedValue: "10777777" })
      : await send(h, original, "exclude-intake-row", { sourceRow: 1, reason: "Synthetic explicit exclusion" });
  const reviewed = await send(h, changed, "validate-intake"); assert.notEqual(reviewed.reviewBinding, original.reviewBinding);
  const refused = await h.post(h.request(reviewed, "enqueue-intake-manifest", { dryRun: false, reviewBinding: original.reviewBinding }));
  assert.equal(refused.status, 422); noEffects(h, reviewed); assert.equal((await enqueue(h, reviewed)).state, "enqueued");
});
it("source-backed rejection evidence retains the complete local value and visible operator samples", async () => {
  const h = await harness(); const sentinel = "synthetic-private-6543";
  let wire = (await h.upload(INTAKE_CSV.replace("10-4567", sentinel))).session;
  assert.ok((await readArtifactBytes(() => h.artifacts.open(wire.artifact))).includes(Buffer.from(sentinel)));
  assert.ok(wire.columns[0].samples.includes(sentinel));
  for (const [target, column] of [["emplId", 0], ["effectiveDate", 1]] as const) wire = await send(h, wire, "confirm-intake-mapping", { targetFieldId: target, sourceColumnId: wire.columns[column].sourceColumnId, headerFingerprint: wire.headerFingerprint });
  wire = await send(h, wire, "validate-intake"); assert.equal(wire.validation.state, "validated");
  assert.ok(JSON.stringify(wire.validation).includes("6543")); assert.ok(JSON.stringify(wire.validation).includes(sentinel));
  const excluded = await send(h, wire, "exclude-intake-row", { sourceRow: 2, reason: "Synthetic invalid EID" });
  const terminal = await enqueue(h, await send(h, excluded, "validate-intake"));
  assert.ok(!JSON.stringify(terminal.manifest).includes(sentinel));
});
