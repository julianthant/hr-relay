// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { useIntakeWiringAdapter } from "../../../src/dashboard/state/intake-wiring-adapter.js";
import { FixtureCommandBinding } from "../../support/helpers/dashboard/command-binding.js";
import { FIXTURE_INTAKE_MAPPING, FIXTURE_INTAKE_VALIDATED } from "../../support/fixtures/dashboard/fixture-intake.js";
import { createIntakeAuthority } from "../../support/fixtures/dashboard/fixture-intake-authority.js";
import { intakeReadinessBlockers, rejectionReviewEligibility } from "../../../src/dashboard/surfaces/intake/intake-model.js";
import type { IntakeSessionWire } from "../../../src/models/intake/wire.js";
import type { IntakeCommand } from "../../../src/dashboard/surfaces/intake/intake-command-model.js";
import { INTAKE_FIXTURE_WORKFLOW_ID } from "../../support/fixtures/intake-workflow-fixture.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
const authorities: ReturnType<typeof createIntakeAuthority>[] = [];
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); for (const authority of authorities.splice(0)) authority.close(); });
type Adapter = ReturnType<typeof useIntakeWiringAdapter>;
let model: Adapter;
const applied: string[] = [];
const onApplied = (command: { type: string }) => { applied.push(command.type); };
function Harness({ client, sessionId }: { client: ReturnType<typeof createDashboardClient>; sessionId: string }) {
  model = useIntakeWiringAdapter(client, sessionId, onApplied);
  return null;
}
async function mount(client: ReturnType<typeof createDashboardClient>, sessionId: string, requestKey = 0, nowIso?: string) {
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); applied.length = 0; }
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", requestKey, nowIso,
    children: createElement(Harness, { client, sessionId }) }) })));
}
function session(): IntakeSessionWire { assert.equal(model.resource.state, "loaded"); if (model.resource.state !== "loaded") throw new Error("session not loaded"); return model.resource.session; }
async function issue(command: IntakeCommand) { const before = session(); await act(async () => model.issue(before, command, command.type)); }
function json(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }

it("preserves served sheets, canonical fields, exclusions and exact review authority without projection copies", async () => {
  const wire = { ...FIXTURE_INTAKE_VALIDATED, sheets: ["Roster", "Notes"], sheet: "Roster" };
  const client = createDashboardClient({ baseUrl: "http://intake.test", fetchImpl: async () => json(wire) });
  await mount(client, wire.intakeSessionId);
  const served = session();
  assert.deepEqual(served.sheets, wire.sheets);
  assert.deepEqual(served.targets, wire.targets); assert.deepEqual(served.bindings, wire.bindings);
  for (const binding of served.bindings) assert.equal(served.targets.find(target => target.targetFieldId === binding.targetFieldId)?.canonicalFieldId, binding.canonicalFieldId);
  assert.deepEqual(served.validation, wire.validation);
  assert.equal(served.reviewBinding, wire.reviewBinding); assert.equal(served.reservedManifestId, wire.reservedManifestId);
  assert.deepEqual(intakeReadinessBlockers(served), intakeReadinessBlockers(wire));
  assert.deepEqual(rejectionReviewEligibility(served, undefined), rejectionReviewEligibility(wire, undefined));
  assert.equal(model.busy, false);
});

it("suppresses superseded reads and refuses commands using a displaced session object", async () => {
  let release!: (response: Response) => void;
  const posts: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://intake.test", fetchImpl: async (url, init) => {
    if (init?.method === "POST") { posts.push(url); throw new Error("unexpected dispatch"); }
    if (url.endsWith(FIXTURE_INTAKE_MAPPING.intakeSessionId)) return new Promise(resolve => { release = resolve; });
    return json(FIXTURE_INTAKE_VALIDATED);
  } });
  await mount(client, FIXTURE_INTAKE_MAPPING.intakeSessionId); assert.equal(model.resource.state, "loading"); assert.equal(model.busy, true);
  await mount(client, FIXTURE_INTAKE_VALIDATED.intakeSessionId);
  await act(async () => release(json(FIXTURE_INTAKE_MAPPING)));
  assert.equal(session().intakeSessionId, FIXTURE_INTAKE_VALIDATED.intakeSessionId);
  await act(async () => model.issue(FIXTURE_INTAKE_MAPPING, { type: "validate-intake" }, "old"));
  assert.deepEqual(posts, []);
});

it("retains stale data during refresh, blocks writes and exposes failed refresh distinctly", async () => {
  let reads = 0, reject!: (cause: unknown) => void;
  const client = createDashboardClient({ baseUrl: "http://intake.test", fetchImpl: async () => {
    if (++reads === 1) return json(FIXTURE_INTAKE_MAPPING);
    return new Promise((_resolve, fail) => { reject = fail; });
  } });
  await mount(client, FIXTURE_INTAKE_MAPPING.intakeSessionId);
  const before = session();
  await mount(client, before.intakeSessionId, 1);
  assert.equal(session(), before); assert.equal(model.busy, true);
  assert.equal(model.resource.state === "loaded" && model.resource.stale, true);
  await act(async () => model.issue(before, { type: "validate-intake" }, "validate"));
  assert.equal(reads, 2);
  await act(async () => reject(new Error("read unavailable")));
  assert.equal(model.resource.state, "failed");
  if (model.resource.state !== "failed") throw new Error("refresh did not fail");
  assert.equal(model.resource.retained, before); assert.equal(model.busy, true);
});

it("uses real intake mapping validation, keeps excluded rows and admits only the exact reviewed enqueue", async () => {
  const authority = createIntakeAuthority(); authorities.push(authority);
  const uploaded = await authority.intake.upload({ workflow: INTAKE_FIXTURE_WORKFLOW_ID, fileName: "synthetic.csv", mediaType: "text/csv",
    bytes: Uint8Array.from(new TextEncoder().encode("Employee ID#,Effective Date,Dept\n10456712,07/01/2026,Housing\n10-4567,07/01/2026,Housing\n10998801,07/01/2026,Student Affairs\n")) });
  assert.notEqual(uploaded.state, "refused"); if (uploaded.state === "refused") throw new Error(uploaded.message);
  const sent: unknown[] = [];
  const client = createDashboardClient({ baseUrl: "http://intake.test", fetchImpl: async (url, init) => {
    if (init?.method === "POST") { assert.ok(typeof init.body === "string"); const body: unknown = JSON.parse(init.body); sent.push(body); return authority.post(body); }
    return authority.app.request(url);
  } });
  await mount(client, uploaded.session.intakeSessionId, 0, authority.clock.now().toISOString());
  await issue({ type: "confirm-intake-mapping", payload: { targetFieldId: "missing", sourceColumnId: session().columns[0].sourceColumnId, headerFingerprint: session().headerFingerprint ?? "" } });
  assert.equal(model.problem?.kind, "rejected"); assert.equal(session().expectedVersion, 1);
  for (const [targetFieldId, column] of [["emplId", 0], ["effectiveDate", 1]] as const) await issue({ type: "confirm-intake-mapping", payload: { targetFieldId, sourceColumnId: session().columns[column].sourceColumnId, headerFingerprint: session().headerFingerprint ?? "" } });
  const mapped = session();
  const binding = mapped.bindings[0]; assert.ok(binding);
  await issue({ type: "confirm-intake-mapping", payload: { targetFieldId: binding.targetFieldId, sourceColumnId: binding.sourceColumnId, headerFingerprint: mapped.headerFingerprint ?? "" } });
  assert.equal(session().expectedVersion, mapped.expectedVersion);
  assert.equal(session().bindings.filter(entry => entry.targetFieldId === binding.targetFieldId).length, 1);
  await issue({ type: "validate-intake" });
  let reviewed = session(); assert.equal(reviewed.validation.state, "validated");
  assert.ok(intakeReadinessBlockers(reviewed).some(text => text.includes("unresolved")));
  await issue({ type: "exclude-intake-row", payload: { sourceRow: 2, reason: "Reviewed invalid source value" } });
  await issue({ type: "validate-intake" });
  reviewed = session(); assert.equal(reviewed.validation.state, "validated");
  if (reviewed.validation.state !== "validated") throw new Error("validation missing");
  assert.deepEqual(reviewed.validation.excluded, [2]); assert.equal(reviewed.validation.validRows, 2);
  assert.equal(reviewed.rowCount, 3); assert.deepEqual(intakeReadinessBlockers(reviewed), []);
  assert.ok(reviewed.reviewBinding);
  await issue({ type: "enqueue-intake-manifest", payload: { dryRun: false, reviewBinding: "f".repeat(64) } });
  assert.equal(model.problem?.kind, "rejected"); assert.equal(authority.database.authority.runSessions.list().length, 0);
  await issue({ type: "enqueue-intake-manifest", payload: { dryRun: false, reviewBinding: reviewed.reviewBinding } });
  assert.equal(model.problem, null);
  const terminal = session(); assert.equal(terminal.state, "enqueued");
  assert.equal(terminal.intakeManifestId, reviewed.reservedManifestId); assert.equal(terminal.manifest?.manifestId, reviewed.reservedManifestId);
  assert.equal(terminal.manifest?.validRows.length, 2); assert.equal(terminal.manifest?.totals.excluded, 1);
  assert.equal(authority.database.authority.runSessions.list().length, 1);
  assert.ok(applied.includes("enqueue-intake-manifest")); assert.ok(sent.length > 0);
});
