/**
 * D182 — ref execution-and-sessions §7.1 rows C9–C10: the CAPTURE half of the 2j concurrency
 * matrix, at the command-kernel and finalize-projector seams.
 *
 * These are behavioural races, not structural invariants, so they live in the
 * unit lane rather than `tests/unit/architecture/` (ref guards-and-tests §3): the guard suite
 * proves a shape cannot be spelled, and these prove a SEQUENCE cannot happen.
 *
 * Two callers are the real Phase-2 shape here — the phone uploading while the
 * dashboard reviews, two dashboard tabs, or a projector draining while a
 * command lands. `node:sqlite` is synchronous, so "concurrent" inside one
 * process means *interleaved at the transaction boundary*: caller B decided its
 * `expectedVersion` before caller A committed. That is exactly what a second
 * browser tab does, and the serialization the store provides is the same one a
 * second OS process would get.
 *
 * What is deliberately NOT re-proved here, because it already is elsewhere:
 * duplicate/reordered phone uploads and restart-mid-finalize convergence
 * (`tests/unit/capture-durability.test.ts`), the intake version CAS
 * (`tests/unit/intake-session.test.ts`, `tests/unit/intake-command-arms.test.ts`),
 * and the run/claim races (`tests/unit/run-authority.test.ts` plus D182's two
 * architecture guards).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createCommandKernel, type CommandKernel } from "../../src/core/command-kernel.js";
import { createCaptureFinalizeProjector } from "../../src/infra/capture/finalize-projector.js";
import { manualClock } from "../../src/domain/clock.js";
import { CaptureSessionSchema } from "../../src/domain/capture.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { HASH_A, LATER, NOW, UUID_7, UUID_8 } from "./fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "./fixtures/archive-fixtures.js";
import {
  NO_INTAKE_PROJECTIONS,
  UNSTORED_CONFIG_IDENTITY,
  UNWIRED_INTAKE_PARSER,
} from "../fixtures/intake-kernel-seams.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SESSION_ID = UUID_7;
const PHOTO_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const FINAL_ARTIFACT_ID = "eeeeeeee-0000-4000-8000-00000000000e";
const HANDOFF_RUN_ID = "99999999-9999-4999-8999-999999999999";
const HANDOFF_MANIFEST_ID = "88888888-8888-4888-8888-888888888888";

function artifact(sha: string) {
  return { id: UUID_8, sha256: sha.repeat(64).slice(0, 64), bytes: 1024, mediaType: "image/jpeg" };
}

function openSession() {
  return CaptureSessionSchema.parse({
    sessionId: SESSION_ID,
    tokenDigest: HASH_A,
    workflow: "person-lookup",
    state: "open",
    photoRefs: [],
    handoff: { state: "pending" },
    finalizationGeneration: 0,
    version: 1,
    createdAt: NOW,
    expiresAt: LATER,
  });
}

let commandSequence = 0;
/**
 * A capture command. `expectedVersion` is the version the CALLER last saw —
 * two callers passing the same one is the whole point of these arms.
 */
function captureCommand(type: string, expectedVersion: number, payload?: unknown) {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return {
    commandId: `dddddddd-${tail}-4000-8000-${tail}00000000`,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "capture",
    type,
    target: { captureSessionId: SESSION_ID, expectedVersion },
    ...(payload === undefined ? {} : { payload }),
  };
}

interface Harness {
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
}

function harness(): Harness {
  const clock = manualClock(new Date(NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-concurrency-matrix-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "concurrency-matrix-test" },
    clock,
  );
  disposers.push(() => database.close());
  const kernel = createCommandKernel({
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(repositories),
      ),
    },
    clock,
    ids: sequentialIdFactory("a"),
    descriptors: { resolve: () => undefined },
    writeResolution: {
      resolvePresent: () => { throw new Error("unused"); },
      resolveAbsent: () => { throw new Error("unused"); },
    },
    workerRuntime: {
      planWorkerCount: () => { throw new Error("unused"); },
      spawnWorker: () => { throw new Error("unused"); },
      refreshBrowser: () => { throw new Error("unused"); },
      reopenBrowser: () => { throw new Error("unused"); },
    },
  });
  return { database, kernel };
}

/** One photo uploaded and the session finalized: the pre-projection state. */
function finalizedSession(h: Harness): void {
  h.database.authority.captureSessions.create(openSession());
  const uploaded = h.kernel.execute(captureCommand("capture-upload", 1, {
    photoId: PHOTO_A,
    artifact: artifact("a"),
    originalMediaType: "image/heic",
  }));
  assert.equal(uploaded.state, "applied");
}

function projector(h: Harness, hooks: Readonly<{
  idPrefix: string;
  onBundle?: () => Promise<void> | void;
  handoffCalls?: string[];
}>) {
  return createCaptureFinalizeProjector({
    authority: h.database.authority,
    withAuthorityTransaction: (work) => h.database.withAuthorityTransaction(work),
    artifacts: {
      put: (source) => {
        const bytes = source instanceof Uint8Array ? source : new Uint8Array();
        return Promise.resolve({
          id: FINAL_ARTIFACT_ID,
          sha256: "f".repeat(64),
          bytes: bytes.byteLength,
          mediaType: "application/pdf",
        } as never);
      },
    },
    bundler: {
      bundle: async (outbox) => {
        void outbox;
        await hooks.onBundle?.();
        return new TextEncoder().encode("bundled-pdf");
      },
    },
    handoff: {
      enqueue: ({ outbox }) => {
        hooks.handoffCalls?.push(String(outbox.stableKey));
        return { runId: HANDOFF_RUN_ID, intakeManifestId: HANDOFF_MANIFEST_ID };
      },
    },
    ids: sequentialIdFactory(hooks.idPrefix),
    clock: manualClock(new Date(NOW)),
  });
}

describe("D182 C9 — two callers finalize one capture session on the same reviewed version", () => {
  it("applies exactly one, refuses the second by name, and mints ONE finalize outbox row", () => {
    const h = harness();
    finalizedSession(h);
    const reviewedVersion = h.database.authority.captureSessions.get(SESSION_ID)?.version;
    assert.equal(reviewedVersion, 2);

    const winner = h.kernel.execute(captureCommand("capture-finalize", 2));
    assert.equal(winner.state, "applied");

    // The second tab still believes the session is at version 2 — it is, from
    // its point of view, the same reviewed plan. The refusal comes from the
    // STATE MACHINE re-read inside the kernel's own transaction, not from the
    // caller's claim: `expectedVersion` on a capture command is deliberately
    // not a CAS (see `tests/unit/capture-durability.test.ts`), so the state is
    // the only thing that can stop a second fan-out.
    const loser = h.kernel.execute(captureCommand("capture-finalize", 2));
    assert.equal(loser.state, "rejected");
    assert.equal(loser.state === "rejected" ? loser.code : "", "invalid-state");
    assert.match(loser.state === "rejected" ? loser.message : "", /finalizing/);

    const session = h.database.authority.captureSessions.get(SESSION_ID);
    assert.ok(session !== undefined);
    assert.equal(session.state, "finalizing");
    assert.equal(session.finalizationGeneration, 1);
    // Exactly one version step: a refused command moves nothing.
    assert.equal(session.version, 3);

    const pending = h.database.authority.captureFinalizationOutboxes.listPending();
    assert.equal(pending.length, 1, "a second finalize minted a second outbox row");
    assert.equal(pending[0]?.generation, 1);
    assert.equal(pending[0]?.sessionId, SESSION_ID);
  });

  it("moves ZERO authority rows for the refused caller", () => {
    const h = harness();
    finalizedSession(h);
    assert.equal(h.kernel.execute(captureCommand("capture-finalize", 2)).state, "applied");

    const generationBefore = h.database.getMeta().authorityGeneration;
    // Every remaining mutation arm is refused for a `finalizing` session, and
    // each refusal must be inert — a rejected command that had already written
    // half a change would be worse than no refusal at all.
    for (const [type, payload] of [
      ["capture-upload", { photoId: PHOTO_A, artifact: artifact("b"), originalMediaType: "image/heic" }],
      ["capture-delete", { photoId: PHOTO_A }],
      ["capture-reorder", { orderedPhotoIds: [PHOTO_A] }],
      ["capture-discard", undefined],
      ["capture-retry-finalize", undefined],
    ] as const) {
      const result = h.kernel.execute(captureCommand(type, 3, payload));
      assert.equal(result.state, "rejected", type);
      assert.equal(result.state === "rejected" ? result.code : "", "invalid-state", type);
    }
    assert.equal(h.database.getMeta().authorityGeneration, generationBefore);
    assert.equal(h.database.authority.captureSessions.get(SESSION_ID)?.version, 3);
    assert.equal(h.database.authority.captureFinalizationOutboxes.listPending().length, 1);
  });
});

describe("D182 C10 — two finalize projectors drain one pending outbox", () => {
  it("lands exactly ONE handoff and fails the loser loud with nothing written", async () => {
    const h = harness();
    finalizedSession(h);
    assert.equal(h.kernel.execute(captureCommand("capture-finalize", 2)).state, "applied");

    let releaseBundle = (): void => undefined;
    const bundleGate = new Promise<void>((resolve) => {
      releaseBundle = resolve;
    });
    let markStarted = (): void => undefined;
    const loserStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const winnerHandoffs: string[] = [];
    const loserHandoffs: string[] = [];

    // The loser reads the pending row and its session snapshot, then stalls in
    // the bundler — the long, non-transactional step where a second process
    // genuinely can overtake it.
    const losing = projector(h, {
      idPrefix: "c",
      handoffCalls: loserHandoffs,
      onBundle: async () => {
        markStarted();
        await bundleGate;
      },
    }).projectPending();
    await loserStarted;

    const won = await projector(h, { idPrefix: "b", handoffCalls: winnerHandoffs }).projectPending();
    assert.equal(won.finalized.length, 1);
    assert.deepEqual([...won.failed], []);
    assert.equal(winnerHandoffs.length, 1);

    const settledSession = h.database.authority.captureSessions.get(SESSION_ID);
    assert.ok(settledSession !== undefined);
    assert.equal(settledSession.state, "finalized");
    assert.equal(settledSession.handoff.state, "enqueued");
    const generationAfterWinner = h.database.getMeta().authorityGeneration;

    // The loser resumes over a session that moved: its settle finds the outbox
    // already done and its session update loses the version CAS. It escapes
    // `projectPending()` rather than landing in `report.failed`, which is
    // correct — "another projector beat me" is not this outbox's failure, and
    // recording it as one would settle a row this projector never projected.
    releaseBundle();
    await assert.rejects(losing, /raced past its expected predecessor/);

    // Its handoff stub was called — INSIDE the transaction that then unwound.
    // That is exactly why the real handoff writes its manifest and run in the
    // same transaction as the settle: the rollback is what makes it one-shot.
    assert.equal(loserHandoffs.length, 1);
    assert.equal(h.database.getMeta().authorityGeneration, generationAfterWinner);

    const finalSession = h.database.authority.captureSessions.get(SESSION_ID);
    assert.ok(finalSession !== undefined);
    assert.equal(finalSession.version, settledSession.version);
    assert.equal(finalSession.handoff.state, "enqueued");
    assert.equal(
      finalSession.handoff.state === "enqueued" ? finalSession.handoff.runId : "",
      HANDOFF_RUN_ID,
    );
    assert.deepEqual([...h.database.authority.captureFinalizationOutboxes.listPending()], []);
  });
});
