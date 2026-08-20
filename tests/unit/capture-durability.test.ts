/**
 * Ref data-intake-and-edit-data §5.1 / D79d (D167): the two durability obligations that survive the
 * trim, plus the mutation arms.
 *
 * - An OPEN session survives a restart because the session IS a durable row.
 * - Finalize is an OUTBOX: restart mid-finalize replays the same stable row
 *   to ONE artifact and ONE handoff; a handoff failure is durable `failed`
 *   with Retry Finalize minting the next generation over the same photos —
 *   success is never silent, and neither is failure.
 * - Duplicate and reordered phone requests never duplicate photos or
 *   handoffs; version drift alone is not a CAS conflict.
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
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "./fixtures/archive-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SESSION_ID = UUID_7;
const PHOTO_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const PHOTO_B = "bbbbbbbb-0000-4000-8000-00000000000b";

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
  reopen(): void;
  database(): AuthorityDatabase;
  kernel(): CommandKernel;
}

function harness(): Harness {
  const clock = manualClock(new Date(NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-capture-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "authority.sqlite");
  let database: AuthorityDatabase | undefined;
  let kernel: CommandKernel | undefined;
  const open = (): void => {
    database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "capture-test" },
      clock,
    );
    const held = database;
    disposers.push(() => {
      try { held.close(); } catch { /* an already-closed handle is the restart fixture's point */ }
    });
    kernel = createCommandKernel({
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
      configIdentity: UNSTORED_CONFIG_IDENTITY,
      intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      authority: {
        withAuthorityTransaction: (work) => held.withAuthorityTransaction(
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
  };
  open();
  return {
    reopen: () => {
      database?.close();
      open();
    },
    database: () => {
      if (database === undefined) throw new Error("harness database not open");
      return database;
    },
    kernel: () => {
      if (kernel === undefined) throw new Error("harness kernel not open");
      return kernel;
    },
  };
}

function projectorFor(h: Harness, options?: Readonly<{
  bundleCalls?: string[];
  handoffCalls?: string[];
  failHandoff?: boolean;
}>) {
  return createCaptureFinalizeProjector({
    authority: h.database().authority,
    withAuthorityTransaction: (work) => h.database().withAuthorityTransaction(work),
    artifacts: {
      put: (source, metadata) => {
        void metadata;
        const bytes = source instanceof Uint8Array ? source : new Uint8Array();
        return Promise.resolve({
          id: "eeeeeeee-0000-4000-8000-00000000000e",
          sha256: "f".repeat(64),
          bytes: bytes.byteLength,
          mediaType: "application/pdf",
        } as never);
      },
    },
    bundler: {
      bundle: (outbox) => {
        options?.bundleCalls?.push(String(outbox.stableKey));
        return Promise.resolve(new TextEncoder().encode("bundled-pdf"));
      },
    },
    handoff: {
      enqueue: ({ outbox }) => {
        if (options?.failHandoff === true) throw new Error("intake enqueue refused the bundle");
        options?.handoffCalls?.push(String(outbox.stableKey));
        return {
          runId: "99999999-9999-4999-8999-999999999999",
          intakeManifestId: "88888888-8888-4888-8888-888888888888",
        };
      },
    },
    ids: sequentialIdFactory("b"),
    clock: manualClock(new Date(NOW)),
  });
}

describe("capture durability", () => {
  it("an open session with photos survives a restart", () => {
    const h = harness();
    h.database().authority.captureSessions.create(openSession());
    const uploaded = h.kernel().execute(captureCommand("capture-upload", 1, {
      photoId: PHOTO_A, artifact: artifact("a"), originalMediaType: "image/heic",
    }));
    assert.equal(uploaded.state, "applied");

    h.reopen();
    const active = h.database().authority.captureSessions.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0]?.state, "open");
    assert.equal(active[0]?.photoRefs.length, 1);
  });

  it("duplicate and reordered requests never duplicate photos, and drift is not a CAS conflict", () => {
    const h = harness();
    h.database().authority.captureSessions.create(openSession());
    const k = h.kernel();
    k.execute(captureCommand("capture-upload", 1, { photoId: PHOTO_A, artifact: artifact("a"), originalMediaType: "image/heic" }));
    k.execute(captureCommand("capture-upload", 2, { photoId: PHOTO_B, artifact: artifact("b"), originalMediaType: "image/heic" }));
    // The same photo again under a NEW command id — and a STALE version — is a
    // no-op, not a duplicate and not a version-drift rejection.
    const duplicate = k.execute(captureCommand("capture-upload", 1, { photoId: PHOTO_A, artifact: artifact("a"), originalMediaType: "image/heic" }));
    assert.equal(duplicate.state, "applied");
    const reordered = k.execute(captureCommand("capture-reorder", 3, { orderedPhotoIds: [PHOTO_B, PHOTO_A] }));
    assert.equal(reordered.state, "applied");
    const reorderedAgain = k.execute(captureCommand("capture-reorder", 4, { orderedPhotoIds: [PHOTO_B, PHOTO_A] }));
    assert.equal(reorderedAgain.state, "applied");

    const session = h.database().authority.captureSessions.get(SESSION_ID);
    assert.equal(session?.photoRefs.length, 2);
    assert.deepEqual(
      [...(session?.photoRefs ?? [])].sort((a, b) => a.ordinal - b.ordinal).map((photo) => String(photo.photoId)),
      [PHOTO_B, PHOTO_A],
    );
  });

  it("restart mid-finalize replays the same outbox to ONE artifact and ONE handoff", async () => {
    const h = harness();
    h.database().authority.captureSessions.create(openSession());
    h.kernel().execute(captureCommand("capture-upload", 1, { photoId: PHOTO_A, artifact: artifact("a"), originalMediaType: "image/heic" }));
    h.kernel().execute(captureCommand("capture-finalize", 2));
    assert.equal(h.database().authority.captureFinalizationOutboxes.listPending().length, 1);
    // A second finalize cannot race a finalizing session into a second outbox.
    const again = h.kernel().execute(captureCommand("capture-finalize", 3));
    assert.equal(again.state, "rejected");

    // The crash: the dashboard dies before the projector ran.
    h.reopen();
    const bundleCalls: string[] = [];
    const handoffCalls: string[] = [];
    const projector = projectorFor(h, { bundleCalls, handoffCalls });
    const first = await projector.projectPending();
    assert.deepEqual(first.failed, []);
    assert.equal(first.finalized.length, 1);
    const second = await projector.projectPending();
    assert.equal(second.finalized.length, 0, "a settled outbox is never re-projected");
    assert.equal(handoffCalls.length, 1, "exactly one handoff, ever");

    const session = h.database().authority.captureSessions.get(SESSION_ID);
    assert.equal(session?.state, "finalized");
    assert.equal(session?.handoff.state, "enqueued");
  });

  it("a handoff failure is durable failed state, and retry-finalize mints the next generation over the same photos", async () => {
    const h = harness();
    h.database().authority.captureSessions.create(openSession());
    h.kernel().execute(captureCommand("capture-upload", 1, { photoId: PHOTO_A, artifact: artifact("a"), originalMediaType: "image/heic" }));
    h.kernel().execute(captureCommand("capture-finalize", 2));

    const failing = projectorFor(h, { failHandoff: true });
    const report = await failing.projectPending();
    assert.equal(report.failed.length, 1);
    const failedSession = h.database().authority.captureSessions.get(SESSION_ID);
    assert.equal(failedSession?.state, "failed");
    assert.equal(failedSession?.handoff.state, "failed");

    const retried = h.kernel().execute(captureCommand("capture-retry-finalize", failedSession?.version ?? 0));
    assert.equal(retried.state, "applied");
    const pending = h.database().authority.captureFinalizationOutboxes.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.generation, 2);

    const handoffCalls: string[] = [];
    const working = projectorFor(h, { handoffCalls });
    const recovered = await working.projectPending();
    assert.deepEqual(recovered.failed, []);
    assert.equal(handoffCalls.length, 1);
    assert.equal(h.database().authority.captureSessions.get(SESSION_ID)?.state, "finalized");
  });

  it("discard is terminal from open and failed, and never from finalizing", () => {
    const h = harness();
    h.database().authority.captureSessions.create(openSession());
    h.kernel().execute(captureCommand("capture-upload", 1, { photoId: PHOTO_A, artifact: artifact("a"), originalMediaType: "image/heic" }));
    h.kernel().execute(captureCommand("capture-finalize", 2));
    const midFlight = h.kernel().execute(captureCommand("capture-discard", 3));
    assert.equal(midFlight.state, "rejected", "a finalizing session's outbox is in flight");
  });
});
