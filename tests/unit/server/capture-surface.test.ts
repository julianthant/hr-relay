/**
 * The phone-capture surface end to end (ref data-intake-and-edit-data §5.1, ref clock-config-secrets, ref operator-trust §7, D174)
 * over REAL machinery: a real authority database on disk, the real
 * content-addressed artifact writer, the real command kernel, the real
 * `composeCaptureSurface` seam, the real PDF bundler over REAL photographs,
 * and the real Hono app. The only injected values are the ones a test must
 * pin: the clock, the id factory, and the token mint.
 *
 * Four properties carry the slice, and every case below belongs to one:
 *
 * 1. **Starting is a credential mint, and the credential never lands.** The
 *    token exists once, in the start response; the durable row holds a digest,
 *    and the QR URL carries it in the FRAGMENT — the one part of a URL a
 *    browser never transmits.
 * 2. **Enumeration is fail-closed.** Unknown, malformed, absent, expired and
 *    discarded tokens answer with the same status and the same BYTES. Expiry
 *    is a durable transition, not a filter over the answer.
 * 3. **The photo lifecycle is content-level idempotent** — the same photo
 *    again is a no-op, the same id with different bytes is refused by name,
 *    and every refusal leaves authority exactly as it found it.
 * 4. **Finalize either hands off visibly or fails visibly.** With no workflow
 *    declaring a binding — the real production state — it lands durable
 *    `failed` whose message NAMES the missing declaration, with zero runs and
 *    zero manifests. With one declared, it produces exactly one manifest, one
 *    queued run, and a real multi-page PDF.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { Hono } from "hono";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { captureIntakeRegistry, CAPTURE_INTAKE_BINDINGS } from "../../../src/control/workflow-registry.js";
import type { ArtifactRef } from "../../../src/domain/artifacts.js";
import { manualClock } from "../../../src/domain/clock.js";
import type { CaptureFinalizationOutbox } from "../../../src/domain/capture.js";
import type { CaptureIntakeBinding } from "../../../src/domain/capture-intake.js";
import {
  CAPTURE_TOKEN_HEADER,
  CaptureSessionWireSchema,
  CaptureStartResultSchema,
  deriveCaptureTokenDigest,
  type CaptureSessionWire,
} from "../../../src/domain/capture-surface.js";
import {
  CaptureOperatorSessionListWireSchema,
  CaptureOperatorSessionWireSchema,
  type CaptureOperatorSessionListWire,
  type CaptureOperatorSessionWire,
} from "../../../src/domain/capture-operator.js";
import { defaultRuntimePaths } from "../../../src/domain/config/runtime-paths.js";
import { ConfigSchema, type Config } from "../../../src/domain/config/schema.js";
import { resolveConfig } from "../../../src/domain/config/resolve.js";
import { deriveItemId, deriveStableUuid } from "../../../src/domain/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/domain/ids.js";
import { defineWorkflowRole } from "../../../src/domain/workflow/module-role.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { createSpanJsonlWriter } from "../../../src/infra/events/span-jsonl-writer.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { composeCaptureSurface } from "../../../src/server/capture/compose.js";
import { createCaptureIngressResolver } from "../../../src/server/dashboard/commands/capture-service.js";
import { createDashboardCommandService } from "../../../src/server/dashboard/commands/command-service.js";
import { createStartPlanService } from "../../../src/server/dashboard/commands/start-plan-service.js";
import { descriptorSetHash } from "../../../src/server/dashboard/compose.js";
import { createRunQueueProjection } from "../../../src/server/dashboard/projectors/run-queue-projection.js";
import { createDashboardApp } from "../../../src/server/dashboard/routes/api.js";
import { createDashboardStreamHub } from "../../../src/server/dashboard/subscriptions/dashboard-stream.js";
import { createReceiptService } from "../../../src/server/trust/receipt-service.js";
import { CONFIG_SNAPSHOT, NOW, UUID_1 } from "../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import {
  BASELINE_JPEG_BASE64,
  TRUECOLOUR_PNG_BASE64,
  fixtureBytes,
} from "../fixtures/capture-image-fixtures.js";
import {
  CAPTURE_FIXTURE_CODE,
  CAPTURE_FIXTURE_FORM_TYPE,
  CAPTURE_FIXTURE_WORKFLOW_ID,
  CaptureFixtureInput,
  captureFixtureBinding,
  captureFixtureCopiedSchemaBinding,
  captureFixtureDescriptor,
  handBuiltCaptureBinding,
} from "../fixtures/capture-intake-fixtures.js";
import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../fixtures/dashboard-stream-seams.js";
import { healthyDashboardPreflightExecutor, healthyDashboardPreflightReport } from "../../fixtures/preflight-seams.js";
import { explorerQueryDeps, uiCatalogQueryDeps } from "../../fixtures/explorer-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../fixtures/archive-fixtures.js";
import { archiveQueryDeps } from "../../fixtures/archive-seams.js";
import {
  NO_INTAKE_PROJECTIONS,
  UNWIRED_INTAKE_PARSER,
  UNWIRED_INTAKE_SERVICE,
} from "../../fixtures/intake-kernel-seams.js";
import { createLedgerReadThrough } from "../../../src/infra/ledger/ledger-read-through.js";

/* ── the fixed values this suite pins ────────────────────────────────────── */

const FORWARDED_ORIGIN = "https://capture.example.test";
const MAX_PHOTO_BYTES = 65_536;
const PRE_CONNECT_TTL_MS = 900_000;
const ACTIVE_IDLE_TTL_MS = 3_600_000;

/** The EID the fixture binding reads out of the operator's context hint. */
const CONTEXT_EID = "10456712";

const PHOTO_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const PHOTO_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PHOTO_C = "cccccccc-0000-4000-8000-00000000000c";

const JPEG = fixtureBytes(BASELINE_JPEG_BASE64);
const PNG = fixtureBytes(TRUECOLOUR_PNG_BASE64);

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/* ── harness ─────────────────────────────────────────────────────────────── */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

let commandSequence = 0;
function commandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `eeeeeeee-${tail}-4000-8000-${tail}00000000`;
}

interface CaptureConfigOverrides {
  readonly ingress?: "disabled" | "on-demand-ngrok" | "forwarded";
  readonly forwardedUrl?: string;
  readonly maxPhotos?: number;
  readonly maxPhotoBytes?: number;
}

function captureConfig(overrides: CaptureConfigOverrides = {}): Config {
  const ingress = overrides.ingress ?? "forwarded";
  return ConfigSchema.parse({
    paths: defaultRuntimePaths(),
    capture: {
      ingress,
      // The schema refuses a forwardedUrl on any other mode, so it is present
      // exactly when the mode owns it.
      ...(ingress === "forwarded"
        ? { forwardedUrl: overrides.forwardedUrl ?? FORWARDED_ORIGIN }
        : {}),
      preConnectTtlMs: PRE_CONNECT_TTL_MS,
      activeIdleTtlMs: ACTIVE_IDLE_TTL_MS,
      maxPhotoBytes: overrides.maxPhotoBytes ?? MAX_PHOTO_BYTES,
      maxPhotos: overrides.maxPhotos ?? 4,
      width: 1280,
      maxWidth: 6000,
      sliceHeight: 1200,
      sliceOverlap: 120,
      maxSlices: 30,
    },
  });
}

interface Surface {
  readonly app: Hono;
  readonly database: AuthorityDatabase;
  readonly clock: ReturnType<typeof manualClock>;
  readonly artifacts: ReturnType<typeof createContentAddressedArtifactWriter>;
  /** The journaled command path, for the one state no route can reach. */
  readonly commands: ReturnType<typeof createDashboardCommandService>;
  /** The kernel's own id factory, so a minted outbox id stays findable. */
  readonly kernelIds: ReturnType<typeof sequentialIdFactory>;
  /** The next pinned token this harness will mint. */
  readonly nextToken: () => string;
}

interface SurfaceOptions {
  readonly config?: Config;
  readonly bindings?: Readonly<Record<string, CaptureIntakeBinding>>;
}

function surface(options: SurfaceOptions = {}): Surface {
  const root = mkdtempSync(join(tmpdir(), "hrauto-capture-surface-"));
  const stateRoot = join(root, ".tracker-rebuild");
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 1000, migrationOwner: "capture-surface-test" },
    clock,
  );
  cleanups.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  database.withAuthorityTransaction((repositories) => repositories.configSnapshots.insert(CONFIG_SNAPSHOT));

  const artifacts = createContentAddressedArtifactWriter({
    workspaceRoot: root,
    artifactRoot: ".tracker-rebuild/artifacts",
  });
  const descriptors = {
    resolve: (workflowId: string) =>
      (workflowId === CAPTURE_FIXTURE_WORKFLOW_ID ? captureFixtureDescriptor : undefined),
  };
  const configIdentity = {
    configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: UUID_1,
  };

  const projection = createRunQueueProjection({
    stateRoot,
    clock,
    appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([captureFixtureDescriptor.contractFingerprint]),
    ledger: createLedgerReadThrough(stateRoot),
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      listNotifications: () => [],
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId: string) => database.authority.workerLeases.get(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      isArchived: (runId: string) => database.authority.archivedRuns.isArchived(runId),
      getFailure: (failureId: string) => database.authority.failures.get(failureId),
      getReceipt: (runId: string) => database.authority.evidenceReceipts.findByRun(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors,
    projectionStore: database,
  });
  const spans = createSpanJsonlWriter({
    stateRoot,
    clock,
    pid: 4242,
    // D218: no in-process hook — the command service ticks the disk tail.
  });

  const kernelIds = sequentialIdFactory("a");
  const kernel = createCommandKernel({
    appVersion: "0.1.0",
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids: kernelIds,
    configIdentity,
    descriptors,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: {
      resolvePresent: () => { throw new Error("write resolution is not wired in this harness"); },
      resolveAbsent: () => { throw new Error("write resolution is not wired in this harness"); },
    },
    workerRuntime: {
      planWorkerCount: () => { throw new Error("the worker runtime is not wired in this harness"); },
      spawnWorker: () => { throw new Error("the worker runtime is not wired in this harness"); },
      refreshBrowser: () => { throw new Error("the worker runtime is not wired in this harness"); },
      reopenBrowser: () => { throw new Error("the worker runtime is not wired in this harness"); },
    },
  });
  const commands = createDashboardCommandService({
    kernel,
    clock,
    spans,
    projection,
    descriptors,
    authorityRead: {
      getRun: (runId) => database.authority.runs.get(runId),
      getStartPlan: (startPlanId) => database.authority.startPlans.get(startPlanId),
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
      getIntakeManifest: (manifestId) => database.authority.intakeManifests.get(manifestId),
    },
  });

  // 43 base64url characters, minted in order, so a test can name the token it
  // is about to be handed and a refusal arm can hold one that was never minted.
  let tokenSequence = 0;
  const mintToken = (): string => {
    tokenSequence += 1;
    const tail = String(tokenSequence);
    return `${"t".repeat(43 - tail.length)}${tail}`;
  };

  const capture = composeCaptureSurface({
    database,
    artifacts,
    appVersion: "0.1.0",
    commands,
    descriptors,
    bindings: options.bindings ?? {},
    config: options.config ?? captureConfig(),
    configIdentity,
    env: {},
    clock,
    ids: sequentialIdFactory("b"),
    mintToken,
  });

  const startPlans = createStartPlanService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: database,
    descriptors,
    clock,
    ids: sequentialIdFactory("c"),
    planTtlMs: 10 * 60 * 1000,
    configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: UUID_1,
    plannedBy: LOCAL_OPERATOR_ACTOR_ID,
  });
  const hub = createDashboardStreamHub({ projection, backfillGaps: UNOBSERVED_BACKFILL_GAP_NOTIFIER });
  cleanups.push(() => hub.close());

  const app = createDashboardApp({
    intake: UNWIRED_INTAKE_SERVICE,
    capture,
    preflight: healthyDashboardPreflightExecutor(clock),
    bootstrap: {
      appVersion: "0.1.0",
      clock,
      modules: [{ descriptor: captureFixtureDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }],
      descriptorSetHash: descriptorSetHash([captureFixtureDescriptor.contractFingerprint]),
      settingsSchemaHash: descriptorSetHash(["settings-schema"]),
      projection,
      authorityMeta: () => database.getMeta(),
      backupSummary: () => "missing",
      preflightReport: () => healthyDashboardPreflightReport(clock),
      // No advisory provider is composed in this harness (D178).
      advisoryAvailability: () => ({
        state: "unavailable",
        code: "not-configured",
        reason: "no ai.advisory provider is composed in this harness",
      }),
    },
    projection,
    archive: archiveQueryDeps({
      database,
      clock,
      appVersion: "0.1.0",
      descriptors: [captureFixtureDescriptor],
    }),
    runDetail: {
      stateRoot,
      projection,
      authority: {
        getRun: (runId) => database.authority.runs.get(runId),
        latestCheckpoint: (workflowId, itemId, nodeId) =>
          database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
        getWriteIntent: (writeIntentId) => database.authority.writeIntents.get(writeIntentId),
        listGateResults: (runId) => database.authority.gateResults.listByRun(runId),
      },
      descriptors,
      trust: createReceiptService({ database, descriptors: [captureFixtureDescriptor] }),
    },
    commands,
    startPlans,
    hub,
    // D274 item 6 — the read-only Settings status sections read the SAME
    // resolved config and descriptor tuple this harness composes everything else
    // from, so nothing on that page can be true here and false in production.
    settings: { config: resolveConfig({}, {}, clock), descriptors: [captureFixtureDescriptor] },
    storage: {
      doctorOptions: {
        authorityPath: join(root, "state.db"),
        spanRoot: stateRoot,
        backupDirectory: join(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 45 * 60 * 1000,
        busyTimeoutMs: 1000,
      },
      clock,
      serviceState: () => ({ state: "never-run", reason: "the test harness runs no backup lane" }),
    },
    explorer: explorerQueryDeps(clock, descriptorSetHash(["explorer-harness"])),
    uiCatalog: uiCatalogQueryDeps(),
  });

  return {
    app,
    database,
    clock,
    artifacts,
    commands,
    kernelIds,
    nextToken: () => `${"t".repeat(43 - String(tokenSequence + 1).length)}${String(tokenSequence + 1)}`,
  };
}

/**
 * This session's ONE finalization outbox row, for a given generation.
 *
 * It is found through the ids the KERNEL minted rather than by recomputing the
 * stable key here: a test that re-derives the key would agree with itself even
 * if the kernel folded something else into it.
 */
function outboxFor(h: Surface, sessionId: string, generation: number): CaptureFinalizationOutbox {
  const outboxes = h.database.authority.captureFinalizationOutboxes;
  const rows = h.kernelIds.minted().flatMap((id) => {
    const row = outboxes.get(id);
    return row !== undefined && String(row.sessionId) === sessionId && row.generation === generation
      ? [row]
      : [];
  });
  if (rows.length !== 1) {
    throw new Error(
      `capture session ${sessionId} holds ${String(rows.length)} finalization outboxes at generation `
      + `${String(generation)}; exactly one is the contract`,
    );
  }
  return rows[0];
}

/* ── route drivers ───────────────────────────────────────────────────────── */

interface StartRequest {
  readonly workflow?: string;
  readonly formType?: string;
  readonly contextHint?: string;
}

async function startCapture(app: Hono, request: StartRequest = {}): Promise<Response> {
  return app.request("/api/v1/capture/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workflow: request.workflow ?? CAPTURE_FIXTURE_WORKFLOW_ID,
      ...(request.formType === undefined ? {} : { formType: request.formType }),
      ...(request.contextHint === undefined ? {} : { contextHint: request.contextHint }),
    }),
  });
}

/** Starts a session the happy way and hands back its token and first wire. */
async function openSession(
  app: Hono,
  request: StartRequest = {},
): Promise<{ token: string; session: CaptureSessionWire }> {
  const response = await startCapture(app, request);
  assert.equal(response.status, 201);
  const result = CaptureStartResultSchema.parse(await response.json());
  if (result.state !== "started") {
    throw new Error(`the fixture capture start was refused: ${result.message}`);
  }
  return { token: result.token, session: result.session };
}

function phoneHeaders(token: string): Record<string, string> {
  return { [CAPTURE_TOKEN_HEADER]: token };
}

async function readPhoneSession(app: Hono, token: string): Promise<Response> {
  return app.request("/api/v1/capture/phone/session", { headers: phoneHeaders(token) });
}

async function uploadPhoto(
  app: Hono,
  token: string,
  photo: Readonly<{ photoId: string; expectedVersion: number; bytes: Uint8Array; mediaType?: string }>,
): Promise<Response> {
  const query = new URLSearchParams({
    commandId: commandId(),
    expectedVersion: String(photo.expectedVersion),
    photoId: photo.photoId,
  });
  return app.request(`/api/v1/capture/phone/photos?${query.toString()}`, {
    method: "POST",
    headers: { ...phoneHeaders(token), "content-type": photo.mediaType ?? "image/jpeg" },
    body: photo.bytes.slice().buffer,
  });
}

async function replacePhoto(
  app: Hono,
  token: string,
  photo: Readonly<{ photoId: string; expectedVersion: number; bytes: Uint8Array; mediaType?: string }>,
): Promise<Response> {
  const query = new URLSearchParams({
    commandId: commandId(),
    expectedVersion: String(photo.expectedVersion),
  });
  return app.request(`/api/v1/capture/phone/photos/${photo.photoId}?${query.toString()}`, {
    method: "PUT",
    headers: { ...phoneHeaders(token), "content-type": photo.mediaType ?? "image/png" },
    body: photo.bytes.slice().buffer,
  });
}

async function deletePhoto(app: Hono, token: string, photoId: string, expectedVersion: number): Promise<Response> {
  const query = new URLSearchParams({ commandId: commandId(), expectedVersion: String(expectedVersion) });
  return app.request(`/api/v1/capture/phone/photos/${photoId}?${query.toString()}`, {
    method: "DELETE",
    headers: phoneHeaders(token),
  });
}

async function readPhotoBytes(app: Hono, token: string, photoId: string): Promise<Response> {
  return app.request(`/api/v1/capture/phone/photos/${photoId}/bytes`, { headers: phoneHeaders(token) });
}

async function reorderPhotos(
  app: Hono,
  token: string,
  orderedPhotoIds: readonly string[],
  expectedVersion: number,
): Promise<Response> {
  return app.request("/api/v1/capture/phone/order", {
    method: "POST",
    headers: { ...phoneHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ commandId: commandId(), expectedVersion, orderedPhotoIds }),
  });
}

async function phoneVerb(app: Hono, token: string, verb: string, expectedVersion: number): Promise<Response> {
  return app.request(`/api/v1/capture/phone/${verb}`, {
    method: "POST",
    headers: { ...phoneHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ commandId: commandId(), expectedVersion }),
  });
}

async function wire(response: Response): Promise<CaptureSessionWire> {
  const text = await response.text();
  assert.equal(
    response.status,
    200,
    `expected a session wire, got ${String(response.status)}: ${text}`,
  );
  return CaptureSessionWireSchema.parse(JSON.parse(text));
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function bytesOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

/** Uploads the two real photographs and returns the wire that holds both. */
async function withTwoPhotos(
  app: Hono,
  token: string,
  session: CaptureSessionWire,
): Promise<CaptureSessionWire> {
  const connected = await wire(await readPhoneSession(app, token));
  assert.equal(connected.version, session.version + 1);
  const first = await wire(await uploadPhoto(app, token, {
    photoId: PHOTO_A,
    expectedVersion: connected.version,
    bytes: JPEG,
    mediaType: "image/jpeg",
  }));
  return wire(await uploadPhoto(app, token, {
    photoId: PHOTO_B,
    expectedVersion: first.version,
    bytes: PNG,
    mediaType: "image/png",
  }));
}

async function drain(artifacts: Surface["artifacts"], ref: ArtifactRef): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of await artifacts.open(ref)) chunks.push(Buffer.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

/* ── 1. start and ingress ────────────────────────────────────────────────── */

describe("capture start — the credential exists once", () => {
  it("mints a session whose token rides the FRAGMENT and whose row holds only a digest", async () => {
    const h = surface();
    const expected = h.nextToken();
    const response = await startCapture(h.app, {
      formType: CAPTURE_FIXTURE_FORM_TYPE,
      contextHint: CONTEXT_EID,
    });
    assert.equal(response.status, 201);
    const result = CaptureStartResultSchema.parse(await response.json());
    assert.equal(result.state, "started");
    if (result.state !== "started") return;

    assert.equal(result.token, expected, "the pinned mint is what the operator was handed");
    assert.equal(result.ingressMode, "forwarded");
    assert.equal(result.session.state, "open");
    assert.equal(result.session.version, 1);
    assert.equal(result.session.formType, CAPTURE_FIXTURE_FORM_TYPE);
    assert.deepEqual(result.session.photos, []);
    assert.equal(result.session.handoff.state, "pending");
    assert.equal(
      result.session.expiresAt,
      new Date(Date.parse(NOW) + PRE_CONNECT_TTL_MS).toISOString(),
      "the pre-connect budget is ref data-intake-and-edit-data §5.1's, from the clock and nothing else",
    );

    // The token is a credential: a fragment is never transmitted to a server,
    // so it can ride a QR without ever reaching an access log.
    const url = new URL(result.phoneUrl);
    assert.equal(url.origin, FORWARDED_ORIGIN);
    assert.equal(url.pathname, "/capture.html");
    assert.equal(url.search, "", "a credential may never be a query parameter");
    assert.equal(url.hash, `#t=${result.token}`);

    const stored = h.database.authority.captureSessions.get(result.session.sessionId);
    assert.notEqual(stored, undefined);
    assert.equal(stored?.tokenDigest, deriveCaptureTokenDigest(result.token));
    assert.equal(stored?.ingress?.mode, "forwarded");
    assert.ok(
      !JSON.stringify(stored).includes(result.token),
      "the raw token must never reach the durable row",
    );
  });

  it("refuses a disabled ingress with a remediation, and mints no session", async () => {
    const h = surface({ config: captureConfig({ ingress: "disabled" }) });
    const response = await startCapture(h.app);
    assert.equal(response.status, 409, "a refused ingress is a configuration answer, not a fault");
    const result = CaptureStartResultSchema.parse(await response.json());
    assert.equal(result.state, "refused");
    if (result.state !== "refused") return;
    assert.equal(result.code, "ingress-disabled");
    assert.match(result.remediation, /forwarded/);
    assert.equal(
      h.database.authority.captureSessions.listActive().length,
      0,
      "a session the phone could never reach must not exist",
    );
  });

  /**
   * The ngrok credential is read from a file in the operator's home directory,
   * not from the environment, so these two arms are driven through the
   * resolver's own injection seam — the one place presence is a decision this
   * process makes. The route half (409, a remediation, and no session row) is
   * proved by the `disabled` arm above, which reaches the identical branch.
   */
  it("names the two on-demand-ngrok refusals apart", () => {
    const config = captureConfig({ ingress: "on-demand-ngrok" });
    const missing = createCaptureIngressResolver({ config, ngrokCredentialPresent: () => false })();
    assert.equal(missing.state, "refused");
    if (missing.state !== "refused") return;
    assert.equal(missing.code, "ingress-credential-missing");
    assert.match(missing.remediation, /authtoken|forwarded/);

    const present = createCaptureIngressResolver({ config, ngrokCredentialPresent: () => true })();
    assert.equal(present.state, "refused");
    if (present.state !== "refused") return;
    assert.equal(
      present.code,
      "ingress-not-built",
      "a present credential must not make an unbuilt launcher look ready",
    );
    assert.match(present.message, /not built/);
    assert.match(present.remediation, /forwarded/);
  });

  it("refuses an on-demand-ngrok start at the route, whichever half is missing", async () => {
    const h = surface({ config: captureConfig({ ingress: "on-demand-ngrok" }) });
    const response = await startCapture(h.app);
    assert.equal(response.status, 409);
    const result = CaptureStartResultSchema.parse(await response.json());
    assert.equal(result.state, "refused");
    if (result.state !== "refused") return;
    // WHICH of the two is a fact about the machine's own ngrok config, which
    // is why the codes are told apart through the resolver above. What the
    // route owes either way is a named refusal with a remediation and no row.
    assert.ok(
      ["ingress-credential-missing", "ingress-not-built"].includes(result.code),
      `an on-demand-ngrok start answered ${result.code}`,
    );
    assert.match(result.remediation, /forwarded/);
    assert.equal(h.database.authority.captureSessions.listActive().length, 0);
  });

  it("refuses a workflow nothing registers, and mints no session", async () => {
    const h = surface();
    const response = await startCapture(h.app, { workflow: "person-lookup" });
    assert.equal(response.status, 404);
    const failure = await body(response);
    assert.equal(failure.code, "TARGET_NOT_FOUND");
    assert.match(String(failure.message), /person-lookup is not registered/);
    assert.equal(h.database.authority.captureSessions.listActive().length, 0);
  });
});

/* ── 2. fail-closed enumeration ──────────────────────────────────────────── */

describe("capture enumeration — one refusal, byte for byte", () => {
  it("answers unknown, malformed, absent, expired and discarded tokens identically", async () => {
    const h = surface();

    // One session that will EXPIRE, and one the operator DISCARDS. Both hold
    // real tokens, so a difference in either answer would be a real oracle.
    const expiring = await openSession(h.app);
    const discarding = await openSession(h.app);
    const connected = await wire(await readPhoneSession(h.app, discarding.token));
    const discarded = await wire(
      await phoneVerb(h.app, discarding.token, "discard", connected.version),
    );
    assert.equal(discarded.state, "discarded");

    h.clock.advanceWall(PRE_CONNECT_TTL_MS + 1);

    const unmintedToken = "u".repeat(43);
    const responses = [
      await readPhoneSession(h.app, unmintedToken),
      await readPhoneSession(h.app, "not-a-token"),
      await h.app.request("/api/v1/capture/phone/session"),
      await readPhoneSession(h.app, expiring.token),
      await readPhoneSession(h.app, discarding.token),
    ];
    const statuses = responses.map((response) => response.status);
    const bodies = await Promise.all(responses.map((response) => response.text()));

    assert.deepEqual(statuses, [404, 404, 404, 404, 404]);
    for (const [index, text] of bodies.entries()) {
      assert.equal(
        text,
        bodies[0],
        `refusal ${String(index)} differs from the first; the difference IS the oracle`,
      );
    }
    // …and the one answer says nothing about which session, if any, exists.
    const refusal = JSON.parse(bodies[0]) as Record<string, unknown>;
    assert.equal(refusal.code, "CAPTURE_UNKNOWN_SESSION");
    assert.ok(!String(refusal.message).includes(expiring.session.sessionId));
    assert.ok(!String(refusal.message).includes(discarding.session.sessionId));
  });

  it("writes expiry to the row, rather than filtering it out of the answer", async () => {
    const h = surface();
    const { token, session } = await openSession(h.app);
    assert.equal(h.database.authority.captureSessions.get(session.sessionId)?.state, "open");

    h.clock.advanceWall(PRE_CONNECT_TTL_MS + 1);
    assert.equal((await readPhoneSession(h.app, token)).status, 404);

    const stored = h.database.authority.captureSessions.get(session.sessionId);
    assert.equal(stored?.state, "expired", "a restarted dashboard must not reopen a closed window");
    assert.equal(stored?.version, session.version + 1);
  });

  it("stamps connectedAt once and extends the budget once", async () => {
    const h = surface();
    const { token, session } = await openSession(h.app);
    assert.equal(session.connectedAt, undefined);

    h.clock.advanceWall(60_000);
    const first = await wire(await readPhoneSession(h.app, token));
    const connectedAt = new Date(Date.parse(NOW) + 60_000).toISOString();
    assert.equal(first.connectedAt, connectedAt);
    assert.equal(first.version, session.version + 1);
    assert.equal(
      first.expiresAt,
      new Date(Date.parse(connectedAt) + ACTIVE_IDLE_TTL_MS).toISOString(),
      "the active budget replaces the pre-connect one, at connect",
    );

    h.clock.advanceWall(60_000);
    const second = await wire(await readPhoneSession(h.app, token));
    assert.equal(second.version, first.version, "a GET that rewrote authority would be a mutation");
    assert.equal(second.connectedAt, connectedAt);
    assert.equal(second.expiresAt, first.expiresAt, "the budget is set once, it does not slide");
  });
});

/* ── 3. the photo lifecycle ──────────────────────────────────────────────── */

describe("capture photos — real bytes, real artifacts", () => {
  it("holds two photographs in order and serves their exact bytes back", async () => {
    const h = surface();
    const { token, session } = await openSession(h.app);
    const held = await withTwoPhotos(h.app, token, session);

    assert.deepEqual(
      held.photos.map((photo) => [photo.ordinal, photo.mediaType, photo.bytes]),
      [[1, "image/jpeg", JPEG.byteLength], [2, "image/png", PNG.byteLength]],
    );

    const stored = h.database.authority.captureSessions.get(session.sessionId);
    assert.deepEqual(
      stored?.photoRefs.map((photo) => String(photo.artifact.sha256)),
      [digest(JPEG), digest(PNG)],
    );

    for (const [photoId, expected, mediaType] of [
      [PHOTO_A, JPEG, "image/jpeg"],
      [PHOTO_B, PNG, "image/png"],
    ] as const) {
      const response = await readPhotoBytes(h.app, token, photoId);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), mediaType);
      assert.deepEqual(await bytesOf(response), expected, `${photoId} read back different bytes`);
    }
  });

  it("treats the same photo again as a no-op and refuses the same id with different bytes", async () => {
    const h = surface();
    const { token, session } = await openSession(h.app);
    const connected = await wire(await readPhoneSession(h.app, token));
    const uploaded = await wire(await uploadPhoto(h.app, token, {
      photoId: PHOTO_A,
      expectedVersion: connected.version,
      bytes: JPEG,
    }));

    const again = await wire(await uploadPhoto(h.app, token, {
      photoId: PHOTO_A,
      expectedVersion: uploaded.version,
      bytes: JPEG,
    }));
    assert.equal(again.version, uploaded.version, "a content-level repeat mints no version");
    assert.equal(again.photos.length, 1, "and no second photograph");

    const conflicting = await uploadPhoto(h.app, token, {
      photoId: PHOTO_A,
      expectedVersion: again.version,
      bytes: PNG,
      mediaType: "image/png",
    });
    assert.equal(conflicting.status, 422);
    const refusal = await body(conflicting);
    assert.equal(refusal.code, "CAPTURE_INVALID_STATE");
    assert.match(String(refusal.message), /capture-replace is the arm for changing a photo/);
    assert.equal(
      h.database.authority.captureSessions.get(session.sessionId)?.version,
      again.version,
      "a refused upload leaves the row alone",
    );
  });

  it("replaces, deletes and reorders while ordinals stay contiguous from 1", async () => {
    const h = surface();
    const { token, session } = await openSession(h.app);
    const held = await withTwoPhotos(h.app, token, session);

    const replaced = await wire(await replacePhoto(h.app, token, {
      photoId: PHOTO_A,
      expectedVersion: held.version,
      bytes: PNG,
      mediaType: "image/png",
    }));
    assert.equal(replaced.photos[0].mediaType, "image/png");
    assert.equal(replaced.photos[0].bytes, PNG.byteLength);
    assert.deepEqual(replaced.photos.map((photo) => photo.ordinal), [1, 2]);

    const reordered = await wire(
      await reorderPhotos(h.app, token, [PHOTO_B, PHOTO_A], replaced.version),
    );
    assert.deepEqual(
      reordered.photos.map((photo) => [String(photo.photoId), photo.ordinal]),
      [[PHOTO_B, 1], [PHOTO_A, 2]],
    );

    const notAPermutation = await reorderPhotos(h.app, token, [PHOTO_B, PHOTO_C], reordered.version);
    assert.equal(notAPermutation.status, 422);
    assert.match(String((await body(notAPermutation)).message), /exact permutation/);

    const afterDelete = await wire(
      await deletePhoto(h.app, token, PHOTO_B, reordered.version),
    );
    assert.deepEqual(
      afterDelete.photos.map((photo) => [String(photo.photoId), photo.ordinal]),
      [[PHOTO_A, 1]],
      "order is meaning: the survivor closes the gap",
    );
  });

  it("refuses an unreadable upload by name and leaves authority untouched", async () => {
    const h = surface({ config: captureConfig({ maxPhotoBytes: 1024 }) });
    const { token, session } = await openSession(h.app);
    const connected = await wire(await readPhoneSession(h.app, token));

    const cases: readonly [string, number, string, Uint8Array, string][] = [
      ["a document is not a photograph", 422, "CAPTURE_UNSUPPORTED_MEDIA_TYPE", JPEG, "application/pdf"],
      ["an empty body", 422, "CAPTURE_EMPTY_UPLOAD", new Uint8Array(0), "image/jpeg"],
      ["over the byte limit", 422, "CAPTURE_UPLOAD_TOO_LARGE", new Uint8Array(1025), "image/jpeg"],
    ];
    for (const [what, status, code, bytes, mediaType] of cases) {
      const response = await uploadPhoto(h.app, token, {
        photoId: PHOTO_A,
        expectedVersion: connected.version,
        bytes,
        mediaType,
      });
      assert.equal(response.status, status, what);
      assert.equal((await body(response)).code, code, what);
    }

    const unknownPhoto = await replacePhoto(h.app, token, {
      photoId: PHOTO_C,
      expectedVersion: connected.version,
      bytes: PNG,
    });
    assert.equal(unknownPhoto.status, 422);
    assert.equal((await body(unknownPhoto)).code, "CAPTURE_UNKNOWN_PHOTO");

    const stored = h.database.authority.captureSessions.get(session.sessionId);
    assert.equal(stored?.version, connected.version, "four refusals wrote nothing");
    assert.deepEqual(stored?.photoRefs, []);
  });
});

/* ── 4. finalize and the handoff ─────────────────────────────────────────── */

/** The ids the handoff derives, which exist whether or not it ran. */
function derivedHandoffIds(stableKey: string): { runId: string; manifestId: string } {
  return {
    runId: deriveStableUuid("hrauto:capture-run:v1", stableKey),
    manifestId: deriveStableUuid("hrauto:capture-manifest:v1", stableKey),
  };
}

describe("capture finalize — the production path, where nothing declares a binding", () => {
  it("fails durably, names the missing declaration, and enqueues nothing", async () => {
    // The REAL production state: `CAPTURE_INTAKE_BINDINGS` is empty.
    const h = surface({ bindings: CAPTURE_INTAKE_BINDINGS });
    const { token, session } = await openSession(h.app, { contextHint: CONTEXT_EID });
    const held = await withTwoPhotos(h.app, token, session);

    const finalized = await wire(await phoneVerb(h.app, token, "finalize", held.version));
    assert.equal(finalized.state, "failed", "a handoff that could not run is never a silent success");
    assert.equal(finalized.handoff.state, "failed");
    if (finalized.handoff.state !== "failed") return;
    assert.match(
      finalized.handoff.message,
      /declares no capture intake binding/,
      "the operator holding the phone must be told WHY, not that something went wrong",
    );
    assert.ok(
      finalized.handoff.message.includes(CAPTURE_FIXTURE_WORKFLOW_ID),
      "the message names the workflow whose declaration is missing",
    );
    assert.equal(finalized.finalizationGeneration, 1);
    assert.equal(finalized.finalArtifact, undefined);

    const stored = h.database.authority.captureSessions.get(session.sessionId);
    assert.equal(stored?.state, "failed");
    assert.equal(stored?.handoff.state, "failed");

    assert.deepEqual(
      h.database.authority.captureFinalizationOutboxes.listPending(),
      [],
      "the outbox settled rather than waiting forever",
    );

    const outbox = outboxFor(h, session.sessionId, 1);
    assert.equal(outbox.state, "failed");
    assert.equal(
      String(outbox.failureId),
      stored?.handoff.state === "failed" ? String(stored.handoff.failureId) : "",
      "session and outbox name ONE failure",
    );

    // Nothing downstream exists — proved by the exact ids a handoff would have
    // used, which are a function of the outbox that DOES exist.
    const ids = derivedHandoffIds(String(outbox.stableKey));
    assert.equal(h.database.authority.runs.get(ids.runId), undefined, "ZERO runs");
    assert.equal(h.database.authority.intakeManifests.get(ids.manifestId), undefined, "ZERO manifests");
  });

  it("refuses a discard while the outbox is still in flight", async () => {
    const h = surface({ bindings: CAPTURE_INTAKE_BINDINGS });
    const { token, session } = await openSession(h.app, { contextHint: CONTEXT_EID });
    const held = await withTwoPhotos(h.app, token, session);

    // The phone's own finalize drains the outbox before it answers, so a
    // `finalizing` session is not reachable through that route — it is what a
    // CRASH leaves behind. The journaled command alone reproduces it exactly.
    const finalizing = h.commands.execute({
      commandId: commandId(),
      requestedAt: h.clock.now().toISOString(),
      requestedBy: LOCAL_OPERATOR_ACTOR_ID,
      source: "dashboard",
      family: "capture",
      type: "capture-finalize",
      target: { captureSessionId: session.sessionId, expectedVersion: held.version },
    });
    assert.equal(finalizing.state, "applied");
    assert.equal(h.database.authority.captureSessions.get(session.sessionId)?.state, "finalizing");
    assert.equal(h.database.authority.captureFinalizationOutboxes.listPending().length, 1);

    const refused = await phoneVerb(h.app, token, "discard", held.version + 1);
    assert.equal(refused.status, 422);
    const refusal = await body(refused);
    assert.equal(refusal.code, "CAPTURE_INVALID_STATE");
    assert.match(String(refusal.message), /is finalizing/);
    assert.equal(
      h.database.authority.captureSessions.get(session.sessionId)?.state,
      "finalizing",
      "a bundle in flight is not thrown away on the operator's behalf",
    );
  });

  it("discards from open and from failed", async () => {
    const h = surface({ bindings: CAPTURE_INTAKE_BINDINGS });

    const fromOpen = await openSession(h.app);
    const connected = await wire(await readPhoneSession(h.app, fromOpen.token));
    const discarded = await wire(
      await phoneVerb(h.app, fromOpen.token, "discard", connected.version),
    );
    assert.equal(discarded.state, "discarded");

    const fromFailed = await openSession(h.app, { contextHint: CONTEXT_EID });
    const held = await withTwoPhotos(h.app, fromFailed.token, fromFailed.session);
    const failed = await wire(await phoneVerb(h.app, fromFailed.token, "finalize", held.version));
    assert.equal(failed.state, "failed");
    const discardedFromFailed = await wire(
      await phoneVerb(h.app, fromFailed.token, "discard", failed.version),
    );
    assert.equal(discardedFromFailed.state, "discarded");
  });
});

describe("capture finalize — with a workflow that declares a binding", () => {
  const bindings = { [CAPTURE_FIXTURE_WORKFLOW_ID]: captureFixtureBinding };

  it("produces one manifest, one queued run, and a real multi-page PDF", async () => {
    const h = surface({ bindings });
    const { token, session } = await openSession(h.app, {
      formType: CAPTURE_FIXTURE_FORM_TYPE,
      contextHint: CONTEXT_EID,
    });
    const held = await withTwoPhotos(h.app, token, session);
    const finalized = await wire(await phoneVerb(h.app, token, "finalize", held.version));

    assert.equal(finalized.state, "finalized");
    assert.equal(finalized.handoff.state, "enqueued");
    if (finalized.handoff.state !== "enqueued") return;
    const { runId, intakeManifestId } = finalized.handoff;
    assert.notEqual(finalized.finalArtifact, undefined);

    const manifest = h.database.authority.intakeManifests.get(intakeManifestId);
    assert.notEqual(manifest, undefined);
    assert.equal(String(manifest?.workflow), CAPTURE_FIXTURE_WORKFLOW_ID);
    assert.equal(String(manifest?.capture?.captureSessionId), session.sessionId);
    assert.equal(manifest?.capture?.finalizationGeneration, 1);
    assert.deepEqual(
      manifest?.capture?.orderedPhotoSha256.map((sha) => String(sha)),
      [digest(JPEG), digest(PNG)],
      "the manifest names the ordered photographs the bundle was built from",
    );
    assert.equal(
      String(manifest?.source.sha256),
      String(finalized.finalArtifact?.sha256),
      "the manifest's source IS the bundle",
    );
    assert.deepEqual(
      h.database.authority.intakeManifests
        .findBySource(String(finalized.finalArtifact?.sha256))
        .map((entry) => String(entry.manifestId)),
      [intakeManifestId],
      "exactly one manifest, ever",
    );

    const run = h.database.authority.runs.get(runId);
    assert.notEqual(run, undefined);
    assert.equal(run?.lifecycle.state, "queued");
    assert.equal(String(run?.envelope.workflow), CAPTURE_FIXTURE_WORKFLOW_ID);
    assert.equal(run?.envelope.dryRun, false);
    assert.equal(run?.envelope.priority, "interactive");
    const expectedItemId = deriveItemId(
      CAPTURE_FIXTURE_WORKFLOW_ID,
      `capture-document:${String(finalized.finalArtifact?.sha256)}`,
    );
    assert.equal(String(run?.envelope.itemId), expectedItemId);
    assert.equal(manifest?.totals.valid, 1, "one bundle is one row");
    assert.deepEqual(
      manifest?.validRows.map((row) => String(row.itemId)),
      [expectedItemId],
      "manifest and run name ONE item",
    );
    assert.ok(
      String(run?.envelope.traceId).startsWith(`${CAPTURE_FIXTURE_CODE}-`),
      "the trace id is the descriptor's code plus this run's own head",
    );
    assert.ok(String(run?.envelope.traceId).endsWith(runId.slice(0, 4)));
    assert.deepEqual(
      h.database.authority.runs
        .listByItem({ workflow: CAPTURE_FIXTURE_WORKFLOW_ID, itemId: expectedItemId })
        .map((entry) => String(entry.envelope.runId)),
      [runId],
      "exactly one run, ever",
    );

    const stored = h.database.authority.captureSessions.get(session.sessionId);
    const outbox = outboxFor(h, session.sessionId, 1);
    assert.equal(outbox.state, "done");
    assert.equal(String(outbox.runId), runId);
    assert.equal(String(outbox.intakeManifestId), intakeManifestId);
    assert.equal(stored?.state, "finalized");

    const bundleRef = stored?.finalArtifact;
    assert.notEqual(bundleRef, undefined, "a finalized session names its bundle");
    if (bundleRef === undefined) return;
    const pdf = Buffer.from(await drain(h.artifacts, bundleRef)).toString("latin1");
    assert.ok(pdf.startsWith("%PDF-"), "the bundle is a real PDF, produced by the real bundler");
    assert.match(pdf, /\/Type \/Pages \/Count 2/, "one page per photograph");
    assert.equal(
      pdf.match(/\/Type \/Page[^s]/g)?.length,
      2,
      "and the page objects to back the count",
    );
    assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  });

  it("converges on replay: the projector enqueues nothing more, and the ids are a pure fold", async () => {
    const h = surface({ bindings });
    const { token, session } = await openSession(h.app, {
      formType: CAPTURE_FIXTURE_FORM_TYPE,
      contextHint: CONTEXT_EID,
    });
    const held = await withTwoPhotos(h.app, token, session);
    const finalized = await wire(await phoneVerb(h.app, token, "finalize", held.version));
    assert.equal(finalized.handoff.state, "enqueued");
    if (finalized.handoff.state !== "enqueued") return;

    // The seam's promise is that a REPLAY returns the same identities, which is
    // only true if they are folded rather than minted: the same key twice must
    // agree, a different key must not, and both must be what actually landed.
    const stableKey = String(outboxFor(h, session.sessionId, 1).stableKey);
    assert.deepEqual(
      derivedHandoffIds(stableKey),
      derivedHandoffIds(stableKey),
      "the identities are a function of the stable key and nothing else",
    );
    assert.notEqual(
      derivedHandoffIds(stableKey).runId,
      derivedHandoffIds(`${stableKey.slice(0, -1)}0`).runId,
      "a different bundle is a different run, so the fold is not a constant",
    );
    assert.equal(derivedHandoffIds(stableKey).runId, finalized.handoff.runId);
    assert.equal(derivedHandoffIds(stableKey).manifestId, finalized.handoff.intakeManifestId);

    // A second read of the same session is the phone polling for "Sent"; a
    // second projector pass is what a restart runs. Neither may enqueue again.
    const afterReplay = await wire(await readPhoneSession(h.app, token));
    assert.equal(afterReplay.version, finalized.version, "a settled outbox is never re-projected");
    assert.deepEqual(h.database.authority.captureFinalizationOutboxes.listPending(), []);
    assert.deepEqual(
      h.database.authority.runs
        .listByItem({
          workflow: CAPTURE_FIXTURE_WORKFLOW_ID,
          itemId: deriveItemId(
            CAPTURE_FIXTURE_WORKFLOW_ID,
            `capture-document:${String(finalized.finalArtifact?.sha256)}`,
          ),
        })
        .length,
      1,
    );
  });

  it("retries a failed handoff into generation 2 over the same photos, with ONE handoff overall", async () => {
    // The declaration lands BETWEEN the two attempts — the composition seam's
    // own `bindings` input is what changes, which is exactly what a redeploy
    // looks like from the outbox's point of view. The photo set never moves.
    const declared: Record<string, CaptureIntakeBinding> = {};
    const h = surface({ bindings: declared });
    const { token, session } = await openSession(h.app, {
      formType: CAPTURE_FIXTURE_FORM_TYPE,
      contextHint: CONTEXT_EID,
    });
    const held = await withTwoPhotos(h.app, token, session);
    const failed = await wire(await phoneVerb(h.app, token, "finalize", held.version));
    assert.equal(failed.state, "failed");
    assert.equal(failed.finalizationGeneration, 1);

    declared[CAPTURE_FIXTURE_WORKFLOW_ID] = captureFixtureBinding;
    const retried = await wire(await phoneVerb(h.app, token, "retry-finalize", failed.version));
    assert.equal(retried.state, "finalized");
    assert.equal(retried.finalizationGeneration, 2, "retry mints the NEXT generation");
    assert.equal(retried.handoff.state, "enqueued");
    if (retried.handoff.state !== "enqueued") return;
    assert.deepEqual(
      retried.photos.map((photo) => [String(photo.photoId), photo.ordinal]),
      [[PHOTO_A, 1], [PHOTO_B, 2]],
      "the same photo set, unchanged",
    );

    assert.deepEqual(h.database.authority.captureFinalizationOutboxes.listPending(), []);
    assert.equal(
      h.database.authority.runs
        .listByItem({
          workflow: CAPTURE_FIXTURE_WORKFLOW_ID,
          itemId: deriveItemId(
            CAPTURE_FIXTURE_WORKFLOW_ID,
            `capture-document:${String(retried.finalArtifact?.sha256)}`,
          ),
        })
        .length,
      1,
      "exactly one handoff overall — the failed generation enqueued nothing",
    );
  });
});

/* ── 5. the registry ─────────────────────────────────────────────────────── */

describe("capture intake registry — a binding is a declaration, not a shape", () => {
  it("refuses a binding that never went through the factory", () => {
    assert.throws(
      () => captureIntakeRegistry([{
        descriptor: captureFixtureDescriptor,
        captureIntake: handBuiltCaptureBinding,
      }]),
      (error: Error) => error.message.includes(CAPTURE_FIXTURE_WORKFLOW_ID)
        && /defineCaptureIntakeBinding/.test(error.message),
    );
  });

  it("refuses a binding built over a COPY of the descriptor's input schema", () => {
    assert.throws(
      () => captureIntakeRegistry([{
        descriptor: captureFixtureDescriptor,
        captureIntake: captureFixtureCopiedSchemaBinding,
      }]),
      (error: Error) => error.message.includes(CAPTURE_FIXTURE_WORKFLOW_ID)
        && /different input\s+schema object/.test(error.message),
    );
    // The honest one, over the SAME object, is admitted.
    assert.equal(captureFixtureBinding.inputSchema, CaptureFixtureInput);
    assert.deepEqual(
      Object.keys(captureIntakeRegistry([{
        descriptor: captureFixtureDescriptor,
        captureIntake: captureFixtureBinding,
      }])),
      [CAPTURE_FIXTURE_WORKFLOW_ID],
    );
  });

  it("is EMPTY in this product, and that is the honest state", () => {
    assert.deepEqual(
      Object.keys(CAPTURE_INTAKE_BINDINGS),
      [],
      "no registered workflow can turn a photograph into its input yet; the day one can, "
      + "read src/core/capture-intake-handoff.ts before changing this line",
    );
  });
});

/* ── 6. the operator projection — the desktop half (D274 item 7) ─────────── */

async function operatorSession(app: Hono, sessionId: string): Promise<CaptureOperatorSessionWire> {
  const response = await app.request(`/api/v1/capture/sessions/${sessionId}`);
  const text = await response.text();
  assert.equal(response.status, 200, `expected the operator wire, got ${String(response.status)}: ${text}`);
  return CaptureOperatorSessionWireSchema.parse(JSON.parse(text));
}

async function operatorList(app: Hono): Promise<CaptureOperatorSessionListWire> {
  const response = await app.request("/api/v1/capture/sessions");
  const text = await response.text();
  assert.equal(response.status, 200, `expected the operator list, got ${String(response.status)}: ${text}`);
  return CaptureOperatorSessionListWireSchema.parse(JSON.parse(text));
}

describe("capture operator projection — phase, expiry, pages", () => {
  it("walks awaiting-phone → awaiting-pages → receiving over recorded facts, and reads write nothing", async () => {
    const h = surface();
    const { token, session } = await openSession(h.app);

    const opened = await operatorSession(h.app, session.sessionId);
    assert.equal(opened.phase, "awaiting-phone");
    assert.equal(opened.state, "open");
    assert.deepEqual(opened.pages, []);
    assert.equal(opened.expiresAt, new Date(Date.parse(NOW) + PRE_CONNECT_TTL_MS).toISOString());

    const listed = await operatorList(h.app);
    assert.equal(listed.sessions.length, 1);
    assert.equal(listed.sessions[0]?.phase, "awaiting-phone");
    assert.equal(listed.sessions[0]?.pageCount, 0);

    const connected = await wire(await readPhoneSession(h.app, token));
    const paired = await operatorSession(h.app, session.sessionId);
    assert.equal(paired.phase, "awaiting-pages");
    assert.notEqual(paired.connectedAt, undefined);

    await withTwoPhotos(h.app, token, session);
    const receiving = await operatorSession(h.app, session.sessionId);
    assert.equal(receiving.phase, "receiving");
    assert.equal(receiving.pages.length, 2);
    assert.deepEqual(
      receiving.pages.map((page) => [page.ordinal, page.mediaType, page.image]),
      [
        [1, "image/jpeg", { state: "readable", pixelWidth: 16, pixelHeight: 12 }],
        [2, "image/png", { state: "readable", pixelWidth: 10, pixelHeight: 14 }],
      ],
      "the contact sheet is the recorded order, each page at its OWN geometry",
    );
    assert.equal(receiving.pages[0]?.bytes, JPEG.byteLength);
    assert.equal(receiving.pages[1]?.bytes, PNG.byteLength);

    // The projection is a READ: three operator GETs wrote no version.
    const stored = h.database.authority.captureSessions.get(session.sessionId);
    assert.equal(stored?.version, connected.version + 2, "connect + two uploads, and nothing else");
  });

  it("serves the unreadable-page fact as the bundler's own refusal, before finalize agrees", async () => {
    const h = surface({ bindings: CAPTURE_INTAKE_BINDINGS });
    const { token, session } = await openSession(h.app, { contextHint: CONTEXT_EID });
    const connected = await wire(await readPhoneSession(h.app, token));
    const garbage = new TextEncoder().encode("bytes that are not a photograph at all");
    const held = await wire(await uploadPhoto(h.app, token, {
      photoId: PHOTO_A,
      expectedVersion: connected.version,
      bytes: garbage,
      mediaType: "image/jpeg",
    }));

    const before = await operatorSession(h.app, session.sessionId);
    assert.equal(before.phase, "receiving");
    const image = before.pages[0]?.image;
    assert.equal(image?.state, "unreadable");
    if (image?.state !== "unreadable") return;
    assert.ok(image.reason.includes(PHOTO_A), "the refusal names the page it refuses");

    // Finalize now fails on the SAME bytes — the desktop warned first.
    const finalized = await wire(await phoneVerb(h.app, token, "finalize", held.version));
    assert.equal(finalized.state, "failed");
    const after = await operatorSession(h.app, session.sessionId);
    assert.equal(after.phase, "blocked");
    assert.equal(after.handoff.state, "failed");
    if (after.handoff.state !== "failed") return;
    assert.ok(after.handoff.message.length > 0, "the operator reads the projector's own reason");
  });

  it("writes expiry durably on the operator read and drops the session from the active list", async () => {
    const h = surface();
    const { session } = await openSession(h.app);
    h.clock.advanceWall(PRE_CONNECT_TTL_MS + 1);

    const expired = await operatorSession(h.app, session.sessionId);
    assert.equal(expired.phase, "expired");
    assert.equal(expired.state, "expired");
    assert.equal(
      h.database.authority.captureSessions.get(session.sessionId)?.state,
      "expired",
      "the row is right, not merely the answer",
    );
    assert.deepEqual((await operatorList(h.app)).sessions, [], "an expired session is not active");
  });

  it("is already expired AT the boundary instant, not only strictly after it", async () => {
    const h = surface();
    const { session } = await openSession(h.app);
    // Exactly the TTL, not one ms past it: `expiresAt` and `now` coincide.
    h.clock.advanceWall(PRE_CONNECT_TTL_MS);

    const expired = await operatorSession(h.app, session.sessionId);
    assert.equal(expired.phase, "expired");
    assert.equal(expired.state, "expired");
    assert.equal(
      h.database.authority.captureSessions.get(session.sessionId)?.state,
      "expired",
      "the boundary instant is already overdue, durably",
    );
  });

  it("lists the active set oldest first, keeps a blocked session visible, excludes a discarded one", async () => {
    const h = surface({ bindings: CAPTURE_INTAKE_BINDINGS });
    const first = await openSession(h.app, { contextHint: CONTEXT_EID });
    const second = await openSession(h.app);

    // First session: photos then a binding-less finalize → durable failed.
    const held = await withTwoPhotos(h.app, first.token, first.session);
    const failed = await wire(await phoneVerb(h.app, first.token, "finalize", held.version));
    assert.equal(failed.state, "failed");

    // Second session: discarded by the phone.
    const connected = await wire(await readPhoneSession(h.app, second.token));
    await wire(await phoneVerb(h.app, second.token, "discard", connected.version));

    const listed = await operatorList(h.app);
    assert.deepEqual(
      listed.sessions.map((row) => [row.sessionId, row.phase, row.pageCount]),
      [[first.session.sessionId, "blocked", 2]],
      "failed stays on the desk; discarded leaves it",
    );

    // …while the discarded session remains readable BY ID for the desk that started it.
    const discarded = await operatorSession(h.app, second.session.sessionId);
    assert.equal(discarded.phase, "discarded");
  });

  it("orders TWO simultaneously active sessions oldest first", async () => {
    const h = surface();
    const first = await openSession(h.app);
    h.clock.advanceWall(1000);
    const second = await openSession(h.app);

    // Both stay "open" — active and unresolved — so an order bug cannot hide
    // behind either session having left the active set.
    const listed = await operatorList(h.app);
    assert.deepEqual(
      listed.sessions.map((row) => row.sessionId),
      [first.session.sessionId, second.session.sessionId],
      "the active set is the oldest session first, not creation order reversed",
    );
  });

  it("answers ready after a bound finalize, with the bundle's recorded identity", async () => {
    const h = surface({ bindings: { [CAPTURE_FIXTURE_WORKFLOW_ID]: captureFixtureBinding } });
    const { token, session } = await openSession(h.app, {
      formType: CAPTURE_FIXTURE_FORM_TYPE,
      contextHint: CONTEXT_EID,
    });
    const held = await withTwoPhotos(h.app, token, session);
    const finalized = await wire(await phoneVerb(h.app, token, "finalize", held.version));
    assert.equal(finalized.state, "finalized");

    const ready = await operatorSession(h.app, session.sessionId);
    assert.equal(ready.phase, "ready");
    assert.equal(ready.handoff.state, "enqueued");
    assert.deepEqual(ready.finalArtifact, finalized.finalArtifact);
    assert.equal(ready.formType, CAPTURE_FIXTURE_FORM_TYPE);
  });

  it("refuses an absent session as not-found and a malformed id as invalid — two arms, never conflated", async () => {
    const h = surface();
    const absent = await h.app.request("/api/v1/capture/sessions/99999999-8888-4777-8666-555555555555");
    assert.equal(absent.status, 404);
    assert.equal((await body(absent)).code, "TARGET_NOT_FOUND");

    const malformed = await h.app.request("/api/v1/capture/sessions/not-a-session-id");
    assert.equal(malformed.status, 400);
    assert.equal((await body(malformed)).code, "SCHEMA_INVALID");
  });
});
