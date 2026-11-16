import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { onboardingModule, separationsDescriptor } from '../../../support/helpers/registered-workflows.js';
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { notificationDisplayContext } from "../../../../src/backend/runs/queries/notification-display.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { NotificationRecordSchema, type NotificationRecord } from "../../../../src/models/notifications/notifications.js";
import { ONBOARDING_INPUT_EXAMPLE } from "../../../../src/models/workflows/onboarding/input.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { HASH_A as HASH_A_INPUT, HASH_B as HASH_B_INPUT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { makeWorld, notificationRecordOf, queuedEventOf, runRecordOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const HASH_A = FingerprintSchema.parse(HASH_A_INPUT), HASH_B = FingerprintSchema.parse(HASH_B_INPUT);
const worlds: DashboardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.dispose(); });

const run = runRecordOf({ seed: 1, workflow: separationsDescriptor.id, attempt: 2, claimGeneration: 1, lifecycle: { state: "terminal", outcome: "failed", failureId: "22222222-2222-4222-8222-222222222222", endedAt: "2026-10-02T17:00:00.000Z" } });
const row = notificationRecordOf({ seed: 1, title: "Run failed", lastSeenAt: "2026-10-02T17:00:00.000Z" });
const checkpoint = (overrides: Record<string, unknown> = {}) => RunCheckpointRecordSchema.parse({
  workflowId: run.envelope.workflow, itemId: run.envelope.itemId, nodeId: "identify", attempt: 2,
  claimGeneration: 1, runId: run.envelope.runId, output: { schemaHash: HASH_A, value: { person: { name: "Alice" } } },
  descriptorVersion: 1, contractFingerprint: HASH_A, implFingerprint: HASH_B, provenance: [],
  writtenAt: "2026-10-02T16:59:00.000Z", ...overrides,
});
const descriptor = { ...separationsDescriptor, version: run.envelope.descriptorVersion, label: "Person lookup", contractFingerprint: HASH_A, subjectProjection: { nodeId: "identify", fieldPath: "person.name" } };
const deps = async (records: ReturnType<typeof checkpoint>[], current = descriptor, world?: DashboardWorld) => {
  const owned = world ?? await makeWorld();
  if (world === undefined) worlds.push(owned);
  return {
    read: () => ({ state: "present" as const, disposition: "live" as const, run }),
    descriptor: () => current,
    receipt: () => undefined,
    checkpoints: { listByAttempt: () => records },
    presentation: { timeline: owned.timeline, authority: { listCheckpoints: () => records, listGateResults: () => [] } },
    command: () => undefined,
  };
};

it("uses only the linked run's compatible declared subject checkpoint", async () => {
  const world = await makeWorld();
  worlds.push(world);
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint(), checkpoint({ runId: "33333333-3333-4333-8333-333333333333", output: { schemaHash: HASH_A, value: { person: { name: "Other" } } } })], descriptor, world)),
    { state: "available", workflow: "Person lookup", subject: "Alice" });
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint({ attempt: 3, output: { schemaHash: HASH_A, value: { person: { name: "Later" } } } })], descriptor, world)), { state: "workflow-only", workflow: "Person lookup" });
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint({ contractFingerprint: HASH_B })], descriptor, world)), { state: "workflow-only", workflow: "Person lookup" });
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint()], { ...descriptor, contractFingerprint: HASH_B }, world)), { state: "unavailable" });
  assert.deepEqual(notificationDisplayContext(row, await deps([], descriptor, world)), { state: "workflow-only", workflow: "Person lookup" });
});

it("does not reconstruct absent run context", async () => {
  const regular = await deps([checkpoint()]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, read: () => ({ state: "absent", runId: run.envelope.runId }) }), { state: "unavailable" });
});

it("withholds a future execution subject", async () => {
  const future = checkpoint({ claimGeneration: run.claimGeneration + 1, output: { schemaHash: HASH_A, value: { person: { name: "Future" } } } });
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint(), future])), { state: "available", workflow: "Person lookup", subject: "Alice" });
  assert.deepEqual(notificationDisplayContext(row, await deps([future])), { state: "workflow-only", workflow: "Person lookup" });
});

it("displays an older run's exact subject after a structurally compatible workflow fingerprint change", async () => {
  const current = { ...descriptor, contractFingerprint: HASH_B,
    timeline: [{ key: "identity", label: "Current identity", nodes: [{ id: "identify", label: "Current identify" }] }] };
  const retained = checkpoint();
  const unrelated = checkpoint({ runId: "33333333-3333-4333-8333-333333333333",
    output: { schemaHash: HASH_A, value: { person: { name: "Other" } } } });
  const regular = await deps([retained, unrelated]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, descriptor: () => current }),
    { state: "available", workflow: "Person lookup", subject: "Alice" });
});

it.each([HASH_A, HASH_B])("withholds notification display when the run's checkpoint node is absent from the live timeline (%s)", async fingerprint => {
  const current = { ...descriptor, version: descriptor.version + 1, contractFingerprint: fingerprint,
    timeline: [{ key: "replacement", label: "Replacement", nodes: [{ id: "replacement", label: "Replacement" }] }] };
  const regular = await deps([checkpoint()]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, descriptor: () => current }), { state: "unavailable" });
});

it("propagates evidence read failures instead of treating corruption as incompatible presentation", async () => {
  const current = { ...descriptor, version: descriptor.version + 1, timeline: [{ key: "identity", label: "Identity", nodes: [{ id: "identify", label: "Identify" }] }] };
  const regular = await deps([checkpoint()]);
  const failure = new Error("synthetic checkpoint read failure");
  assert.throws(() => notificationDisplayContext(row, { ...regular, descriptor: () => current,
    presentation: { ...regular.presentation, authority: { ...regular.presentation.authority, listCheckpoints: () => { throw failure; } } },
  }), error => error === failure);
});

it("does no compatibility evidence reads for a current-version notification while retaining its declared subject read", async () => {
  const regular = await deps([checkpoint()]);
  const current = { ...descriptor, timeline: [{ key: "replacement", label: "Replacement", nodes: [{ id: "replacement", label: "Replacement" }] }] };
  let compatibilityCheckpointReads = 0;
  let timelineReads = 0;
  let subjectReads = 0;
  const display = notificationDisplayContext(row, { ...regular, descriptor: () => current,
    checkpoints: { listByAttempt: () => { subjectReads++; return [checkpoint()]; } },
    presentation: {
      timeline: { ...regular.presentation.timeline, page(input) { timelineReads++; return regular.presentation.timeline.page(input); } },
      authority: { ...regular.presentation.authority, listCheckpoints: () => { compatibilityCheckpointReads++; return []; } },
    },
  });
  assert.deepEqual(display, { state: "available", workflow: "Person lookup", subject: "Alice" });
  assert.equal(compatibilityCheckpointReads, 0);
  assert.equal(timelineReads, 0);
  assert.equal(subjectReads, 1);
});

it("withholds a version-only older notification with an unmapped checkpoint node", async () => {
  const regular = await deps([checkpoint()]);
  const current = { ...descriptor, version: descriptor.version + 1,
    timeline: [{ key: "replacement", label: "Replacement", nodes: [{ id: "replacement", label: "Replacement" }] }] };
  assert.deepEqual(notificationDisplayContext(row, { ...regular, descriptor: () => current }), { state: "unavailable" });
});

it("resolves command notices that target a run the way that run resolves, and a batch as not applicable", async () => {
  const regular = await deps([checkpoint()]);
  const request = CommandRequestSchema.parse({
    commandId: "11111111-1111-4111-8111-111111111111", requestedAt: "2026-10-02T17:00:00.000Z",
    requestedBy: "local-operator", source: "dashboard", family: "run", type: "retry",
    target: { runId: run.envelope.runId, expectedVersion: 1 },
  });
  const resolved = { ...regular, command: () => request };
  const runContext = notificationDisplayContext(row, resolved);
  for (const kind of ["recovery", "command-result"] as const) {
    assert.deepEqual(notificationDisplayContext({ ...row, trigger: "command", links: [{ kind, commandId: request.commandId }] }, resolved), runContext);
  }
  assert.deepEqual(notificationDisplayContext({ ...row, trigger: "command", links: [{ kind: "bulk-result", bulkCommandId: request.commandId }] }, regular), { state: "not-applicable" });
  assert.deepEqual(notificationDisplayContext({ ...row, trigger: "command", links: [{ kind: "recovery", commandId: request.commandId }] }, regular), { state: "unavailable" });
});

const onboarding = onboardingModule.descriptor;
const FAILED = { state: "terminal", outcome: "failed", failureId: "44444444-4444-4444-8444-444444444444", endedAt: "2026-10-02T17:00:00.000Z" } as const;
const onboardingRun = (overrides: Record<string, unknown> = {}, schemaHash = deriveSchemaHash(onboarding.canonicalInput, "output")) => RunRecordSchema.parse({
  ...runRecordOf({ seed: 4, workflow: onboarding.id, descriptor: onboarding, lifecycle: FAILED }),
  input: { raw: { email: ONBOARDING_INPUT_EXAMPLE.email }, ingressSchemaHash: HASH_A,
    parsed: { schemaHash, protectedBindings: [], value: ONBOARDING_INPUT_EXAMPLE } },
  ...overrides,
});
/** Display deps over a world whose timeline holds the run's `run.queued` with `queuedTitle`, or none when it is omitted. */
const queuedDeps = async (current: ReturnType<typeof onboardingRun>, workflow: AnyWorkflowDescriptor, seed: number, queuedTitle?: string) => {
  const world = await makeWorld();
  worlds.push(world);
  if (queuedTitle !== undefined) queuedEventOf(world, { seed, workflow: workflow.id, descriptor: workflow, title: queuedTitle });
  return { ...await deps([], descriptor, world), read: () => ({ state: "present" as const, disposition: "live" as const, run: current }), descriptor: () => workflow };
};
const notice = (trigger: NotificationRecord["trigger"], links: readonly unknown[]) => NotificationRecordSchema.parse({
  ...notificationRecordOf({ seed: 4, title: "Notice", lastSeenAt: "2026-10-02T17:00:00.000Z" }),
  trigger, channel: trigger === "verified-done" ? "inbox" : "ping", links,
});
const runLink = (current: ReturnType<typeof onboardingRun>) => ({ kind: "run" as const, runId: current.envelope.runId });
const failureLink = (current: ReturnType<typeof onboardingRun>) => ({ kind: "failure" as const, runId: current.envelope.runId, failureId: FAILED.failureId });
const QUEUED_TITLE = "Spring roster row 12";
const OWN_TITLE = { state: "available", workflow: "Onboarding", subject: QUEUED_TITLE } as const;

it.each([
  ["failed", failureLink], ["gate-waiting", runLink], ["write-parked", runLink], ["repeating", failureLink], ["verified-done", runLink],
] as const)("names the run by its queued title on a %s notice for a workflow that declares no subject", async (trigger, link) => {
  const current = onboardingRun();
  assert.deepEqual(notificationDisplayContext(notice(trigger, [link(current)]), await queuedDeps(current, onboarding, 4, QUEUED_TITLE)), OWN_TITLE);
});

it.each(["recovery", "command-result"] as const)("names the target run by its queued title on a %s command notice", async kind => {
  const current = onboardingRun();
  const request = CommandRequestSchema.parse({
    commandId: "11111111-1111-4111-8111-111111111111", requestedAt: "2026-10-02T17:00:00.000Z",
    requestedBy: "local-operator", source: "dashboard", family: "run", type: "retry",
    target: { runId: current.envelope.runId, expectedVersion: 1 },
  });
  const display = notificationDisplayContext(notice("command", [{ kind, commandId: request.commandId }]), { ...await queuedDeps(current, onboarding, 4, QUEUED_TITLE), command: () => request });
  assert.deepEqual(display, OWN_TITLE);
});

it("shows the title the run was queued under, not one today's presentation would derive from its input", async () => {
  const current = onboardingRun();
  const display = notificationDisplayContext(notice("failed", [failureLink(current)]), await queuedDeps(current, onboarding, 4, QUEUED_TITLE));
  assert.deepEqual(display, OWN_TITLE);
  assert.ok(display.state === "available" && !display.subject.includes(ONBOARDING_INPUT_EXAMPLE.email));
});

it("names a run admitted under an older input schema by its queued title without parsing its input", async () => {
  const historical = onboardingRun({}, HASH_B);
  assert.deepEqual(notificationDisplayContext(notice("failed", [failureLink(historical)]), await queuedDeps(historical, onboarding, 4, QUEUED_TITLE)), OWN_TITLE);
});

it("keeps workflow-only when the run's queued event is no longer retained", async () => {
  const current = onboardingRun();
  assert.deepEqual(notificationDisplayContext(notice("failed", [failureLink(current)]), await queuedDeps(current, onboarding, 4)), { state: "workflow-only", workflow: "Onboarding" });
});

const TIMEKEEPER = { kind: "profile", inputPath: "timekeeperName", name: "timekeeperName", profileId: "66666666-6666-4666-8666-666666666666", sessionEpoch: 1 };
const separationRun = (overrides: Record<string, unknown> = {}, bindings: unknown[] = [TIMEKEEPER]) => RunRecordSchema.parse({
  ...runRecordOf({ seed: 5, workflow: separationsDescriptor.id, descriptor: separationsDescriptor, lifecycle: FAILED }),
  input: { raw: { documentNumber: "4510" }, ingressSchemaHash: HASH_A, parsed: { schemaHash: deriveSchemaHash(separationsDescriptor.canonicalInput, "output"), protectedBindings: bindings,
    value: { documentNumber: "4510", timekeeperName: "Synthetic Timekeeper", searchTimeoutMs: 30_000 } } },
  ...overrides,
});

it("names a run whose declared subject checkpoint was never written by its queued title", async () => {
  const current = separationRun();
  assert.deepEqual(notificationDisplayContext(notice("failed", [failureLink(current)]), await queuedDeps(current, separationsDescriptor, 5, "Separation 4510")),
    { state: "available", workflow: separationsDescriptor.label, subject: "Separation 4510" });
});

it("prefers the operator's name for the run", async () => {
  const current = onboardingRun({ displayName: "Spring hire" });
  assert.deepEqual(notificationDisplayContext(notice("failed", [failureLink(current)]), await queuedDeps(current, onboarding, 4, QUEUED_TITLE)), { ...OWN_TITLE, subject: "Spring hire" });
});

it("names a protected-subject run only by its queued title, never its operator name", async () => {
  const current = separationRun({ displayName: "Canary separation" }, [TIMEKEEPER,
    { kind: "test-data-local", inputPath: "documentNumber", name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: "55555555-5555-4555-8555-555555555555" }]);
  assert.deepEqual(notificationDisplayContext(notice("failed", [failureLink(current)]), await queuedDeps(current, separationsDescriptor, 5, "Protected test subject")),
    { state: "available", workflow: separationsDescriptor.label, subject: "Protected test subject" });
});

it("reads as unavailable when the notice's source is truly gone", async () => {
  const current = onboardingRun();
  const regular = await queuedDeps(current, onboarding, 4, QUEUED_TITLE);
  assert.deepEqual(notificationDisplayContext(notice("failed", [failureLink(current)]), { ...regular, read: () => ({ state: "absent", runId: current.envelope.runId }) }), { state: "unavailable" });
  assert.deepEqual(notificationDisplayContext(notice("failed", [failureLink(current)]), { ...regular, descriptor: () => undefined }), { state: "unavailable" });
  assert.deepEqual(notificationDisplayContext(notice("command", [{ kind: "command-result", commandId: "11111111-1111-4111-8111-111111111111" }]), regular), { state: "unavailable" });
});
