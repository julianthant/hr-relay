/**
 * The parked-write run-detail section (doc 09 §4.1, doc 13 §3.3/§8.5).
 *
 * A `parked-write` run is the one lifecycle the kernel refuses generic retry
 * for BY NAME, so until this section existed the operator's only rendering of
 * it was a generic `blocked` row with two implemented, tested and unreachable
 * resolutions behind it. Everything asserted here is a durable fact re-read
 * from write-safety authority at request time.
 *
 * The kernel's own refusals — stale run version, stale intent generation, a
 * non-parked run — are pinned by `parked-write-round-trip.test.ts` against a
 * real `AuthorityDatabase`; this suite pins the half that had no coverage at
 * all: that the section is served exactly when the run is parked, that its
 * served descriptors carry a target the command schema accepts unchanged, and
 * that every way authority can disagree with itself here FAILS LOUD rather
 * than rendering an empty panel over a real HR write.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { CommandRequestSchema } from "../../../src/domain/commands.js";
import {
  WriteIntentRecordSchema,
  deriveWriteBindingProofDigest,
  type WriteIntentRecord,
} from "../../../src/domain/write-safety.js";
import {
  availableSections,
  buildRunDetail,
  buildRunSection,
  type RunDetailQueryDeps,
} from "../../../src/server/dashboard/queries/run-detail.js";
import {
  IDEMPOTENCY_KEY,
  IDEMPOTENCY_KEY_DIGEST,
  NOW,
  SUBJECT_PROOF,
  UNSCOPED_PROOF,
} from "../fixtures/phase1c-contract-fixtures.js";
import {
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

const RUN_ID = uuidOf(1);
const ITEM_ID = uuidOf(5001);
const INTENT_ID = uuidOf(11);
const ATTEMPT_ID = uuidOf(12);
const PARK_MESSAGE =
  "recovery probe is indeterminate for key 10001573|termination|2026-08-01: the results grid never rendered";

/** The proof, rebound to THIS run so the record is one production could produce. */
function proofFor(base: unknown): Record<string, unknown> {
  return { ...(base as Record<string, unknown>), runId: RUN_ID };
}

function parkedIntentOf(input?: Readonly<{
  generation?: number;
  proof?: unknown;
  status?: "parked" | "attempting";
}>): WriteIntentRecord {
  const proof = proofFor(input?.proof ?? SUBJECT_PROOF);
  const status = input?.status ?? "parked";
  return WriteIntentRecordSchema.parse({
    writeIntentId: INTENT_ID,
    workflowId: "person-lookup",
    itemId: ITEM_ID,
    taskId: "ucpath/terminate-person",
    system: "ucpath",
    idempotencyKey: IDEMPOTENCY_KEY,
    idempotencyKeyDigest: IDEMPOTENCY_KEY_DIGEST,
    currentAttemptId: ATTEMPT_ID,
    generation: input?.generation ?? 1,
    runId: RUN_ID,
    runAttempt: 1,
    bindingProof: proof,
    bindingProofDigest: deriveWriteBindingProofDigest(proof),
    fencedAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...(status === "parked"
      ? { status, parkedCode: "unknown", message: PARK_MESSAGE }
      : { status }),
  });
}

const PARKED_LIFECYCLE = {
  state: "parked-write",
  writeIntentId: INTENT_ID,
  intentGeneration: 1,
  parkedAt: NOW,
  code: "unknown",
  message: PARK_MESSAGE,
} as const;

function depsOf(w: DashboardWorld): RunDetailQueryDeps {
  return {
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
    descriptors: { resolve: () => undefined },
  };
}

/** Seed a run in the given lifecycle, with the intent authority holds for it. */
function seed(
  w: DashboardWorld,
  input?: Readonly<{ lifecycle?: unknown; intent?: WriteIntentRecord | null; version?: number }>,
): void {
  queuedEventOf(w, {
    seed: 1,
    version: input?.version ?? 4,
    lifecycle: input?.lifecycle ?? PARKED_LIFECYCLE,
  });
  const intent = input?.intent === undefined ? parkedIntentOf() : input.intent;
  if (intent !== null) w.authority.putWriteIntent(intent);
}

function parkedSection(w: DashboardWorld) {
  const response = buildRunSection(depsOf(w), RUN_ID, "parked-write");
  if (response.section !== "parked-write") throw new Error("wrong section");
  return response.payload;
}

describe("the parked-write run-detail section (doc 09 §4.1)", () => {
  it("advertises and serves the section with the durable intent's exact facts", () => {
    const w = world();
    seed(w);

    const detail = buildRunDetail(depsOf(w), RUN_ID);
    assert.ok(detail.availableSections.includes("parked-write"));
    // The coarse queue status is unchanged — `blocked` is still what the row
    // says; the section is what makes the park addressable.
    assert.equal(detail.header.status, "blocked");

    const payload = parkedSection(w);
    assert.equal(payload.runId, RUN_ID);
    assert.equal(payload.writeIntentId, INTENT_ID);
    assert.equal(payload.generation, 1);
    assert.equal(payload.runAttempt, 1);
    assert.equal(payload.system, "ucpath");
    assert.equal(payload.taskId, "ucpath/terminate-person");
    assert.equal(payload.idempotencyKeyDigest, IDEMPOTENCY_KEY_DIGEST);
    assert.equal(payload.fencedAt, NOW);
    assert.equal(payload.parkedAt, NOW);
    assert.equal(payload.parkedCode, "unknown");
    assert.equal(payload.parkedMessage, PARK_MESSAGE);
  });

  it("serves the subject as the durable binding evidence, both proof kinds", () => {
    const w = world();
    seed(w);
    const subject = parkedSection(w).subject;
    assert.equal(subject.state, "subject-match");
    if (subject.state !== "subject-match") throw new Error("unreachable");
    assert.equal(subject.proofId, SUBJECT_PROOF.proofId);
    assert.equal(subject.observedAt, NOW);
    // Copied, not re-shaped: the digest that makes it checkable survives.
    assert.deepEqual(subject.evidence, {
      kind: "person",
      identifierKind: "eid",
      bindingDigest: "a".repeat(64),
      displaySuffix: "1234",
    });

    const unscoped = world();
    seed(unscoped, { intent: parkedIntentOf({ proof: UNSCOPED_PROOF }) });
    const other = parkedSection(unscoped).subject;
    assert.equal(other.state, "unscoped");
    if (other.state !== "unscoped") throw new Error("unreachable");
    // A no-subject commit names its reviewed reason and invents no subject.
    assert.equal(other.reviewedReasonId, "document-without-person-scope");
    assert.ok(!("evidence" in other));
  });

  it("leaks no direct identifier or permanent key into the served bytes", () => {
    const w = world();
    seed(w);
    const serialized = JSON.stringify(parkedSection(w));

    // The permanent write key embeds the person's EID; only its digest may be
    // served. The park MESSAGE is the one place the key can legitimately reach
    // a surface, so the check is scoped to the fields a projection controls.
    const { parkedMessage, ...projected } = parkedSection(w);
    assert.ok(parkedMessage.length > 0);
    const projectedBytes = JSON.stringify(projected);
    assert.ok(!projectedBytes.includes(IDEMPOTENCY_KEY));
    assert.ok(!projectedBytes.includes("10001573"));
    // The bounded display suffix is the ONLY person-derived text, and the
    // durable schema's own regex is what bounds it.
    assert.ok(serialized.includes('"displaySuffix":"1234"'));
    assert.ok(!serialized.includes("ucpathPassword"));
  });

  it("serves both typed resolutions, targeted at this exact intent generation", () => {
    const w = world();
    seed(w);
    const { actions } = parkedSection(w);

    assert.deepEqual(
      actions.map((action) => (action.kind === "command" ? action.command : action.kind)),
      ["resolve-write-present", "resolve-write-absent"],
    );
    for (const action of actions) {
      assert.equal(action.kind, "command");
      if (action.kind !== "command") throw new Error("unreachable");
      // The run version, because that is what both resolutions CAS against.
      assert.equal(action.expectedVersion, 4);
      assert.deepEqual(action.writeTarget, { writeIntentId: INTENT_ID, intentGeneration: 1 });
      // Neither resolution may be one click: both settle a real HR write.
      assert.ok(action.confirm !== undefined);
      assert.equal(action.confirm.tone, "destructive");
    }
  });

  it("emits a target the kernel's own command schema accepts unchanged", () => {
    const w = world();
    seed(w);
    const action = parkedSection(w).actions[0];
    assert.ok(action !== undefined && action.kind === "command");
    if (action.kind !== "command" || action.writeTarget === undefined) throw new Error("unreachable");

    // The route parses exactly this schema before the kernel sees anything, so
    // a descriptor that cannot round-trip through it describes a control that
    // could never be sent.
    const command = CommandRequestSchema.parse({
      commandId: uuidOf(31),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: action.command,
      target: {
        runId: RUN_ID,
        expectedVersion: action.expectedVersion,
        writeIntentId: action.writeTarget.writeIntentId,
        intentGeneration: action.writeTarget.intentGeneration,
      },
      payload: { proof: { schemaHash: "a".repeat(64), value: "receipt-123" }, evidenceNote: "confirmed in UCPath" },
    });
    assert.equal(command.family, "run");
    if (command.family !== "run" || command.type !== "resolve-write-present") throw new Error("unreachable");
    assert.equal(command.target.writeIntentId, INTENT_ID);
    assert.equal(command.target.intentGeneration, 1);
    assert.equal(command.target.expectedVersion, 4);
  });

  it("does not advertise or serve the section for a run that is not parked", () => {
    for (const lifecycle of [
      { state: "queued" },
      { state: "parked-gate", parkedAt: NOW, gateId: "identity-approval", resumeAt: "probe" },
      { state: "terminal", outcome: "done", endedAt: NOW },
    ]) {
      const w = world();
      seed(w, { lifecycle, intent: null });
      const record = w.authority.getRun(RUN_ID);
      assert.ok(record);
      const row = w.projection.runFold(RUN_ID);
      assert.ok(row);
      assert.ok(!availableSections(row, record).includes("parked-write"));
      assert.throws(
        () => buildRunSection(depsOf(w), RUN_ID, "parked-write"),
        /is not available for run/,
      );
    }
  });

  it("refuses loudly when the park names an intent authority does not hold", () => {
    const w = world();
    seed(w, { intent: null });
    assert.throws(
      () => parkedSection(w),
      new RegExp(`run ${RUN_ID} is parked on write intent ${INTENT_ID}, which authority does not hold`),
    );
  });

  it("refuses loudly when the run park and the intent disagree", () => {
    // The intent moved on — exactly the state a stale operator tab would try
    // to resolve. It is a contradiction in authority, never an empty panel.
    const advanced = world();
    seed(advanced, { intent: parkedIntentOf({ generation: 2 }) });
    assert.throws(() => parkedSection(advanced), /is at generation 2/);

    const settled = world();
    seed(settled, { intent: parkedIntentOf({ status: "attempting" }) });
    assert.throws(() => parkedSection(settled), /which is attempting/);
  });

  it("refuses loudly when the intent belongs to a different run", () => {
    const w = world();
    const foreign = WriteIntentRecordSchema.parse({
      ...parkedIntentOf(),
      runId: uuidOf(2),
      bindingProof: { ...SUBJECT_PROOF, runId: uuidOf(2) },
      bindingProofDigest: deriveWriteBindingProofDigest({ ...SUBJECT_PROOF, runId: uuidOf(2) }),
    });
    seed(w, { intent: foreign });
    assert.throws(() => parkedSection(w), /but that intent belongs to run/);
  });

  it("re-reads the intent per request rather than folding it into the projection", () => {
    const w = world();
    seed(w);
    assert.equal(parkedSection(w).generation, 1);

    // The same query, the same projection row, a moved authority row: the
    // section must report the CHANGE, because a resolution built from a cached
    // generation would settle a write nobody is looking at.
    w.authority.putWriteIntent(parkedIntentOf({ generation: 2 }));
    assert.throws(() => parkedSection(w), /is at generation 2/);

    w.authority.put(runRecordOf({
      seed: 1,
      version: 5,
      lifecycle: { ...PARKED_LIFECYCLE, intentGeneration: 2 },
    }));
    const payload = parkedSection(w);
    assert.equal(payload.generation, 2);
    assert.ok(payload.actions.every((action) => action.kind === "command" && action.expectedVersion === 5));
  });
});
