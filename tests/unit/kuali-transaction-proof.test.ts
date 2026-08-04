/**
 * Phase 2's transaction proof — the DRY-RUN half.
 *
 * The four graph paths live in `tests/scenario/kuali-timekeeper-annotation.scenario.test.ts`
 * because they are coverage points. THIS file is the depth behind them: every
 * way a Kuali write can be refused or parked, driven through the REAL write
 * sequencer, the REAL Kuali store, and a REAL temporary authority database.
 *
 * NOTHING HERE TOUCHES A REAL HR SYSTEM. Every arm runs against the
 * deterministic Kuali document. The one controlled live commit is a separate,
 * operator-authorized act that has not been performed, and no test in this
 * repository can perform it.
 *
 * The absence assertions are deliberately durable rather than behavioural: a
 * log line saying "refused" proves nothing about `write_intents`, and doc 07's
 * Phase-2 exit is a statement about durable rows.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { StagedPageDiscardedError, WriteParkedError } from "../../src/core/write-sequencer.js";
import { KualiSaveTimekeeperAnnotation } from "../../src/domain/contracts/kuali/save-timekeeper-annotation.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../src/domain/ui/kuali-rrss-document.js";
import { deriveWriteBindingProofDigest } from "../../src/domain/write-safety.js";
import { createDeterministicKualiDriver } from "../../src/stores/kuali/driver/fake.js";
import {
  KUALI_EID,
  KUALI_IDEMPOTENCY_KEY,
  KUALI_ITEM_ID,
  KUALI_NODE_ID,
  KUALI_OTHER_EID,
  KUALI_TIMEKEEPER_VALUE,
  KUALI_WORKFLOW_ID,
  kualiClaimRunning,
  kualiContext,
  kualiDurableFootprint,
  kualiHarness,
  kualiQueuedRun,
  type KualiHarness,
} from "./fixtures/kuali-transaction-fixtures.js";

const open: KualiHarness[] = [];
afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
});

function harness(options?: Parameters<typeof kualiHarness>[0]): KualiHarness {
  const created = kualiHarness(options);
  open.push(created);
  return created;
}

function clicked(h: KualiHarness): boolean {
  return h.world.events.some((event) => event.startsWith("commit:"));
}

/** Nothing about this transaction exists in authority, and Kuali is unchanged. */
function assertNothingHappened(h: KualiHarness): void {
  const footprint = kualiDurableFootprint(h);
  assert.equal(footprint.intent, undefined, "zero write intents");
  assert.equal(footprint.checkpoint, undefined, "zero checkpoints");
  assert.deepEqual(footprint.outboxes, [], "zero outboxes");
  assert.equal(clicked(h), false, "zero clicks");
  assert.equal(h.world.persistedTimekeeperName, "", "Kuali was not written");
}

describe("Kuali dry run — a staged preview with zero write intent", () => {
  it("previews with dryRun and leaves the authority database empty", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock, kualiQueuedRun({ dryRun: true }));
    const preview = await h.bound(() => h.sequencer.executeDryRun(kualiContext(run, claim, true)));

    assert.equal(preview.subject.state, "match");
    assert.equal(preview.prepare.value !== null && typeof preview.prepare.value === "object", true);
    assertNothingHappened(h);
    assert.equal(h.world.lastCapability, undefined, "no mutation capability was minted");
    assert.equal(
      h.emitter.events().some((event) => String(event.spanPath).endsWith("/commit")),
      false,
      "zero commit spans",
    );
  });

  it("never runs the idempotency probe: a preview asks nothing of the permanent key", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock, kualiQueuedRun({ dryRun: true }));
    await h.bound(() => h.sequencer.executeDryRun(kualiContext(run, claim, true)));
    assert.equal(
      h.world.events.some((event) => event.startsWith("read-back:")),
      false,
      "a dry run composes beat ② only",
    );
  });

  it("refuses a real transaction call that carries the dry-run flag rather than substituting a write", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock, kualiQueuedRun({ dryRun: true }));
    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim, true))),
      /capability-unavailable|does not support dry-run|preview outcome arm/,
    );
    assertNothingHappened(h);
    assert.deepEqual(h.world.events, [], "no browser work at all");
  });

  it("a dry-run preview whose subject does not match refuses instead of previewing a wrong-person write", async () => {
    const h = harness({ displayedEidAfterStage: KUALI_OTHER_EID });
    const { run, claim } = kualiClaimRunning(h.database, h.clock, kualiQueuedRun({ dryRun: true }));
    await assert.rejects(
      h.bound(() => h.sequencer.executeDryRun(kualiContext(run, claim, true))),
      /did not match; the real write would refuse to fence/,
    );
    assertNothingHappened(h);
  });
});

describe("Kuali wrong subject — zero fence, zero click", () => {
  it("beat ③: the staged page moved to another person after prepare", async () => {
    const h = harness({ displayedEidAfterStage: KUALI_OTHER_EID });
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /staged page shows subject/);
        assert.match(error.message, /subject mismatch, zero fence, zero click/);
        // The message names only a display suffix — never a full EID.
        assert.doesNotMatch(error.message, new RegExp(KUALI_OTHER_EID));
        return true;
      },
    );
    assert.ok(h.world.events.includes(`stage:${KUALI_TIMEKEEPER_VALUE}`), "prepare DID stage the page");
    assertNothingHappened(h);
  });

  it("beat ①: the probe reads another person's document and refuses before any staging", async () => {
    const h = harness({ displayedEid: KUALI_OTHER_EID });
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      /displays a different EID than the run named/,
    );
    assert.equal(
      h.world.events.some((event) => event.startsWith("stage:")),
      false,
      "an absence read off the wrong person's document never reaches prepare",
    );
    assertNothingHappened(h);
  });

  it("unknown subject at beat ③: an unreadable EID field refuses exactly like a mismatch", async () => {
    const h = harness({ displayedEidAfterStage: "—" });
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      /subject observation .* failed on the staged page — zero fence, zero click/,
    );
    assertNothingHappened(h);
  });

  it("unknown subject at beat ①: an unreadable probe is indeterminate, never an absence", async () => {
    const h = harness({ displayedEid: "not-an-eid" });
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      /is indeterminate .*refusing to fence or click/,
    );
    assertNothingHappened(h);
  });

  it("a stale probe: the probe→fence budget expires while the form is staged", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    // 45s is the node's declared budget; 46s of monotonic time passes between
    // the probe completing and the fence being attempted.
    h.world.onStage = (): void => { h.clock.advanceMonotonic(46_000); };
    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      (error: unknown) => error instanceof StagedPageDiscardedError,
    );
    assertNothingHappened(h);
  });
});

describe("Kuali fail-closed completion — every non-present verdict parks", () => {
  it("a save that did not take reads `absent` and parks; it never reports done", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    // The click fires and the page says nothing — Kuali's save is UI-silent —
    // but the value did not persist. Only the reload read-back can tell.
    h.world.commitDoesNotPersist = true;

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError);
        assert.equal(error.parkCode, "unknown");
        assert.match(error.message, /reports absent/);
        return true;
      },
    );

    assert.equal(clicked(h), true, "the click DID happen — this is a post-fence park");
    const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
    assert.equal(intent?.status, "parked", "the fence stays durable so nothing retries blindly");
    assert.equal(
      h.database.authority.runCheckpoints.latest(KUALI_WORKFLOW_ID, KUALI_ITEM_ID, KUALI_NODE_ID),
      undefined,
      "no transaction checkpoint: an unverified save is never done",
    );
  });

  it("a post-fence click that throws parks with an `unknown` landing state", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    h.world.commitThrows = new Error("the browser died between the click and the response");

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError);
        assert.equal(error.parkCode, "unknown");
        return true;
      },
    );

    // The fence WAS taken — that is the point. It stays durable and parked, so
    // no other run can fence the same key until the operator resolves it.
    const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
    assert.equal(intent?.status, "parked");
    const current = h.database.authority.runs.get(run.envelope.runId);
    assert.equal(current?.lifecycle.state, "parked-write");
    assert.equal(h.world.persistedTimekeeperName, "", "the click never landed");
  });

  it("a read-back that throws is `unknown` and parks — a failed check is not an absence", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    h.world.onStage = (): void => {
      h.world.readBackThrows = new Error("Kuali stopped responding after the save");
    };

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError);
        assert.equal(error.parkCode, "unknown");
        return true;
      },
    );
    const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
    assert.equal(intent?.status, "parked");
  });

  it("a parked key cannot be fenced again by any later run", async () => {
    const h = harness();
    const first = kualiClaimRunning(h.database, h.clock);
    h.world.commitThrows = new Error("post-fence uncertainty");
    await assert.rejects(h.bound(() => h.sequencer.executeTransaction(kualiContext(first.run, first.claim))));

    h.world.commitThrows = undefined;
    const parkedIntent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
    assert.equal(parkedIntent?.status, "parked");
    // A second attempt on the same permanent key refuses loudly rather than
    // taking a second generation. Only doc 09 §4.1's typed resolutions release.
    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(first.run, first.claim))),
      /is parked .*only the typed operator resolutions may release it/s,
    );
  });
});

describe("Kuali write-safety contract shape", () => {
  it("declares operator-only absence settlement, so no absence can authorize a retry", () => {
    const { recoveryAbsence } = KualiSaveTimekeeperAnnotation.writeSafety.idempotency;
    assert.equal(recoveryAbsence.kind, "operator-only");
    assert.match(
      recoveryAbsence.kind === "operator-only" ? recoveryAbsence.reason : "",
      /no propagation window has been measured/,
    );
  });

  it("verifies through a reload read-back, not through the commit's own output", () => {
    const { completion } = KualiSaveTimekeeperAnnotation.writeSafety;
    assert.equal(completion.kind, "save-verify");
    assert.equal(
      completion.kind === "save-verify" ? completion.verify.taskId : "",
      "kuali/verify-timekeeper-annotation",
    );
    assert.notEqual(
      completion.kind === "save-verify" ? completion.verify.taskId : "",
      KualiSaveTimekeeperAnnotation.writeSafety.idempotency.probe.taskId,
      "the verifier must be its own task; a verifier that is the probe never reloads",
    );
  });

  it("only the Save element can be committed, and only with a sequencer-minted capability", async () => {
    const h = harness();
    const driver = createDeterministicKualiDriver(h.world, h.clock);
    const forged = Object.freeze({ intentGeneration: 1, bindingDigest: "0".repeat(64) });
    await assert.rejects(
      driver.commit(KUALI_RRSS_SAVE_BUTTON, forged as never),
      /was not minted by the fenced write sequencer; refusing to click/,
    );
    assert.equal(h.world.persistedTimekeeperName, "");
  });

  it("binds the minted capability to the exact fenced binding proof", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    await h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim)));
    const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
    assert.ok(intent !== undefined && intent.status === "committed");
    const capability = h.world.lastCapability as { intentGeneration: number; bindingDigest: string };
    assert.equal(capability.intentGeneration, intent.generation);
    assert.equal(capability.bindingDigest, deriveWriteBindingProofDigest(intent.bindingProof));
  });
});

describe("Kuali permanent-key dedupe", () => {
  it("a second run for the same document+value reuses the committed proof and never clicks", async () => {
    const h = harness();
    const first = kualiClaimRunning(h.database, h.clock);
    await h.bound(() => h.sequencer.executeTransaction(kualiContext(first.run, first.claim)));
    const clicksAfterFirst = h.world.events.filter((event) => event.startsWith("commit:")).length;
    assert.equal(clicksAfterFirst, 1);

    // A brand-new run, same business key. Its own checkpoint does not exist, so
    // it walks beat ① and finds the committed permanent row.
    const secondRunInput = {
      ...kualiQueuedRun(),
      envelope: {
        ...(kualiQueuedRun().envelope as Record<string, unknown>),
        runId: "99999999-9999-4999-8999-999999999999",
        itemId: "88888888-8888-4888-8888-888888888888",
        traceId: "kt-100001-3333",
      },
    };
    const second = kualiClaimRunning(h.database, h.clock, secondRunInput, "kuali-transaction-worker-2");
    const outcome = await h.bound(() => h.sequencer.executeTransaction({
      ...kualiContext(second.run, second.claim),
      run: second.run,
    }));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(Reflect.get(outcome as object, "proofSource"), "durable-intent");
    assert.equal(
      h.world.events.filter((event) => event.startsWith("commit:")).length,
      clicksAfterFirst,
      "the permanent key blocked the second click",
    );
  });

  it("replays its own settled checkpoint byte-exact instead of re-clicking", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    const first = await h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim)));
    const clicks = h.world.events.filter((event) => event.startsWith("commit:")).length;

    const current = h.database.authority.runs.get(run.envelope.runId);
    assert.ok(current !== undefined);
    const replayed = await h.bound(() => h.sequencer.executeTransaction({
      ...kualiContext(current, claim),
      run: current,
    }));
    assert.deepEqual(replayed, first);
    assert.equal(
      h.world.events.filter((event) => event.startsWith("commit:")).length,
      clicks,
      "a stored transaction checkpoint never re-clicks",
    );
    assert.notEqual(
      h.database.authority.runCheckpoints.latest(KUALI_WORKFLOW_ID, KUALI_ITEM_ID, KUALI_NODE_ID),
      undefined,
    );
    assert.equal(h.world.displayedEid, KUALI_EID);
  });
});
