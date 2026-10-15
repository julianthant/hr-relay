// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider, DashboardCommandBindingProvider, useDashboardCommandBinding } from "../../../../src/dashboard/state/client-context.js";
import { IntakeWorkspace } from "../../../../src/dashboard/surfaces/intake/intake.js";
import { FIXTURE_BOOTSTRAP } from "../../../support/fixtures/dashboard/fixture-bootstrap.js";
import { useIntakeCommands, verifyIntakeCommand, type IntakeRequest, type IntakeCommand } from "../../../../src/dashboard/surfaces/intake/intake-command-model.js";
import { IntakeCommandRequestSchema, CommandResultSchema, type CommandResult } from "../../../../src/rules/commands/commands.js";
import { DashboardDayWireSchema } from "../../../../src/models/dashboard/projection.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { deriveMappingSnapshotHash } from "../../../../src/models/intake/mapping.js";
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../../src/models/intake/wire.js";
import { FIXTURE_INTAKE_MAPPING, FIXTURE_INTAKE_VALIDATED, FIXTURE_INTAKE_MANIFEST } from "../../../support/fixtures/dashboard/fixture-intake.js";
import { FIXTURE_DAY_WIRE } from "../../../support/fixtures/dashboard/fixture-queue.js";
import { serverLocalDay } from "../../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import type { CommandExecutor } from "../../../../src/dashboard/app/commands/command-executor.js";
import { FixtureCommandBinding } from "../../../support/helpers/dashboard/command-binding.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class MeasurementFreeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
const ACTOR = LOCAL_OPERATOR_ACTOR_ID;
const COMMAND_ID = "738b193e-2d63-463c-9e7f-9f0691b65820";
const NOW = "2026-08-03T17:10:00.000Z";
function request(before: IntakeSessionWire, command: object): IntakeRequest {
  return IntakeCommandRequestSchema.parse({ commandId: COMMAND_ID, requestedAt: NOW, requestedBy: ACTOR,
    source: "intake-workspace", family: "intake", target: { intakeSessionId: before.intakeSessionId, expectedVersion: before.expectedVersion }, ...command });
}
function applied(sent: IntakeRequest, runIds: readonly string[] = []): CommandResult {
  return CommandResultSchema.parse({ state: "applied", commandId: sent.commandId, affectedTargets: [{ family: "intake", intakeSessionId: sent.target.intakeSessionId }, ...runIds.map(runId => ({ family: "run", runId }))] });
}
function clientFor(read: (url: string) => unknown, post?: (sent: IntakeRequest) => unknown, queue = FIXTURE_DAY_WIRE) {
  return createDashboardClient({ baseUrl: "http://intake.test", fetchImpl: async (url, init) => {
    let body: unknown;
    if (init?.method === "POST") {
      assert.ok(typeof init.body === "string");
      body = await post?.(IntakeCommandRequestSchema.parse(JSON.parse(init.body)));
    } else body = url.includes("/dashboard?") ? queue : await read(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  } });
}
function validated(before = FIXTURE_INTAKE_MAPPING): IntakeSessionWire {
  return IntakeSessionWireSchema.parse({ ...before, state: "validated", expectedVersion: before.expectedVersion + 1, updatedAt: NOW,
    validation: { ...FIXTURE_INTAKE_VALIDATED.validation, state: "validated", validatedAt: NOW, readAt: NOW,
      validRows: 3, unresolvedRows: [], rejected: [], excluded: [] } });
}

let root: Root | undefined;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  document.body.replaceChildren();
});

describe("Intake effect readback through the typed transport", () => {
  it("requires exact session, expected revision and validation effect", async () => {
    const before = FIXTURE_INTAKE_MAPPING;
    const sent = request(before, { type: "validate-intake" });
    for (const [next, expected] of [
      [validated(before), "matched"],
      [{ ...validated(before), expectedVersion: before.expectedVersion }, "mismatch"],
      [{ ...validated(before), expectedVersion: before.expectedVersion + 2 }, "conflict"],
      [{ ...before, expectedVersion: before.expectedVersion + 1 }, "mismatch"],
    ] as const) {
      assert.equal((await verifyIntakeCommand(clientFor(() => next), before, sent, applied(sent), FIXTURE_BOOTSTRAP.serverClock.zone)).state, expected);
    }
    await assert.rejects(verifyIntakeCommand(clientFor(() => ({ ...validated(before), intakeSessionId: FIXTURE_INTAKE_VALIDATED.intakeSessionId })), before, sent, applied(sent), FIXTURE_BOOTSTRAP.serverClock.zone), /intake session identity mismatch/);
    const foreign = { ...applied(sent), affectedTargets: [{ family: "intake" as const, intakeSessionId: FIXTURE_INTAKE_VALIDATED.intakeSessionId }] };
    assert.equal((await verifyIntakeCommand(clientFor(() => validated(before)), before, sent, foreign, FIXTURE_BOOTSTRAP.serverClock.zone)).state, "mismatch");
  });

  it("proves mapping, correction, exclusion and layout clearing, including a real no-op", async () => {
    const before = FIXTURE_INTAKE_MAPPING;
    const held = before.bindings[0];
    assert.ok(held);
    const mapping = request(before, { type: "confirm-intake-mapping", payload: { targetFieldId: held.targetFieldId, sourceColumnId: held.sourceColumnId, headerFingerprint: before.headerFingerprint } });
    assert.equal((await verifyIntakeCommand(clientFor(() => before), before, mapping, applied(mapping), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "matched");
    const changedVersion = { ...before, expectedVersion: before.expectedVersion + 1 };
    assert.equal((await verifyIntakeCommand(clientFor(() => changedVersion), before, mapping, applied(mapping), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "conflict");
    const correction = request(before, { type: "correct-intake-row", payload: { sourceRow: 1, field: held.targetFieldId, correctedValue: "10456712" } });
    const corrected = { ...changedVersion, corrections: [{ sourceRow: 1, field: held.targetFieldId, correctedValue: "10456712", correctedAt: NOW }] };
    assert.equal((await verifyIntakeCommand(clientFor(() => corrected), before, correction, applied(correction), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "matched");
    assert.equal((await verifyIntakeCommand(clientFor(() => changedVersion), before, correction, applied(correction), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "mismatch");
    const exclusion = request(before, { type: "exclude-intake-row", payload: { sourceRow: 1, reason: "Reviewed fixture exclusion" } });
    const excluded = { ...changedVersion, exclusions: [{ sourceRow: 1, reason: "Reviewed fixture exclusion", excludedAt: NOW }] };
    assert.equal((await verifyIntakeCommand(clientFor(() => excluded), before, exclusion, applied(exclusion), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "matched");
    const inspect = request(before, { type: "inspect-intake", payload: { headerRowIndex: 1 } });
    assert.equal((await verifyIntakeCommand(clientFor(() => ({ ...changedVersion, headerRowIndex: 1, bindings: [] })), before, inspect, applied(inspect), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "matched");
    assert.equal((await verifyIntakeCommand(clientFor(() => ({ ...changedVersion, headerRowIndex: 1 })), before, inspect, applied(inspect), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "mismatch");
  });

  it("distinguishes automatic prior comparison from explicit persisted selection and exact no-op", async () => {
    const rerun = FIXTURE_INTAKE_MANIFEST.rerun;
    assert.ok(rerun);
    const before = { ...FIXTURE_INTAKE_MAPPING, rerun };
    const sent = request(before, { type: "inspect-intake", payload: { comparisonManifestId: rerun.intakeManifestId } });
    const selected = IntakeSessionWireSchema.parse({ ...before, expectedVersion: before.expectedVersion + 1, comparisonManifestId: rerun.intakeManifestId });
    assert.equal((await verifyIntakeCommand(clientFor(() => selected), before, sent, applied(sent), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "matched");
    assert.equal((await verifyIntakeCommand(clientFor(() => ({ ...before, expectedVersion: selected.expectedVersion })), before, sent, applied(sent), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "mismatch");
    const repeated = request(selected, { type: "inspect-intake", payload: { comparisonManifestId: rerun.intakeManifestId } });
    assert.equal((await verifyIntakeCommand(clientFor(() => selected), selected, repeated, applied(repeated), FIXTURE_BOOTSTRAP.serverClock.zone)).state, "matched");
  });

  it("confirms enqueue only with the reserved manifest and every exact run relationship", async () => {
    const fixture = FIXTURE_INTAKE_MANIFEST;
    assert.ok(fixture.manifest);
    assert.ok(fixture.headerRowIndex !== null && fixture.headerFingerprint !== null);
    const terminal = { ...fixture, manifest: { ...fixture.manifest, mappingSnapshotHash: deriveMappingSnapshotHash({ workflow: fixture.workflow,
      sheet: fixture.sheet, headerRowIndex: fixture.headerRowIndex, headerFingerprint: fixture.headerFingerprint, bindings: fixture.bindings, constants: fixture.constants }) } };
    const before = IntakeSessionWireSchema.parse({ ...FIXTURE_INTAKE_VALIDATED, intakeSessionId: terminal.intakeSessionId,
      reservedManifestId: terminal.intakeManifestId, reviewBinding: "a".repeat(64), validation: terminal.validation });
    const sent = request(before, { type: "enqueue-intake-manifest", payload: { dryRun: true, reviewBinding: before.reviewBinding } });
    const template = FIXTURE_DAY_WIRE.queueSurfaces[0];
    assert.ok(template);
    const rows = terminal.manifest.validRows.map((row, index) => ({ ...template,
      runId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
      itemId: row.itemId, workflowId: before.workflow, dryRun: true, actorId: ACTOR, descriptorHash: terminal.manifest.workflowContractFingerprint,
      session: { state: "present" as const, sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        origin: { kind: "intake-manifest" as const, intakeManifestId: terminal.manifest.manifestId, actorId: ACTOR } },
    }));
    const reply = applied(sent, rows.map(row => row.runId));
    for (const [surfaces, expected] of [
      [rows, "matched"], [rows.slice(1), "mismatch"],
      [rows.map(row => ({ ...row, session: { state: "absent", reason: "No relationship" } })), "mismatch"],
      [rows.map(row => ({ ...row, session: { ...row.session, origin: { ...row.session.origin, actorId: "other-operator" } } })), "mismatch"],
      [rows.map(row => ({ ...row, dryRun: false })), "mismatch"],
      [rows.map(row => ({ ...row, descriptorHash: "b".repeat(64) })), "mismatch"],
      [rows.map(row => ({ ...row, actorId: "other-operator" })), "mismatch"],
    ] as const) {
      const queue = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, queueSurfaces: surfaces });
      assert.equal((await verifyIntakeCommand(clientFor(() => terminal, undefined, queue), before, sent, reply, FIXTURE_BOOTSTRAP.serverClock.zone)).state, expected);
    }
    assert.equal((await verifyIntakeCommand(clientFor(() => terminal), IntakeSessionWireSchema.parse({ ...before, reservedManifestId: COMMAND_ID }), sent, reply, FIXTURE_BOOTSTRAP.serverClock.zone)).state, "mismatch");
  });
});

let capturedExecutor: CommandExecutor | undefined;
function Harness({ client, adopt, capture }: { client: ReturnType<typeof createDashboardClient>; adopt: (session: IntakeSessionWire) => void; capture: (value: ReturnType<typeof useIntakeCommands>) => void }) {
  capturedExecutor = useDashboardCommandBinding()?.executor;
  capture(useIntakeCommands(client, FIXTURE_INTAKE_MAPPING.intakeSessionId, adopt));
  return null;
}
function UnsubscribedDay({ children, today }: { children: ReactNode; today?: string }) {
  const binding = useDashboardCommandBinding();
  assert.ok(binding);
  return createElement(DashboardCommandBindingProvider, { binding: { ...binding,
    authority: { ...binding.authority, ...(today === undefined ? {} : { today, nowIso: `${today}T17:10:00.000Z` }), dayState: { ...binding.authority.dayState, day: { state: "loading" } } } }, children });
}
async function mount(client: ReturnType<typeof createDashboardClient>, capture: (value: ReturnType<typeof useIntakeCommands>) => void, adopt: (session: IntakeSessionWire) => void, actorId: string = ACTOR, requestKey = 0, visible = true, unsubscribed = false, today?: string) {
  if (root === undefined) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId, requestKey,
    children: visible ? (unsubscribed || today !== undefined ? createElement(UnsubscribedDay, { today, children: createElement(Harness, { client, adopt, capture }) }) : createElement(Harness, { client, adopt, capture })) : null }) })); });
}

describe("mounted Intake shares retained executor attempts", () => {
  it("the actual all-mock workspace validates with a loaded session and an unsubscribed day", async () => {
    let session = FIXTURE_INTAKE_MAPPING;
    const sent: IntakeRequest[] = [];
    const client = clientFor(() => session, command => { sent.push(command); session = validated(); return applied(command); });
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root?.render(createElement(DashboardClientProvider, { client,
      children: createElement(FixtureCommandBinding, { actorId: ACTOR, children: createElement(UnsubscribedDay, { children: createElement(IntakeWorkspace, {
        workflowLabel: "Fixture workflow", actorId: "stale-prop-actor", supportsDryRun: true,
        sessionId: session.intakeSessionId, onClose: () => undefined, onEnqueued: () => undefined,
      }) }) }) })); });
    const validate = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "Validate");
    assert.ok(validate);
    await act(async () => { validate.click(); });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].requestedBy, ACTOR);
    assert.equal(sent[0].requestedAt, FIXTURE_BOOTSTRAP.serverClock.now);
    assert.ok([...document.querySelectorAll("button")].some(button => button.textContent?.trim() === "Re-validate"));
    assert.ok(!document.body.textContent?.includes("Recover exact command"));
  });

  it("ordinary Intake commands dispatch and prove their effects without a subscribed workflow day", async () => {
    let session = FIXTURE_INTAKE_MAPPING;
    const sent: IntakeRequest[] = [];
    const held = session.bindings[0];
    assert.ok(held);
    const client = clientFor(() => session, command => {
      sent.push(command);
      switch (command.type) {
        case "inspect-intake": case "confirm-intake-mapping": break;
        case "correct-intake-row": session = IntakeSessionWireSchema.parse({ ...session, expectedVersion: session.expectedVersion + 1,
          corrections: [{ ...command.payload, correctedAt: NOW }] }); break;
        case "exclude-intake-row": session = IntakeSessionWireSchema.parse({ ...session, expectedVersion: session.expectedVersion + 1,
          exclusions: [{ ...command.payload, excludedAt: NOW }] }); break;
        case "validate-intake": session = validated(session); break;
        case "enqueue-intake-manifest": throw new Error("enqueue is outside this ordinary command test");
      }
      return applied(command);
    });
    let model!: ReturnType<typeof useIntakeCommands>;
    const adopted: IntakeSessionWire[] = [];
    await mount(client, value => { model = value; }, value => { adopted.push(value); }, ACTOR, 0, true, true);
    const commands: IntakeCommand[] = [
      { type: "inspect-intake", payload: {} },
      { type: "confirm-intake-mapping", payload: { targetFieldId: held.targetFieldId, sourceColumnId: held.sourceColumnId, headerFingerprint: session.headerFingerprint ?? "" } },
      { type: "correct-intake-row", payload: { sourceRow: 1, field: held.targetFieldId, correctedValue: "10456712" } },
      { type: "exclude-intake-row", payload: { sourceRow: 1, reason: "Reviewed fixture exclusion" } },
      { type: "validate-intake" },
    ];
    for (const command of commands) {
      await act(async () => { model.issue(session, command, command.type); });
      assert.equal(model.problem, null);
      assert.equal(model.recovery, null);
    }
    assert.equal(sent.length, commands.length);
    assert.equal(adopted.length, commands.length);
    assert.equal(adopted.at(-1)?.state, "validated");
  });

  it("retains a lost reply across unmount and reads its exact receipt without dispatch", async () => {
    const sent: IntakeRequest[] = [];
    const before = FIXTURE_INTAKE_MAPPING;
    const client = clientFor(url => url.includes("/commands/") ? { state: "recorded", request: { ...sent[0], requestedAt: "2026-08-03T17:15:00.000Z" }, result: applied(sent[0]) } : validated(before), command => {
      sent.push(command);
      if (sent.length === 1) throw new Error("private transport cause");
      return applied(command);
    });
    let model!: ReturnType<typeof useIntakeCommands>;
    const capture = (next: typeof model) => { model = next; };
    const adopted: IntakeSessionWire[] = [];
    const adopt = (session: IntakeSessionWire) => { adopted.push(session); };
    await mount(client, capture, adopt);
    await act(async () => { model.issue(before, { type: "validate-intake" }, "validate"); });
    assert.equal(adopted.length, 0);
    assert.ok(model.recovery);
    assert.ok(!model.problem?.message.includes("private transport cause"));
    await mount(client, capture, adopt, ACTOR, 0, false);
    await mount(client, capture, adopt);
    await act(async () => { model.issue(before, { type: "inspect-intake", payload: {} }, "inspect"); });
    assert.equal(sent.length, 1);
    await act(async () => { model.recovery?.retry(); });
    assert.equal(sent.length, 1);
    assert.equal(adopted.length, 1);
    assert.equal(model.recovery, null);
  });

  it.each(["unavailable", "wrong-source", "altered-payload", "wrong-target", "wrong-version", "wrong-actor", "wrong-command"] as const)("keeps recovery uncertain and locked for %s receipts without another POST", async kind => {
    const sent: IntakeRequest[] = [];
    const reads: string[] = [];
    const before = FIXTURE_INTAKE_MAPPING;
    const client = clientFor(url => {
      reads.push(url);
      if (!url.includes("/commands/")) return validated(before);
      if (kind === "unavailable") return { state: "unavailable" };
      const original = sent[0];
      const request = kind === "wrong-source" ? { ...original, source: "intake-workspace" }
        : kind === "wrong-target" ? { ...original, target: { ...original.target, intakeSessionId: FIXTURE_INTAKE_VALIDATED.intakeSessionId } }
        : kind === "wrong-version" ? { ...original, target: { ...original.target, expectedVersion: original.target.expectedVersion + 1 } }
        : kind === "wrong-actor" ? { ...original, requestedBy: "other-operator" }
        : kind === "wrong-command" ? { ...original, commandId: COMMAND_ID }
        : { ...original, type: "inspect-intake", payload: {} };
      return { state: "recorded", request, result: applied(original) };
    }, command => { sent.push(command); throw new Error("lost delivery"); });
    let model!: ReturnType<typeof useIntakeCommands>;
    const adopted: IntakeSessionWire[] = [];
    await mount(client, value => { model = value; }, value => { adopted.push(value); });
    await act(async () => model.issue(before, { type: "validate-intake" }, "validate"));
    await act(async () => model.recovery?.retry());
    assert.equal(sent.length, 1); assert.equal(sent[0].source, "dashboard");
    assert.deepEqual(reads, [`http://intake.test/api/v1/intake/${before.intakeSessionId}/commands/${sent[0].commandId}`]);
    assert.equal(adopted.length, 0); assert.ok(model.recovery); assert.equal(model.busy, true);
    await act(async () => model.issue(before, { type: "inspect-intake", payload: {} }, "inspect"));
    assert.equal(sent.length, 1);
  });

  it("clears local pending after scope replacement, suppresses late adoption and refuses another actor recovery", async () => {
    let release!: (reply: CommandResult) => void;
    const sent: IntakeRequest[] = [];
    const client = clientFor(() => validated(), command => { sent.push(command); return new Promise<CommandResult>(resolve => { release = resolve; }); });
    let model!: ReturnType<typeof useIntakeCommands>;
    const capture = (next: typeof model) => { model = next; };
    const adopted: IntakeSessionWire[] = [];
    const adopt = (session: IntakeSessionWire) => { adopted.push(session); };
    await mount(client, capture, adopt);
    await act(async () => { model.issue(FIXTURE_INTAKE_MAPPING, { type: "validate-intake" }, "validate"); });
    assert.equal(model.pending, "validate");
    await mount(client, capture, adopt, "other-operator", 1);
    assert.equal(model.pending, null);
    assert.ok(model.recovery);
    await act(async () => { release(applied(sent[0])); });
    assert.equal(adopted.length, 0);
    await act(async () => { model.recovery?.retry(); });
    assert.equal(sent.length, 1);
    assert.equal(adopted.length, 0);
  });

  it.each(["ack-lost", "not-applied"] as const)("exact enqueue recovery reads only recorded receipts after midnight: %s", async (firstDelivery) => {
    const fixture = FIXTURE_INTAKE_MANIFEST;
    assert.ok(fixture.manifest && fixture.headerRowIndex !== null && fixture.headerFingerprint !== null);
    const before = IntakeSessionWireSchema.parse({ ...FIXTURE_INTAKE_VALIDATED, intakeSessionId: FIXTURE_INTAKE_MAPPING.intakeSessionId,
      reservedManifestId: fixture.intakeManifestId, reviewBinding: "a".repeat(64), validation: fixture.validation });
    const terminal = { ...fixture, intakeSessionId: before.intakeSessionId, manifest: { ...fixture.manifest,
      mappingSnapshotHash: deriveMappingSnapshotHash({ workflow: before.workflow, sheet: before.sheet,
        headerRowIndex: fixture.headerRowIndex, headerFingerprint: fixture.headerFingerprint, bindings: before.bindings, constants: before.constants }) } };
    const template = FIXTURE_DAY_WIRE.queueSurfaces[0];
    assert.ok(template);
    const rows = terminal.manifest.validRows.map((row, index) => ({ ...template,
      runId: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`, itemId: row.itemId,
      workflowId: before.workflow, dryRun: true, actorId: ACTOR, descriptorHash: terminal.manifest.workflowContractFingerprint,
      session: { state: "present" as const, sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        origin: { kind: "intake-manifest" as const, intakeManifestId: terminal.manifest.manifestId, actorId: ACTOR } },
    }));
    const originalDay = serverLocalDay({ now: FIXTURE_BOOTSTRAP.serverClock.now, zone: FIXTURE_BOOTSTRAP.serverClock.zone });
    const tomorrow = new Date(`${originalDay}T00:00:00.000Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dayReads: string[] = [];
    const sent: IntakeRequest[] = [];
    const client = createDashboardClient({ baseUrl: "http://intake.test", fetchImpl: async (url, init) => {
      let body: unknown;
      if (init?.method === "POST") {
        assert.ok(typeof init.body === "string");
        const command = IntakeCommandRequestSchema.parse(JSON.parse(init.body));
        sent.push(command);
        throw new Error(firstDelivery === "ack-lost" ? "lost enqueue reply" : "delivery did not apply");
      } else if (url.includes("/commands/")) {
        body = firstDelivery === "ack-lost" ? { state: "recorded", request: sent[0], result: applied(sent[0], rows.map(row => row.runId)) } : { state: "unavailable" };
      } else if (url.includes("/dashboard?")) {
        const day = new URL(url).searchParams.get("day");
        assert.ok(day); dayReads.push(day);
        body = { ...FIXTURE_DAY_WIRE, day: serverLocalDay({ now: terminal.manifest.createdAt, zone: FIXTURE_BOOTSTRAP.serverClock.zone }), queueSurfaces: rows };
      } else body = terminal;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    } });
    let model!: ReturnType<typeof useIntakeCommands>;
    const adopted: IntakeSessionWire[] = [];
    const capture = (value: typeof model) => { model = value; };
    const adopt = (value: IntakeSessionWire) => { adopted.push(value); };
    await mount(client, capture, adopt);
    await act(async () => { model.issue(before, { type: "enqueue-intake-manifest", payload: { dryRun: true, reviewBinding: before.reviewBinding } }, "run"); });
    assert.ok(model.recovery);
    await mount(client, capture, adopt, ACTOR, 1, true, true, tomorrow.toISOString().slice(0, 10));
    await act(async () => { model.recovery?.retry(); });
    assert.equal(sent.length, 1);
    assert.deepEqual(dayReads, firstDelivery === "ack-lost" ? [originalDay] : []);
    assert.equal(adopted.length, firstDelivery === "ack-lost" ? 1 : 0);
    if (firstDelivery === "ack-lost") assert.equal(model.recovery, null);
    else { assert.ok(model.recovery); assert.equal(model.busy, true); }
  });

  it("captured issue callbacks cannot dispatch after unmount or view replacement", async () => {
    const sent: IntakeRequest[] = [];
    const client = clientFor(() => validated(), command => { sent.push(command); return applied(command); });
    let model!: ReturnType<typeof useIntakeCommands>;
    const capture = (value: typeof model) => { model = value; };
    const adopt = () => undefined;
    await mount(client, capture, adopt);
    const unmountedIssue = model.issue;
    assert.ok(capturedExecutor);
    const executor = capturedExecutor;
    const count = executor.retainedAttempts().length;
    await mount(client, capture, adopt, ACTOR, 0, false);
    await act(async () => { unmountedIssue(FIXTURE_INTAKE_MAPPING, { type: "validate-intake" }, "validate"); });
    assert.equal(sent.length, 0);
    assert.equal(executor.retainedAttempts().length, count);
    await mount(client, capture, adopt);
    const replacedIssue = model.issue;
    await mount(client, capture, adopt, ACTOR, 1);
    await act(async () => { replacedIssue(FIXTURE_INTAKE_MAPPING, { type: "validate-intake" }, "validate"); });
    assert.equal(sent.length, 0);
    assert.equal(executor.retainedAttempts().length, count);
  });

  it("captured recovery callbacks cannot read receipts after unmount or view replacement", async () => {
    const sent: IntakeRequest[] = [];
    const client = clientFor(() => validated(), command => { sent.push(command); throw new Error("lost delivery"); });
    let model!: ReturnType<typeof useIntakeCommands>;
    const capture = (value: typeof model) => { model = value; };
    const adopt = () => undefined;
    await mount(client, capture, adopt);
    await act(async () => { model.issue(FIXTURE_INTAKE_MAPPING, { type: "validate-intake" }, "validate"); });
    assert.ok(model.recovery);
    assert.ok(capturedExecutor);
    const executor = capturedExecutor;
    const count = executor.retainedAttempts().length;
    const unmountedRecovery = model.recovery.retry;
    await mount(client, capture, adopt, ACTOR, 0, false);
    await act(async () => { unmountedRecovery(); });
    assert.equal(sent.length, 1);
    assert.equal(executor.retainedAttempts().length, count);
    await mount(client, capture, adopt);
    assert.ok(model.recovery);
    const replacedRecovery = model.recovery.retry;
    await mount(client, capture, adopt, ACTOR, 1);
    await act(async () => { replacedRecovery(); });
    assert.equal(sent.length, 1);
    assert.equal(executor.retainedAttempts().length, count);
  });

  it("refuses invalid composition before sending and uses binding actor and served time", async () => {
    const sent: IntakeRequest[] = [];
    const client = clientFor(() => validated(), command => { sent.push(command); return applied(command); });
    let model!: ReturnType<typeof useIntakeCommands>;
    await mount(client, value => { model = value; }, () => undefined);
    await act(async () => { model.issue(FIXTURE_INTAKE_MAPPING, { type: "confirm-intake-mapping", payload: { targetFieldId: "", sourceColumnId: "", headerFingerprint: "" } }, "bind"); });
    assert.equal(sent.length, 0);
    await act(async () => { model.issue(FIXTURE_INTAKE_MAPPING, { type: "validate-intake" }, "validate"); });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].requestedBy, ACTOR);
    assert.equal(sent[0].requestedAt, FIXTURE_BOOTSTRAP.serverClock.now);
  });
});
