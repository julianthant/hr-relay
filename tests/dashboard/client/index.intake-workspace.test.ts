// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { IntakeWorkspace } from "../../../src/dashboard/surfaces/intake/intake.js";
import { IntakeCommandResultWireSchema } from "../../../src/models/dashboard/workbooks.js";
import { IntakeCommandRequestSchema, CommandResultSchema } from "../../../src/rules/commands/commands.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { DashboardDayWireSchema } from "../../../src/models/dashboard/projection.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { FIXTURE_INTAKE_VALIDATED } from "../../support/fixtures/dashboard/fixture-intake.js";
import { FixtureCommandBinding } from "../../support/helpers/dashboard/command-binding.js";
import { createIntakeAuthority } from "../../support/fixtures/dashboard/fixture-intake-authority.js";
import { INTAKE_FIXTURE_WORKFLOW_ID } from "../../support/fixtures/intake-workflow-fixture.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
const authorities: ReturnType<typeof createIntakeAuthority>[] = [];
async function flush(work: () => void) { await act(async () => { work(); await Promise.resolve(); }); }
afterEach(async () => { await flush(() => root?.unmount()); root = undefined; document.body.replaceChildren(); for (const authority of authorities.splice(0)) authority.close(); });
async function mount(wire = FIXTURE_INTAKE_VALIDATED, options: {
  post?: (request: unknown, count: number) => Promise<Response>;
  read?: (count: number, url: string) => Promise<Response>;
  nowIso?: string;
} = {}) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const calls: unknown[] = []; const bodies: string[] = []; const readUrls: string[] = []; let enqueued = 0;
  const client = createDashboardClient({ baseUrl: "http://intake.test", fetchImpl: (url, init) => {
    if (init?.method === "POST") { assert.ok(typeof init.body === "string"); bodies.push(init.body); calls.push(JSON.parse(init.body)); return options.post?.(calls.at(-1), calls.length) ?? Promise.reject(new Error("Synthetic refusal to reach server")); }
    readUrls.push(url); if (options.read !== undefined) return options.read(readUrls.length, url);
    return Promise.resolve(new Response(JSON.stringify(wire), { status: 200, headers: { "content-type": "application/json" } }));
  } });
  await flush(() => root?.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", ...(options.nowIso === undefined ? {} : { nowIso: options.nowIso }), children: createElement(IntakeWorkspace, { workflowLabel: "Synthetic intake", actorId: "local-operator", supportsDryRun: true, sessionId: wire.intakeSessionId, onClose: () => {}, onEnqueued: () => { enqueued++; } }) }) })));
  const button = (text: string) => { const el = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === text); assert.ok(el, `Missing ${text}: ${host.textContent}`); return el; };
  return { host, button, calls, bodies, readUrls, get enqueued() { return enqueued; } };
}
it("acknowledging rejection history cannot enable unresolved rows", async () => {
  const h = await mount(); const checkbox = h.host.querySelector<HTMLButtonElement>('[role="checkbox"]'); assert.ok(checkbox);
  await flush(() => checkbox.click()); assert.equal(h.button(`Start ${String(FIXTURE_INTAKE_VALIDATED.validation.state === "validated" ? FIXTURE_INTAKE_VALIDATED.validation.validRows : 0)} runs`).disabled, true);
  assert.match(h.host.textContent ?? "", /unresolved/);
});
it("zero valid rows stay blocked even without rejection history", async () => {
  assert.equal(FIXTURE_INTAKE_VALIDATED.validation.state, "validated");
  if (FIXTURE_INTAKE_VALIDATED.validation.state !== "validated") throw new Error("fixture validation absent");
  const h = await mount({ ...FIXTURE_INTAKE_VALIDATED, validation: { ...FIXTURE_INTAKE_VALIDATED.validation, validRows: 0, unresolvedRows: [], rejected: [], excluded: [] } });
  assert.equal(h.button("Start 0 runs").disabled, true);
});
it("a failed correction preserves the editor draft", async () => {
  const h = await mount(); await flush(() => h.button("Fix cell").click());
  const input = h.host.querySelector<HTMLInputElement>('input[name="intake-corrected-value"]'); assert.ok(input);
  await flush(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "10456712"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush(() => h.button("Re-coerce this cell").click());
  assert.equal(h.calls.length, 1); assert.equal(input.value, "10456712"); assert.equal(input.isConnected, true);
});

function readyWire() {
  if (FIXTURE_INTAKE_VALIDATED.validation.state !== "validated") throw new Error("fixture validation absent");
  return { ...FIXTURE_INTAKE_VALIDATED, reviewBinding: FingerprintSchema.parse("a".repeat(64)), validation: { ...FIXTURE_INTAKE_VALIDATED.validation, unresolvedRows: [], rejected: [], validRows: 2 } };
}
async function readyAuthority() {
  const authority = createIntakeAuthority(); authorities.push(authority);
  const uploaded = await authority.intake.upload({ workflow: INTAKE_FIXTURE_WORKFLOW_ID, fileName: "synthetic.csv", mediaType: "text/csv",
    bytes: Uint8Array.from(new TextEncoder().encode("Employee ID#,Effective Date,Dept\n10456712,07/01/2026,Housing\n10998801,07/01/2026,Student Affairs\n")) });
  if (uploaded.state === "refused") throw new Error(uploaded.message);
  assert.equal(uploaded.state, "created");
  let session = uploaded.session;
  for (const [targetFieldId, column] of [["emplId", 0], ["effectiveDate", 1]] as const) {
    const result = CommandResultSchema.parse(await (await authority.post(authority.request(session, "confirm-intake-mapping", {
      targetFieldId, sourceColumnId: session.columns[column].sourceColumnId, headerFingerprint: session.headerFingerprint,
    }))).json());
    assert.equal(result.state, "applied"); session = await authority.intake.read(session.intakeSessionId);
  }
  const result = CommandResultSchema.parse(await (await authority.post(authority.request(session, "validate-intake"))).json());
  assert.equal(result.state, "applied");
  return { authority, wire: await authority.intake.read(session.intakeSessionId) };
}
async function confirm(h: Awaited<ReturnType<typeof mount>>) {
  const checkbox = h.host.querySelector<HTMLButtonElement>('[role="checkbox"]'); assert.ok(checkbox); await flush(() => checkbox.click());
}
it("requires explicit confirmation, then guards duplicate clicks and reads the exact receipt after a lost reply", async () => {
  const { authority, wire } = await readyAuthority();
  const h = await mount(wire, { nowIso: authority.clock.now().toISOString(), post: async (request, n) => {
    const response = await authority.post(request);
    if (n === 1) throw new Error("lost response");
    return response;
  }, read: async (_count, url) => authority.app.request(url) });
  assert.equal(h.button("Start 2 runs").disabled, true); await confirm(h); assert.equal(h.button("Start 2 runs").disabled, false);
  await flush(() => { h.button("Start 2 runs").click(); h.button("Start 2 runs").click(); });
  assert.equal(h.calls.length, 1); assert.equal(h.button("Start 2 runs").disabled, true);
  const minted = authority.mintedIds;
  authority.clock.advanceWall(5_000);
  await flush(() => h.button("Recover exact command").click()); assert.equal(h.calls.length, 1);
  assert.equal(h.bodies.length, 1); assert.deepEqual(authority.mintedIds, minted);
  assert.equal(h.host.textContent?.includes("Recover exact command"), false);
  assert.equal(h.enqueued, 0); await flush(() => h.button("Show the runs").click()); assert.equal(h.enqueued, 1);
});
it("after an applied response, recovery reads the exact journaled command and rereads its session and day without duplicate effects", async () => {
  const { authority, wire } = await readyAuthority();
  const replies: unknown[] = [];
  const h = await mount(wire, { nowIso: authority.clock.now().toISOString(), post: async request => {
    const response = await authority.post(request); replies.push(await response.clone().json()); return response;
  }, read: async (count, url) => count === 2 ? Promise.reject(new Error("readback failed")) : authority.app.request(url) });
  await confirm(h); await flush(() => h.button("Start 2 runs").click()); assert.equal(h.calls.length, 1);
  assert.equal(CommandResultSchema.parse(replies[0]).state, "applied");
  assert.ok(h.host.textContent?.includes(formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_OUTCOME_UNCERTAIN", {})).text));
  assert.equal(h.button("Recover exact command").disabled, false); assert.equal(h.enqueued, 0);
  const committed = await authority.intake.read(wire.intakeSessionId); const minted = authority.mintedIds;
  assert.ok(committed.manifest); assert.equal(committed.expectedVersion, wire.expectedVersion + 1);
  await flush(() => h.button("Recover exact command").click()); assert.equal(h.calls.length, 1);
  assert.equal(h.bodies.length, 1);
  const receiptUrl = h.readUrls.find(url => url.includes("/commands/")); assert.ok(receiptUrl);
  const receipt = IntakeCommandResultWireSchema.parse(await (await authority.app.request(receiptUrl)).json());
  assert.equal(receipt.state, "recorded");
  if (receipt.state !== "recorded") throw new Error("durable receipt missing");
  assert.deepEqual(receipt.request, { ...IntakeCommandRequestSchema.parse(h.calls[0]), requestedAt: receipt.request.requestedAt }); assert.deepEqual(receipt.result, replies[0]);
  assert.deepEqual(await authority.intake.read(wire.intakeSessionId), committed); assert.deepEqual(authority.mintedIds, minted);
  const sessionUrl = `http://intake.test/api/v1/intake/${wire.intakeSessionId}`;
  const dayUrl = `http://intake.test/api/v1/dashboard?day=${committed.manifest.createdAt.slice(0, 10)}`;
  assert.deepEqual(h.readUrls, [sessionUrl, sessionUrl, receiptUrl, sessionUrl, dayUrl]);
  const day = DashboardDayWireSchema.parse(await (await authority.app.request(dayUrl)).json());
  const reply = receipt.result; assert.equal(reply.state, "applied");
  if (reply.state !== "applied") throw new Error("receipt lacked applied result");
  const runIds = reply.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []);
  assert.equal(runIds.length, 2); assert.deepEqual(day.queueSurfaces.map(row => row.runId).sort(), [...runIds].sort());
  assert.equal(committed.intakeSessionId, wire.intakeSessionId); assert.equal(committed.manifest.manifestId, wire.reservedManifestId);
  assert.equal(day.day, committed.manifest.createdAt.slice(0, 10));
  assert.deepEqual(day.queueSurfaces.map(row => row.itemId).sort(), committed.manifest.validRows.map(row => row.itemId).sort());
  for (const row of day.queueSurfaces) {
    assert.equal(row.session.state, "present");
    if (row.session.state !== "present") throw new Error("queued intake run lacked its session relationship");
    assert.deepEqual(row.session.origin, { kind: "intake-manifest", intakeManifestId: committed.manifest.manifestId, actorId: "local-operator" });
  }
  assert.equal(new Set(day.queueSurfaces.flatMap(row => row.session.state === "present" ? [row.session.sessionId] : [])).size, 1);
  assert.equal(h.host.textContent?.includes("Recover exact command"), false);
  assert.equal(h.enqueued, 0); await flush(() => h.button("Show the runs").click()); assert.equal(h.enqueued, 1);
});
it("a served required target without a binding stays visible and blocks Start", async () => {
  const base = readyWire(); const target = base.targets[0];
  const h = await mount({ ...base, targets: [{ ...target, required: true }], bindings: [], constants: [] });
  assert.ok(h.host.textContent?.includes(`${target.label} is not bound`)); assert.equal(h.button("Start 2 runs").disabled, true);
});
