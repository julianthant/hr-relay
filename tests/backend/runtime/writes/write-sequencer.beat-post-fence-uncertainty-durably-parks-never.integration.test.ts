import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { WriteParkedError } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { absentProbeEvidence, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";

const {harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();

afterEach(cleanup);

describe("beat ⑤/⑥ — post-fence uncertainty durably parks (never done, never silent)", () => {

  it("retains a parent-aborted transaction lease until its non-cooperative commit callback settles", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    let releaseCallback = (): void => undefined;
    const callbackMaySettle = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    let reportCallbackInFlight = (): void => undefined;
    const callbackInFlight = new Promise<void>((resolve) => {
      reportCallbackInFlight = resolve;
    });
    h.world.afterCommitClickBeforeTaskSettlement = async () => {
      reportCallbackInFlight();
      await callbackMaySettle;
    };
    const parent = new AbortController();
    const parentFailure = new Error("operator cancelled while the external callback was in flight");
    let executionSettled = false;
    const execution = h.execute({
      ...contextFor(run, claim),
      signal: parent.signal,
    }).then(
      (value) => ({ state: "fulfilled" as const, value }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    ).finally(() => {
      executionSettled = true;
    });

    await callbackInFlight;
    parent.abort(parentFailure);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      h.emitter.events()
        .filter((event) => event.spanPath.endsWith("/commit"))
        .map((event) => event.t),
      ["span.started"],
      "parent abort cannot flush the commit lane before callback settlement",
    );
    assert.equal(intentByKey(h.database)?.status, "attempting");
    assert.deepEqual(h.sessions.closeReasons(), [], "the retained transaction session remains open");
    assert.equal(executionSettled, false, "the fenced execution remains owned while its callback is in flight");
    assert.deepEqual(h.scheduler.pending(), [], "parent-first cancellation cancels the later task deadline");

    releaseCallback();
    const outcome = await execution;
    assert.equal(outcome.state, "rejected");
    if (outcome.state !== "rejected") return;
    assert.ok(outcome.error instanceof WriteParkedError);
    assert.match(outcome.error.message, /operator cancelled while the external callback was in flight/u);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"], "post-settlement failure poisons exactly once");
  });

  it("keeps a deadline failure primary when parent abort follows during retained callback settlement", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    let releaseCallback = (): void => undefined;
    const callbackMaySettle = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    let reportCallbackInFlight = (): void => undefined;
    const callbackInFlight = new Promise<void>((resolve) => {
      reportCallbackInFlight = resolve;
    });
    h.world.afterCommitClickBeforeTaskSettlement = async () => {
      reportCallbackInFlight();
      await callbackMaySettle;
    };
    const parent = new AbortController();
    const parentFailure = new Error("parent abort followed the commit deadline");
    const execution = h.execute({
      ...contextFor(run, claim),
      signal: parent.signal,
    }).then(
      (value) => ({ state: "fulfilled" as const, value }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    );

    await callbackInFlight;
    const [commitDeadline] = h.scheduler.pending();
    assert.ok(commitDeadline);
    commitDeadline.fire();
    await new Promise((resolve) => setImmediate(resolve));
    parent.abort(parentFailure);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      h.emitter.events()
        .filter((event) => event.spanPath.endsWith("/commit"))
        .map((event) => event.t),
      ["span.started"],
    );
    assert.equal(intentByKey(h.database)?.status, "attempting");
    assert.deepEqual(h.sessions.closeReasons(), []);

    releaseCallback();
    const outcome = await execution;
    assert.equal(outcome.state, "rejected");
    if (outcome.state !== "rejected") return;
    assert.ok(outcome.error instanceof WriteParkedError);
    assert.ok(outcome.error.cause instanceof Error);
    assert.ok(outcome.error.cause.cause instanceof AggregateError);
    const [deadlineFailure, retainedParentFailure] = z.array(z.unknown()).parse(
      outcome.error.cause.cause.errors,
    );
    assert.ok(deadlineFailure instanceof Error);
    assert.match(deadlineFailure.message, /exceeded its immutable 60000ms task deadline/u);
    assert.equal(retainedParentFailure, parentFailure);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });

  it("parks by task and field when a buffered commit observation is undeclared", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.recordUndeclaredCommitField = true;

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError
        && /ucpath\/submit-write-fixture.*undeclaredCommitField/u.test(error.message),
    );

    assert.ok(h.world.events.includes("commit-click:ucpath.write-fixture.save-submit"));
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(JSON.stringify(h.emitter.events()).includes("RAW_UNDECLARED_COMMIT"), false);
  });

  it("parks with the commit error first when post-settlement fence emission also throws", async () => {
    const h = await harness({ emitterThrowsOn: "transaction.fenced" });
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitThrows = new Error("PRIMARY_COMMIT_TASK_FAILURE");

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError);
        assert.match(error.message, /PRIMARY_COMMIT_TASK_FAILURE/u);
        assert.ok(error.cause instanceof Error);
        assert.ok(error.cause.cause instanceof AggregateError);
        assert.equal(error.cause.cause.cause, h.world.commitThrows);
        assert.deepEqual(
          error.cause.cause.errors.map((entry: unknown) => entry instanceof Error ? entry.message : String(entry)),
          ["PRIMARY_COMMIT_TASK_FAILURE", "injected transaction.fenced writer failure"],
        );
        return true;
      },
    );

    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(
      h.database.authority.runCheckpoints.latest(
        WRITE_FIXTURE_WORKFLOW_ID,
        WRITE_FIXTURE_ITEM_ID,
        WRITE_FIXTURE_NODE_ID,
      ),
      undefined,
      "a dual failure never reports a committed side effect",
    );
  });

  it("parks intent and run when the commit impl throws after the fence", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitThrows = new Error("browser crashed mid-click");
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "parked");
    assert.equal(intent.parkedCode, "unknown");
    assert.equal(intent.authorityReason?.code, "post-fence-commit-exception");
    assert.equal(intent.authorityReason?.evidence.kind, "exception");
    assert.match(intent.authorityReason?.evidence.digest ?? "", /^[a-f0-9]{64}$/u);
    const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(current && current.lifecycle.state === "parked-write");
    assert.equal(current.lifecycle.writeIntentId, intent.writeIntentId);
    assert.equal(current.lifecycle.intentGeneration, 1);
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });

  it("parks when the receipt fails its proof schema — clicked, cannot prove it landed", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitOutput = { transactionId: "" };
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "parked");
    assert.equal(intent.authorityReason?.code, "commit-output-schema-failure");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("save-verify: a present read-back commits; an absent read-back parks", async () => {
    const h = await harness();
    const first = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    const outcome = await h.execute(
      contextFor(first.run, first.claim, writeFixtureSaveDescriptor),
    );
    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T222222" },
    });
    assert.ok(h.world.events.includes("verify"));

    const h2 = await harness();
    const second = claimRunning(h2.database, h2.clock);
    h2.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h2.world.verifyResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(
      h2.execute(contextFor(second.run, second.claim, writeFixtureSaveDescriptor)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    assert.equal(intentByKey(h2.database)?.status, "parked");
  });
});
