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
import {
  KUALI_RRSS_SAVE_BUTTON,
  KUALI_RRSS_TIMEKEEPER_FORM_KEY,
} from "../../src/domain/ui/kuali-rrss-document.js";
import { deriveWriteBindingProofDigest } from "../../src/domain/write-safety.js";
import {
  AtomicWriteCommitStorageStepSchema,
  SequencedWriteCommitStepSchema,
} from "../../src/infra/sqlite/index.js";
import { createDeterministicKualiDriver, createKualiFakeWorld } from "../../src/stores/kuali/driver/fake.js";
import { createKualiRrssDocumentDriver } from "../../src/stores/kuali/driver/interpreter.js";
import { manualClock } from "../../src/domain/clock.js";
import { fakeKualiPage } from "./fixtures/fake-kuali-page.js";
import {
  KUALI_ACTION_ID,
  KUALI_DOCUMENT_NUMBER,
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

/**
 * The 2026-08-04 controlled commit on doc 4489 fenced, clicked `Save`, got
 * `200` + `Form saved`, and persisted NOTHING: a Kuali Build text gadget
 * debounces into the document model, and only the model reaches
 * `submitDocumentV2`. These pin both halves of the fix — the pre-fence barrier
 * that waits for the model to take the value, and the post-click wire proof
 * that the mutation actually carried it.
 */
describe("Kuali model commit — the DOM holding the value is not Kuali holding it", () => {
  it("a value that never reaches the document model fails BEFORE the fence, with zero clicks", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    h.world.modelNeverCommits = true;

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      /did not commit the staged timekeeper value into its document model/,
    );

    // The barrier is in PREPARE, so this costs nothing durable at all: the
    // failure happens before any intent, any fence and any click exist.
    assertNothingHappened(h);
  });

  it("a Save whose mutation drops the staged value parks; it is never a completed write", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    h.world.commitPayloadOmitsValue = true;

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError);
        assert.equal(error.parkCode, "unknown");
        return true;
      },
    );

    assert.equal(clicked(h), true, "the click happened — the throw is post-fence, so it must park");
    assert.equal(h.world.persistedTimekeeperName, "", "and it wrote nothing");
    const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
    assert.equal(intent?.status, "parked");
    assert.equal(
      h.database.authority.runCheckpoints.latest(KUALI_WORKFLOW_ID, KUALI_ITEM_ID, KUALI_NODE_ID),
      undefined,
      "no checkpoint: a save that carried nothing is not a save",
    );
  });

  it("refuses to click Save with nothing staged, even holding a genuinely minted capability", async () => {
    // A real minted capability, taken from a real completed fence — the test
    // may not mint one itself (`src/core/write-sequencer.ts` is the only
    // permitted minter), and a forged one would fail on the capability check
    // before ever reaching the staging check this pins.
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    await h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim)));
    const minted = h.world.lastCapability;
    assert.ok(minted !== undefined && minted !== null, "the completed transaction minted a capability");

    const unstaged = createDeterministicKualiDriver(
      createKualiFakeWorld({
        actionId: KUALI_ACTION_ID,
        documentNumber: KUALI_DOCUMENT_NUMBER,
        displayedEid: KUALI_EID,
      }),
      h.clock,
    );
    await assert.rejects(
      unstaged.commit(KUALI_RRSS_SAVE_BUTTON, minted as Parameters<typeof unstaged.commit>[1]),
      /refuses to click Save without a staging on this exact page/,
    );
  });

  it("pins the timekeeper formKey the save mutation is keyed by — it is NOT the DOM id", () => {
    // Read live 2026-08-04 from Kuali's own `ActionPage` form template on docs
    // 4489/4490: gadget id `BWmkKqx40` (the DOM id) → formKey `QGJ63YrCom` (what
    // `submitDocumentV2.variables.data` uses). A check written against the DOM
    // id would never match, so this pin is what keeps the wire proof honest.
    assert.equal(KUALI_RRSS_TIMEKEEPER_FORM_KEY, "QGJ63YrCom");
    assert.notEqual(KUALI_RRSS_TIMEKEEPER_FORM_KEY, "BWmkKqx40");
  });
});

describe("Kuali write-safety contract shape", () => {
  it("declares a stabilized absence window that is far wider than the measured propagation", () => {
    const { recoveryAbsence } = KualiSaveTimekeeperAnnotation.writeSafety.idempotency;
    assert.equal(recoveryAbsence.kind, "stabilized");
    if (recoveryAbsence.kind !== "stabilized") return;
    // Measured 2026-08-04 over four authorized write/restore cycles on doc 4490:
    // the worst fence→trustworthy-negative was ~3.3s (click→response 3036ms plus
    // ~283ms for Kuali's own state to agree). The window must stay comfortably
    // above that, and a single observation may never settle a negative.
    assert.ok(recoveryAbsence.minSinceFenceMs >= 3_300 * 5, "the window must dwarf the measured worst case");
    assert.equal(recoveryAbsence.minSinceFenceMs, 30_000);
    assert.equal(recoveryAbsence.consistentReads, 2);
    assert.equal(recoveryAbsence.minBetweenReadsMs, 5_000);
    assert.equal(recoveryAbsence.requireSameSourceState, true);
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

/* ────────────────────────────────────────────────────────────────────────────
 * Phase 2's CONTROLLED-COMMIT half.
 *
 * The live lane on operator-named documents 4489/4490 (2026-08-04) fenced,
 * clicked Save, and read `absent` — the Kuali save mutation for that workflow
 * step does not carry the timekeeper field at all, so the write cannot land
 * there and the kernel parked, fail-closed. These arms are the repeatable
 * fixtures doc 07 asks for around that same code path: crash injection at
 * EVERY supported beat-⑦ seam, the recovery arms, browser-context cleanup, and
 * the context-exclusive lease under two workers on ONE authority database.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("Kuali beat ⑦ — every crash seam is all-or-none", () => {
  for (const step of AtomicWriteCommitStorageStepSchema.options) {
    it(`inner primitive crash after ${step} leaves the intent attempting and nothing else`, async () => {
      const h = harness({
        commitHooks: {
          afterStorageStep(failed) {
            if (failed === step) throw new Error(`injected inner crash after ${failed}`);
          },
        },
      });
      const { run, claim } = kualiClaimRunning(h.database, h.clock);
      const versionBefore = h.database.authority.runs.get(run.envelope.runId)?.version;

      await assert.rejects(
        h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
        new RegExp(`injected inner crash after ${step}`),
      );

      const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
      assert.equal(intent?.status, "attempting", "the fence survives for doc-09 §4 recovery");
      assert.equal(
        h.database.authority.runCheckpoints.latest(KUALI_WORKFLOW_ID, KUALI_ITEM_ID, KUALI_NODE_ID),
        undefined,
        "no transaction checkpoint",
      );
      assert.equal(h.database.authority.runs.get(run.envelope.runId)?.version, versionBefore, "no run advance");
      assert.deepEqual(kualiDurableFootprint(h).outboxes, [], "no ledger or terminal-span outbox");
      assert.equal(clicked(h), true, "the click DID happen — this is the crash window recovery exists for");
    });
  }

  for (const step of SequencedWriteCommitStepSchema.options) {
    it(`outer bundle crash after ${step} leaves the intent attempting and nothing else`, async () => {
      const h = harness({
        hooks: {
          afterSequencedStep(failed) {
            if (failed === step) throw new Error(`injected outer crash after ${failed}`);
          },
        },
      });
      const { run, claim } = kualiClaimRunning(h.database, h.clock);
      const versionBefore = h.database.authority.runs.get(run.envelope.runId)?.version;

      await assert.rejects(
        h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
        new RegExp(`injected outer crash after ${step}`),
      );

      const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
      assert.equal(intent?.status, "attempting");
      assert.equal(
        h.database.authority.runCheckpoints.latest(KUALI_WORKFLOW_ID, KUALI_ITEM_ID, KUALI_NODE_ID),
        undefined,
      );
      assert.equal(h.database.authority.runs.get(run.envelope.runId)?.version, versionBefore);
      assert.deepEqual(kualiDurableFootprint(h).outboxes, []);
    });
  }
});

describe("Kuali recovery of a crashed attempt (doc 09 §4)", () => {
  it("a validated present read-back backfills committed WITHOUT a second click", async () => {
    const h = harness({
      hooks: {
        afterSequencedStep(step) {
          if (step === "run-transition") throw new Error("injected crash before the run advanced");
        },
      },
    });
    const first = kualiClaimRunning(h.database, h.clock);
    await assert.rejects(h.bound(() => h.sequencer.executeTransaction(kualiContext(first.run, first.claim))));
    const clicks = h.world.events.filter((event) => event.startsWith("commit:")).length;
    assert.equal(clicks, 1);
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY)?.status,
      "attempting",
    );
    // The click DID land in Kuali; the crash only lost our record of it.
    assert.equal(h.world.persistedTimekeeperName, KUALI_TIMEKEEPER_VALUE);

    const resumedHarness = harness({ database: h.database, persistedTimekeeperName: KUALI_TIMEKEEPER_VALUE });
    const current = h.database.authority.runs.get(first.run.envelope.runId);
    assert.ok(current !== undefined);
    const outcome = await resumedHarness.bound(() => resumedHarness.sequencer.executeTransaction({
      ...kualiContext(current, first.claim),
      run: current,
    }));

    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.equal(Reflect.get(outcome as object, "proofSource"), "recovery-probe");
    assert.equal(
      resumedHarness.world.events.filter((event) => event.startsWith("commit:")).length,
      0,
      "recovery probes; it never clicks a second time",
    );
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY)?.status,
      "committed",
    );
  });

  it("an absent read-back after the crash parks: one observation is never retry authority", async () => {
    const h = harness({
      hooks: {
        afterSequencedStep(step) {
          if (step === "run-transition") throw new Error("injected crash before the run advanced");
        },
      },
    });
    const first = kualiClaimRunning(h.database, h.clock);
    await assert.rejects(h.bound(() => h.sequencer.executeTransaction(kualiContext(first.run, first.claim))));
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY)?.status,
      "attempting",
    );

    // The resumed lane opens a document that does NOT show the value — the
    // write was rolled back, or never landed. The recovery probe therefore
    // reads a well-evidenced `absent`, and `operator-only` settlement means
    // that single observation carries zero retry authority.
    const resumed = harness({ database: h.database });
    const current = h.database.authority.runs.get(first.run.envelope.runId);
    assert.ok(current !== undefined);
    await assert.rejects(
      resumed.bound(() => resumed.sequencer.executeTransaction({ ...kualiContext(current, first.claim), run: current })),
      (error: unknown) => {
        assert.ok(error instanceof WriteParkedError, `unexpected error: ${String(error)}`);
        assert.equal(error.parkCode, "unknown");
        return true;
      },
    );
    const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
    assert.equal(intent?.status, "parked", "operator-only absence settlement can never mint a generation");
    assert.equal(intent?.generation, 1, "no new generation was created");
  });
});

describe("Kuali context lifecycle and the context-exclusive lease", () => {
  it("a post-fence park closes the browser context before the run parks", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);
    h.world.commitThrows = new Error("post-fence uncertainty");
    await assert.rejects(h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))));
    assert.deepEqual(h.manager.activeSystems(), [], "no browser resource survives a parked write");
    assert.equal(h.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-write");
  });

  it("two workers on ONE authority database: the permanent key admits exactly one fence", async () => {
    const first = harness();
    const second = harness({ database: first.database, workerId: "kuali-transaction-worker-2" });
    const a = kualiClaimRunning(first.database, first.clock);
    await first.bound(() => first.sequencer.executeTransaction(kualiContext(a.run, a.claim)));

    const otherRun = {
      ...kualiQueuedRun(),
      envelope: {
        ...(kualiQueuedRun().envelope as Record<string, unknown>),
        runId: "77777777-7777-4777-8777-777777777777",
        itemId: "66666666-6666-4666-8666-666666666666",
        traceId: "kt-100002-4444",
      },
    };
    const b = kualiClaimRunning(first.database, first.clock, otherRun, "kuali-transaction-worker-2");
    const outcome = await second.bound(() => second.sequencer.executeTransaction({
      ...kualiContext(b.run, b.claim),
      run: b.run,
    }));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(
      second.world.events.filter((event) => event.startsWith("commit:")).length,
      0,
      "the second worker never clicked",
    );
  });

  it("a run enqueued as a dry run can never reach the fence, whatever the caller passes", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock, kualiQueuedRun({ dryRun: true }));
    await assert.rejects(
      // `dryRun:false` is deliberately a LIE about a dry-run envelope: this is
      // exactly the shape a mis-wired caller produces, and the kernel must
      // refuse on the run's own immutable envelope rather than the claim.
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim, false))),
      /was enqueued as a dry run.*refuses to fence or click/s,
    );
    assertNothingHappened(h);
  });
});

describe("Kuali document identification on a client-rendered page", () => {
  const ACTION = "6a712bf32ff7fb799788a79e";
  const VIEW_URL = `https://ucsd.kualibuild.com/build/space/5e47518b90adda9474c14adb/actions/${ACTION}/view`;

  it("identifies the document beside an EMPTY heading and two decoy headings", async () => {
    // The exact live neighbourhood: the document heading paints last, and the
    // page carries "Action" / "Action List" headings the whole time.
    const { page } = fakeKualiPage({
      url: VIEW_URL,
      headings: ["4489", "Action", "Action List"],
      eid: " 10001828 ",
      timekeeper: "  ",
    });
    const driver = createKualiRrssDocumentDriver(page, manualClock(new Date("2026-08-04T15:00:00.000Z")));
    const view = await driver.openDocument({ actionId: ACTION, documentNumber: "4489" });
    assert.equal(view.documentNumber, "4489");
    assert.equal(view.observedEid, "10001828", "every Kuali read trims");
    assert.equal(view.currentTimekeeperName, "");
  });

  it("refuses when no heading has the shape of a document number — the stale-action-id case", async () => {
    const { page } = fakeKualiPage({
      url: VIEW_URL,
      headings: ["", "Action", "Action List"],
      eid: "10001828",
      timekeeper: "",
    });
    const driver = createKualiRrssDocumentDriver(page, manualClock(new Date("2026-08-04T15:00:00.000Z")));
    await assert.rejects(
      driver.openDocument({ actionId: ACTION, documentNumber: "4489" }),
      /did not render a document-number heading .*the action id may be stale/s,
    );
  });

  it("refuses a page that shows a DIFFERENT document, naming both numbers", async () => {
    const { page } = fakeKualiPage({
      url: VIEW_URL,
      headings: ["4490", "Action", "Action List"],
      eid: "10631689",
      timekeeper: "",
    });
    const driver = createKualiRrssDocumentDriver(page, manualClock(new Date("2026-08-04T15:00:00.000Z")));
    await assert.rejects(
      driver.openDocument({ actionId: ACTION, documentNumber: "4489" }),
      /opened document 4490, but the run named 4489/,
    );
  });

  it("refuses an ambiguous page carrying two document-number headings", async () => {
    const { page } = fakeKualiPage({
      url: VIEW_URL,
      headings: ["4489", "4490"],
      eid: "10001828",
      timekeeper: "",
    });
    const driver = createKualiRrssDocumentDriver(page, manualClock(new Date("2026-08-04T15:00:00.000Z")));
    await assert.rejects(
      driver.openDocument({ actionId: ACTION, documentNumber: "4489" }),
      /rendered 2 document-number headings; exactly one is required/,
    );
  });
});
