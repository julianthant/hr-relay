import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { createPreflightReadinessResource,preflightReadinessResource } from "../../../src/dashboard/client/queries/preflight-state.js";
import type { PreflightReadinessWire } from "../../../src/models/preflight/preflight-contract.js";
import { buildPreflightReport,requiredPreflightChecks } from "../../../src/models/preflight/preflight.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const clock = manualClock(new Date("2026-09-19T12:00:00Z"));
const identity = { configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64) };
const report = buildPreflightReport({ ...identity, requestedCapabilities: ["dashboard.serve"], clock,
  observations: requiredPreflightChecks(["dashboard.serve"]).map(check => ({ check, state: "healthy", summary: "Controlled healthy observation" })) });
const command = { commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", type: "rerun-preflight", target: { expectedConfigFingerprint: identity.configFingerprint, expectedDescriptorFingerprint: identity.descriptorFingerprint } };
const response = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

it("Setup and doctor share the same served report and reject a late obsolete rerun after a remedy", async () => {
  const pending = Promise.withResolvers<Response>(); let reruns = 0; let mutations = 0;
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async url => {
    if (String(url).endsWith("/preflight/rerun")) { reruns += 1; return pending.promise; }
    if (String(url).endsWith("/commands")) { mutations += 1; throw new Error("lost acknowledgement"); }
    return response({ state: "present", report });
  } });
  const setup = preflightReadinessResource(client, identity); const doctor = preflightReadinessResource(client, identity);
  assert.equal(setup, doctor); await setup.read(); assert.equal(doctor.snapshot().state, "present");
  const rerun = setup.rerun(command); assert.equal(doctor.snapshot().state, "running");
  await assert.rejects(client.executeCommand({ commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "run", type: "cancel", target: { runId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", expectedVersion: 1 } }));
  assert.equal(mutations, 1); assert.equal(doctor.snapshot().state, "unavailable");
  pending.resolve(response({ state: "completed", commandId: command.commandId, report })); await rerun;
  assert.equal(reruns, 1); assert.equal(doctor.snapshot().state, "unavailable", "obsolete success cannot replace invalidated evidence");
  await doctor.read(); assert.equal(setup.snapshot().state, "present");
});

it("wrong identity, absent evidence and failed reads never produce a ready state", async () => {
  let result: PreflightReadinessWire = { state: "present", report: { ...report, configFingerprint: "f".repeat(64) as typeof report.configFingerprint } };
  let fail = false;
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async () => { if (fail) throw new Error("unavailable"); return response(result); } });
  const state = createPreflightReadinessResource(client, identity);
  await state.read(); assert.equal(state.snapshot().state, "unavailable");
  result = { state: "unavailable", reason: "No completed report" }; await state.read(); assert.deepEqual(state.snapshot(), result);
  fail = true; await state.read(); assert.equal(state.snapshot().state, "unavailable");
});

it("changing settings identity isolates a still-pending response from the newly selected resource", async () => {
  const pending = Promise.withResolvers<Response>();
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: () => pending.promise });
  const previous = preflightReadinessResource(client, { ...identity, settingsRevision: "1" });
  const request = previous.read();
  const current = preflightReadinessResource(client, { ...identity, settingsRevision: "2" });
  assert.notEqual(previous, current); pending.resolve(response({ state: "present", report })); await request;
  assert.equal(current.snapshot().state, "idle"); assert.equal(previous.snapshot().state, "present");
});

it("the served scoped query parses its selection and rejects malformed reports at transport", async () => {
  const urls: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async url => { urls.push(String(url)); return response({ state: "present", report: { ...report, results: [] } }); } });
  await assert.rejects(client.readPreflight({ workflowId: "person-lookup" as never, requestedInstance: { ucpath: "test" } }));
  assert.match(decodeURIComponent(urls[0] ?? ""), /"requestedInstance":\{"ucpath":"test"\}/);
});

it("an exact replay cannot make expired evidence current", async () => {
  let reads = 0;
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async url => {
    if (String(url).endsWith("/preflight/rerun")) return response({ state: "completed", commandId: command.commandId, report });
    reads += 1;
    return response({ state: "unavailable", reason: "Preflight evidence expired; re-check readiness." });
  } });
  const state = createPreflightReadinessResource(client, identity);
  await state.rerun(command);
  assert.equal(reads, 1);
  assert.deepEqual(state.snapshot(), { state: "unavailable", reason: "Preflight evidence expired; re-check readiness." });
});

it("preserves a changed-fingerprint report only as unavailable history", async () => {
  const previous = { ...report, configFingerprint: "f".repeat(64) as typeof report.configFingerprint };
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async () => response({
    state: "unavailable", reason: "Settings changed; re-check readiness.", lastCompleted: previous,
  }) });
  const state = createPreflightReadinessResource(client, identity);
  await state.read();
  const observed = state.snapshot();
  assert.equal(observed.state, "unavailable");
  if (observed.state !== "unavailable") throw new Error("changed report accepted");
  assert.deepEqual(observed.lastCompleted, previous);
});

it("keeps the last report visible only as history during a rerun and after transport failure", async () => {
  const pending = Promise.withResolvers<Response>();
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async url => {
    if (String(url).endsWith("/preflight/rerun")) return pending.promise;
    return response({ state: "present", report });
  } });
  const resource = createPreflightReadinessResource(client, identity);
  await resource.read();
  const attempt = resource.rerun(command);
  assert.deepEqual(resource.snapshot(), { state: "running", lastCompleted: report, previous: { state: "present", report } });
  pending.reject(new Error("network failed"));
  await attempt;
  const failed = resource.snapshot();
  assert.equal(failed.state, "unavailable");
  if (failed.state !== "unavailable") throw new Error("failed rerun accepted");
  assert.deepEqual(failed.lastCompleted, report);
});

it("shares overlapping reads and retains the original reason while a newer rerun discards late observations", async () => {
  const first = Promise.withResolvers<Response>(), second = Promise.withResolvers<Response>();
  const previous = { state: "unavailable" as const, reason: "Settings changed; re-check readiness.", lastCompleted: report };
  let reads = 0;
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: url => {
    if (url.endsWith("/preflight/rerun")) return Promise.resolve(response({ state: "completed", commandId: command.commandId, report }));
    reads += 1;
    return reads === 1 ? Promise.resolve(response(previous)) : reads === 2 ? first.promise : second.promise;
  } });
  const resource = createPreflightReadinessResource(client, identity);
  await resource.read();
  const older = resource.read(); assert.equal(resource.read(), older);
  const newer = resource.rerun(command);
  assert.deepEqual(resource.snapshot(), { state: "running", lastCompleted: report, previous });
  second.resolve(response({ state: "unavailable", reason: "New read failed" })); await newer;
  first.resolve(response({ state: "present", report })); await older;
  assert.deepEqual(resource.snapshot(), { state: "unavailable", reason: "New read failed", lastCompleted: report });
});

it("returning to an earlier identity creates a new incarnation and cannot revive a pending report", async () => {
  const pending = Promise.withResolvers<PreflightReadinessWire>();
  const client = { readPreflight: () => pending.promise } as never;
  const first = preflightReadinessResource(client, identity);
  const read = first.read();
  preflightReadinessResource(client, { ...identity, actorId: "another-operator" });
  const returned = preflightReadinessResource(client, identity);
  assert.notEqual(returned, first);
  pending.resolve({ state: "present", report });
  await read;
  assert.equal(returned.snapshot().state, "idle");
});

it("refuses mismatched selected rerun targets without dispatch and stops invalidated readback", async () => {
  let commands = 0, reads = 0;
  const pending = Promise.withResolvers<never>();
  const client = { rerunPreflight: () => { commands++; return pending.promise; }, readPreflight: () => { reads++; return Promise.resolve({ state: "present", report }); } } as never;
  const scoped = createPreflightReadinessResource(client, { ...identity, selection: { workflowId: "person-lookup" as never } });
  await scoped.rerun(command);
  assert.equal(commands, 0);
  assert.equal(scoped.snapshot().state, "unavailable");
  const resource = createPreflightReadinessResource(client, identity);
  const rerun = resource.rerun(command);
  resource.invalidate();
  pending.resolve(undefined as never);
  await rerun;
  assert.equal(commands, 1);
  assert.equal(reads, 0);
  assert.equal(resource.snapshot().state, "unavailable");
});
