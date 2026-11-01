import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { availableSections, buildRunDetail, buildRunSection, type RunDetailQueryDeps, type RunDetailWriteContractView } from "../../../../src/backend/runs/queries/run-detail.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { WriteIntentRecordSchema, deriveWriteBindingProofDigest, type WriteIntentRecord } from "../../../../src/rules/write-safety/write-safety.js";
import { FIXTURE_PARKED_WRITE } from "../../../support/fixtures/dashboard/fixture-day.js";
import { FIXTURE_PARKED_WRITE_INTENT } from "../../../support/fixtures/dashboard/run-detail/gates-park.js";
import { IDEMPOTENCY_KEY, IDEMPOTENCY_KEY_DIGEST, NOW, SUBJECT_PROOF, UNSCOPED_PROOF } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { queuedEventOf, runRecordOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const {world, RUN_ID, cleanup } = createRunDetailTestWorld(profileFixtures.create);

afterEach(cleanup);
const ITEM_ID = uuidOf(5001);
const INTENT_ID = uuidOf(11);
const ATTEMPT_ID = uuidOf(12);
const PARK_MESSAGE =
  "recovery probe is indeterminate for key 10101010|termination|2026-08-01: the results grid never rendered";

/** The proof, rebound to THIS run so the record is one production could produce. */
function proofFor(base: unknown): Record<string, unknown> {
  return { ...(base as Record<string, unknown>), runId: RUN_ID };
}

function parkedIntentOf(input?: Readonly<{
  generation?: number;
  proof?: unknown;
  status?: "parked" | "attempting";
}>) {
  const proof = proofFor(input?.proof ?? SUBJECT_PROOF);
  const status = input?.status ?? "parked";
  const intent = WriteIntentRecordSchema.parse({
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
      ? { status, parkedCode: "unknown", message: PARK_MESSAGE,
        authorityReason: deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", PARK_MESSAGE) }
      : { status }),
  });
  if (intent.status !== "parked" && intent.status !== "attempting") throw new Error("fixture intent is not fenced");
  return intent;
}

const PARKED_LIFECYCLE = {
  state: "parked-write",
  writeIntentId: INTENT_ID,
  intentGeneration: 1,
  parkedAt: NOW,
  code: "unknown",
  message: PARK_MESSAGE,
} as const;


function depsOf(w: DashboardWorld, writeContracts?: RunDetailWriteContractView[]): RunDetailQueryDeps {
  return { runReader: w.runReader, timeline: w.timeline,
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
    descriptors: {
      resolve: () => (writeContracts === undefined ? undefined : { details: [], writeContracts }),
    },
  };
}

const DESCRIBED_TERMINATION_PROOF: RunDetailWriteContractView = {
  commitTaskId: "ucpath/terminate-person",
  completionKind: "save-verify",
  proofSchemaHash: "c".repeat(64),
  proof: {
    state: "described",
    fields: [
      { kind: "fixed", path: "kind", value: "ucpath-termination" },
      { kind: "text", path: "transactionId", pattern: "^T\\d{6,}$", serverOnlyRules: false },
    ],
  },
};

/** Seed a run in the given lifecycle, with the intent authority holds for it. */
function seed(
  w: DashboardWorld,
  input?: Readonly<{ lifecycle?: unknown; intent?: WriteIntentRecord | null; version?: number }>,
): void {
  queuedEventOf(w, {
    seed: 1,
    enqueuedAt: NOW,
    version: input?.version ?? 4,
    lifecycle: input?.lifecycle ?? PARKED_LIFECYCLE,
  });
  const intent = input?.intent === undefined ? parkedIntentOf() : input.intent;
  if (intent !== null) w.authority.putWriteIntent(intent);
}

function parkedSection(w: DashboardWorld, writeContracts?: RunDetailWriteContractView[]) {
  const response = buildRunSection(depsOf(w, writeContracts), RUN_ID, "parked-write");
  if (response.section !== "parked-write") throw new Error("wrong section");
  return response.payload;
}

describe("the parked-write run-detail section (ref write-safety §4.1)", () => {
  it("serves the exact recorded parked event identity and leaves absent native evidence absent", async () => {
    const w = await world();
    const run = runRecordOf({ seed: 1 });
    const proof = { ...SUBJECT_PROOF, runId: RUN_ID, afterPrepareSpanPath: `${run.envelope.traceId}/termination/prepare` };
    seed(w, { intent: parkedIntentOf({ proof }) });
    assert.equal(parkedSection(w).native, undefined);
    const appended = w.timeline.append({ schemaVersion: 1, eventId: uuidOf(9801), workflow: "person-lookup",
      scope: { kind: "run", runId: RUN_ID }, occurredAt: NOW, recordedAt: NOW, retentionDate: "2026-07-31",
      source: { kind: "native" }, payload: { kind: "write-parked", workflow: "person-lookup", runId: RUN_ID,
        attempt: 1, traceId: run.envelope.traceId, nodeId: "termination", writeIntentId: INTENT_ID, generation: 1 } });
    assert.deepEqual(parkedSection(w).native, { eventId: appended.record.eventId, order: appended.record.cursor,
      runId: RUN_ID, attempt: 1, traceId: run.envelope.traceId, nodeId: "termination" });
  });

  it("advertises and serves the section with the durable intent's exact facts", async () => {
    const w = await world();
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
    assert.equal(payload.acceptsTransactionId, false, "missing canonical contract cannot accept a typed ID");
    assert.equal(payload.idempotencyKeyDigest, IDEMPOTENCY_KEY_DIGEST);
    assert.equal(payload.fencedAt, NOW);
    assert.equal(payload.parkedAt, NOW);
    assert.equal(payload.parkedCode, "unknown");
    assert.equal(payload.parkedMessage.includes(IDEMPOTENCY_KEY), false);
    assert.equal(payload.parkedMessage.includes("10101010"), false);
    assert.ok(payload.parkedMessage.includes(IDEMPOTENCY_KEY_DIGEST.slice(0, 12)));
  });

  it("serves the subject as the durable binding evidence, both proof kinds", async () => {
    const w = await world();
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

    const unscoped = await world();
    seed(unscoped, { intent: parkedIntentOf({ proof: UNSCOPED_PROOF }) });
    const other = parkedSection(unscoped).subject;
    assert.equal(other.state, "unscoped");
    if (other.state !== "unscoped") throw new Error("unreachable");
    // A no-subject commit names its reviewed reason and invents no subject.
    assert.equal(other.reviewedReasonId, "document-without-person-scope");
    assert.ok(!("evidence" in other));
  });

  it("leaks no direct identifier or permanent key into the served bytes", async () => {
    const w = await world();
    seed(w);
    const serialized = JSON.stringify(parkedSection(w));

    // Serve only a permanent-key digest; the natural key contains person identity.
    assert.ok(!serialized.includes(IDEMPOTENCY_KEY));
    assert.ok(!serialized.includes("10101010"));
    // The bounded display suffix is the ONLY person-derived text, and the
    // durable schema's own regex is what bounds it.
    assert.ok(serialized.includes('"displaySuffix":"1234"'));
    assert.ok(!serialized.includes("ucpathPassword"));
  });


  describe("the served proof contract", () => {
    it("serves the composition root's derived hash and field list verbatim", async () => {
      const w = await world();
      seed(w);
      const contract = parkedSection(w, [DESCRIBED_TERMINATION_PROOF]).proofContract;
      assert.equal(contract.state, "served");
      if (contract.state !== "served") throw new Error("unreachable");
      assert.equal(contract.commitTaskId, "ucpath/terminate-person");
      assert.equal(contract.completionKind, "save-verify");

      assert.equal(contract.schemaHash, "c".repeat(64));
      assert.deepEqual(contract.fields.map((field) => field.path), ["kind", "transactionId"]);
    });

    it("names the missing descriptor rather than serving a form for a workflow it cannot describe", async () => {
      const w = await world();
      seed(w);
      const contract = parkedSection(w).proofContract;
      assert.equal(contract.state, "unavailable");
      if (contract.state !== "unavailable") throw new Error("unreachable");
      assert.match(contract.reason, /person-lookup/);
      assert.match(contract.reason, /no registered descriptor/);

      assert.ok(parkedSection(w).actions.some((action) =>
        action.kind === "command" && action.command === "resolve-write-absent"));
    });

    it("names the missing transaction node when no contract commits this task", async () => {
      const w = await world();
      seed(w);
      const contract = parkedSection(w, [{
        ...DESCRIBED_TERMINATION_PROOF,
        commitTaskId: "ucpath/some-other-commit",
      }]).proofContract;
      assert.equal(contract.state, "unavailable");
      if (contract.state !== "unavailable") throw new Error("unreachable");
      assert.match(contract.reason, /ucpath\/terminate-person/);
      assert.match(contract.reason, /transaction-node/);
    });

    it("passes an undescribable proof's own reason through instead of guessing a shape", async () => {
      const w = await world();
      seed(w);
      const contract = parkedSection(w, [{
        ...DESCRIBED_TERMINATION_PROOF,
        proof: { state: "undescribable", reason: 'proof field "rows" is a zod "array"' },
      }]).proofContract;
      assert.equal(contract.state, "unavailable");
      if (contract.state !== "unavailable") throw new Error("unreachable");
      assert.match(contract.reason, /is a zod "array"/);
      assert.match(contract.reason, /will guess at a shape/);
    });
  });

  it("serves both typed resolutions, targeted at this exact intent generation", async () => {
    const w = await world();
    seed(w);
    const { actions } = parkedSection(w);

    assert.deepEqual(
      actions.map((action) => (action.kind === "command" ? action.command : action.kind)),
      ["recheck-write", "resolve-write-absent"],
    );
    for (const action of actions) {
      assert.equal(action.kind, "command");
      if (action.kind !== "command") throw new Error("unreachable");
      // The run version, because that is what both resolutions CAS against.
      assert.equal(action.expectedVersion, 4);
      assert.deepEqual(action.writeTarget, { writeIntentId: INTENT_ID, intentGeneration: 1,
        writeAttemptId: ATTEMPT_ID, occurrenceKeyDigest: IDEMPOTENCY_KEY_DIGEST,
        bindingProofDigest: parkedIntentOf().bindingProofDigest });
      // Neither may be one click: a found write resumes the run, and absence authorizes a resubmit.
      assert.ok(action.confirm !== undefined);
      assert.equal(action.confirm.tone, action.command === "recheck-write" ? "neutral" : "destructive");
    }
  });

  it("emits every binding the kernel's own command schema requires", async () => {
    const w = await world();
    seed(w);
    const action = parkedSection(w).actions[0];
    assert.ok(action !== undefined && action.kind === "command");
    if (action.kind !== "command" || action.writeTarget === undefined) throw new Error("unreachable");
    const { occurrenceKeyDigest, ...writeTarget } = action.writeTarget;


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
        ...writeTarget,
      },
      payload: { occurrenceKeyDigest },
    });
    assert.equal(command.family, "run");
    if (command.family !== "run" || command.type !== "recheck-write") throw new Error("unreachable");
    assert.equal(command.target.writeIntentId, INTENT_ID);
    assert.equal(command.target.intentGeneration, 1);
    assert.equal(command.target.expectedVersion, 4);
    assert.equal(command.target.writeAttemptId, ATTEMPT_ID);
    assert.equal(command.target.bindingProofDigest, parkedIntentOf().bindingProofDigest);
    assert.equal(command.payload.occurrenceKeyDigest, IDEMPOTENCY_KEY_DIGEST);
  });

  it("does not advertise or serve the section for a run that is not parked", async () => {
    for (const lifecycle of [
      { state: "queued" },
      { state: "parked-gate", parkedAt: NOW, gateId: "identity-approval", resumeAt: "probe" },
      { state: "terminal", outcome: "done", endedAt: NOW },
    ]) {
      const w = await world();
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

  it("refuses loudly when the park names an intent authority does not hold", async () => {
    const w = await world();
    seed(w, { intent: null });
    assert.throws(
      () => parkedSection(w),
      new RegExp(`run ${RUN_ID} is parked on write intent ${INTENT_ID}, which authority does not hold`),
    );
  });

  it("refuses loudly when the run park and the intent disagree", async () => {
    // The intent moved on — exactly the state a stale operator tab would try
    // to resolve. It is a contradiction in authority, never an empty panel.
    const advanced = await world();
    seed(advanced, { intent: parkedIntentOf({ generation: 2 }) });
    assert.throws(() => parkedSection(advanced), /is at generation 2/);

    const settled = await world();
    seed(settled, { intent: parkedIntentOf({ status: "attempting" }) });
    assert.throws(() => parkedSection(settled), /which is attempting/);
  });

  it("refuses loudly when the intent belongs to a different run", async () => {
    const w = await world();
    const foreign = WriteIntentRecordSchema.parse({
      ...parkedIntentOf(),
      runId: uuidOf(2),
      bindingProof: { ...SUBJECT_PROOF, runId: uuidOf(2) },
      bindingProofDigest: deriveWriteBindingProofDigest({ ...SUBJECT_PROOF, runId: uuidOf(2) }),
    });
    seed(w, { intent: foreign });
    assert.throws(() => parkedSection(w), /but that intent belongs to run/);
  });


  it("pins the parity fixture's safe message and resolution descriptors to this query", async () => {
    const w = await world();
    seed(w);
    const served = parkedSection(w);

    const normalize = (payload: typeof served | typeof FIXTURE_PARKED_WRITE, intent: WriteIntentRecord): unknown => {
      if (intent.status !== "parked") throw new Error("fixture intent is not parked");
      for (const action of payload.actions) {
        assert.equal(action.kind, "command");
        if (action.kind !== "command") throw new Error("unreachable");
        assert.deepEqual(action.writeTarget, { writeIntentId: intent.writeIntentId,
          intentGeneration: intent.generation, writeAttemptId: intent.currentAttemptId,
          occurrenceKeyDigest: intent.idempotencyKeyDigest, bindingProofDigest: intent.bindingProofDigest });
      }
      return (
      JSON.parse(
        JSON.stringify(payload.actions)
          .replaceAll(payload.writeIntentId, "<intent>")
          .replaceAll(intent.currentAttemptId, "<attempt>")
          .replaceAll(intent.idempotencyKeyDigest, "<occurrence>")
          .replaceAll(intent.bindingProofDigest, "<binding>")
          // Compare adapter shapes at their own row versions; pinning one version would confuse fixtures with schema.
          .replaceAll(/"expectedVersion":\d+/gu, '"expectedVersion":0'),
      ) as unknown);
    };

    const normalizeMessage = (payload: {
      writeIntentId: string;
      idempotencyKeyDigest: string;
      parkedMessage: string;
    }): string => payload.parkedMessage
      .replace(payload.writeIntentId, "<intent>")
      .replace(payload.idempotencyKeyDigest.slice(0, 12), "<digest>");

    assert.equal(normalizeMessage(FIXTURE_PARKED_WRITE), normalizeMessage(served));
    assert.deepEqual(normalize(FIXTURE_PARKED_WRITE, FIXTURE_PARKED_WRITE_INTENT), normalize(served, parkedIntentOf()));
  });

  it("re-reads the intent per request rather than folding it into the projection", async () => {
    const w = await world();
    seed(w);
    assert.equal(parkedSection(w).generation, 1);


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
