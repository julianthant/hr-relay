/** DCA3 cases retained by intent from 7a85bbd596f00ba4052ce1dddd13cd40c8a897ac;
 * D292 uses real SQLite bundle/index authority and the public live queries. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import type { z } from "zod";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../src/domain/artifacts.js";
import { CaptureListSchema } from "../../../src/domain/dashboard/run-detail.js";
import { createServerVerifiedArtifactReader } from "../../../src/infra/artifacts/server-verified-artifact-reader.js";
import { deriveDiagnosticContentDigest } from "../../../src/domain/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema, type DiagnosticBundle } from "../../../src/domain/trust/diagnostic.js";
import { DiagnosticBundleIdSchema, FailureIdSchema, RunIdSchema } from "../../../src/domain/ids.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { DiagnosticBundleCorruptError, SectionUnavailableError, TargetNotFoundError } from "../../../src/server/failures.js";
import {
  buildRunDetail,
  readRunDetail,
  readRunSection,
  type RunDetailQueryDeps,
} from "../../../src/server/dashboard/queries/run-detail.js";
import { HASH_A, HASH_B, NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { RGBA_PNG_BASE64 } from "../../fixtures/diagnostic-image-fixtures.js";
import { makeWorld, queuedEventOf, uuidOf } from "./helpers/dashboard-harness.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

const BYTES = Buffer.from("[]");
const ATTACHMENT = {
  kind: "console-summary" as const, artifactId: uuidOf(31), mediaType: "application/json" as const,
  byteLength: BYTES.byteLength, digest: createHash("sha256").update(BYTES).digest("hex"),
  sensitivity: "redacted" as const,
};

function refOf(attachment: typeof ATTACHMENT): ArtifactRef {
  return ArtifactRefSchema.parse({
    id: attachment.artifactId,
    sha256: attachment.digest,
    bytes: attachment.byteLength,
    mediaType: attachment.mediaType,
  });
}

function writeArtifactEnvelope(
  workspaceRoot: string,
  ref: ArtifactRef,
  bytes: Uint8Array,
  storedRef: ArtifactRef = ref,
): void {
  const artifactRoot = join(workspaceRoot, ".tracker", "artifacts");
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, `${ref.sha256}.artifact`), JSON.stringify({
    ref: storedRef,
    payloadBase64: Buffer.from(bytes).toString("base64"),
  }));
}

type BundleInput = z.input<typeof DiagnosticBundleSchema>;
function bundleOf(bundleSeed: number, origin: BundleInput["origin"], options: {
  runId?: string; attachments?: BundleInput["attachments"];
} = {}): DiagnosticBundle {
  const content = {
    runId: options.runId ?? uuidOf(1), origin, capturedAt: NOW,
    configFingerprint: HASH_A, descriptorFingerprint: HASH_B,
    redaction: { fields: [], warnings: [] }, attachments: options.attachments ?? [ATTACHMENT],
  };
  const { capturedAt, ...stored } = content;
  return DiagnosticBundleSchema.parse({
    ...stored, bundleId: uuidOf(bundleSeed), createdAt: capturedAt,
    contentDigest: deriveDiagnosticContentDigest(content),
    retention: { kind: "ordinary", purgeAfter: "2026-09-02T17:00:00.000Z" },
  });
}

function harness() {
  const world = makeWorld();
  cleanups.push(() => world.dispose());
  queuedEventOf(world, { seed: 1 });
  const database = AuthorityDatabase.open({
    path: join(world.stateRoot, "capture-authority.db"), busyTimeoutMs: 1000,
    migrationOwner: "run-detail-captures-test",
  }, world.clock);
  cleanups.push(() => database.close());
  const run = world.authority.getRun(uuidOf(1));
  assert.ok(run);
  database.authority.runs.enqueue({ ...run, envelope: {
    ...run.envelope, contractFingerprint: personLookupDescriptor.contractFingerprint,
  } });
  writeArtifactEnvelope(world.stateRoot, refOf(ATTACHMENT), BYTES);
  const sourceReads: number[] = [];
  const artifactReader = createServerVerifiedArtifactReader({
    workspaceRoot: world.stateRoot,
    artifactRoot: ".tracker/artifacts",
    observeIo: (kind, bytes) => {
      if (kind === "source-read") sourceReads.push(bytes);
    },
  });
  const captures = { authority: database.authority.diagnosticBundles, artifactReader };
  const deps: RunDetailQueryDeps = {
    stateRoot: world.stateRoot, projection: world.projection,
    authority: { ...world.authority, getRun: (id) => database.authority.runs.get(id) },
    descriptors: { resolve: () => undefined }, captures,
  };
  return {
    deps,
    captures,
    database,
    artifactReader,
    sourceReads,
    world,
    removeArtifact: (ref: ArtifactRef) =>
      rmSync(join(world.stateRoot, ".tracker", "artifacts", `${ref.sha256}.artifact`)),
    writeArtifact: (ref: ArtifactRef, bytes: Uint8Array, storedRef: ArtifactRef = ref) =>
      writeArtifactEnvelope(world.stateRoot, ref, bytes, storedRef),
  };
}

function recordFailure(database: AuthorityDatabase): void {
  const workerId = "capture-test-worker";
  const claimed = database.authority.runs.claimNext({ workflow: "person-lookup", workerId, now: NOW });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed") throw new Error("capture fixture was not claimed");
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const validating = database.authority.runs.transition({
    runId: uuidOf(1), expectedVersion: claimed.run.version, claim, now: NOW,
    lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW },
  });
  assert.equal(validating.state, "applied");
  if (validating.state !== "applied") throw new Error("capture fixture did not validate");
  const run = validating.run;
  database.terminalizeFailure(personLookupDescriptor, {
    failure: {
      failureId: uuidOf(40), fingerprint: HASH_A, runId: uuidOf(1),
      traceId: run.envelope.traceId, attempt: run.envelope.attempt, workflowId: "person-lookup",
      code: "INPUT_INVALID", summary: "capture fixture failed validation", transient: false,
      writeState: "not-attempted", occurredAt: NOW,
      causeChain: [{ code: "INPUT_INVALID", summary: "invalid input", role: "primary", transient: false }],
      remediation: [{ kind: "operator-action", message: "Correct the input" }],
    },
    authorization: {
      kind: "failed", runId: uuidOf(1), workflowId: "person-lookup", attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
      expectedVersion: run.version, claim, authorizedAt: NOW, failureId: uuidOf(40),
    },
  });
}

describe("DCA3/D292 run capture authority", () => {
  it("refuses an empty verified capture index rather than projecting a plausible empty receipt", () => {
    assert.equal(CaptureListSchema.safeParse({ runId: uuidOf(301), artifacts: [] }).success, false);
  });

  it("keeps synchronous archive-shaped details field-absent while live reads name capture absence", async () => {
    const world = makeWorld();
    const runId = uuidOf(301);
    queuedEventOf(world, { seed: 301 });
    const deps = {
      stateRoot: world.stateRoot,
      projection: world.projection,
      authority: world.authority,
      descriptors: { resolve: () => undefined },
    };
    try {
      const synchronous = buildRunDetail(deps, runId);
      assert.equal(Object.hasOwn(synchronous, "captures"), false);
      assert.equal(synchronous.availableSections.includes("captures"), false);

      const live = await readRunDetail(deps, runId);
      assert.equal(Object.hasOwn(live, "captures"), true);
      assert.deepEqual(live.captures, {
        state: "absent",
        reason: "this composition wires no diagnostic capture authority",
      });
      assert.equal(live.availableSections.includes("captures"), false);
    } finally {
      world.dispose();
    }
  });

  it("states indexed absence without opening bytes or advertising a lazy list", async () => {
    const h = harness();
    const detail = await readRunDetail(h.deps, uuidOf(1));
    assert.deepEqual(detail.captures, { state: "absent", reason: "this run has no indexed diagnostic capture artifacts" });
    assert.equal(detail.availableSections.includes("captures"), false);
    await assert.rejects(() => readRunSection(h.deps, uuidOf(1), "captures"), SectionUnavailableError);
    assert.equal(h.sourceReads.length, 0);
  });

  it("names an uncomposed capture authority instead of claiming an empty index", async () => {
    const { captures: _captures, ...deps } = harness().deps;
    assert.deepEqual((await readRunDetail(deps, uuidOf(1))).captures,
      { state: "absent", reason: "this composition wires no diagnostic capture authority" });
  });

  it("states absence for a verified bundle with no attachments", async () => {
    const h = harness();
    h.database.authority.diagnosticBundles.insert(bundleOf(32, { kind: "operator-request", requestedBy: "local-operator" }, { attachments: [] }));
    assert.deepEqual((await readRunDetail(h.deps, uuidOf(1))).captures,
      { state: "absent", reason: "this run has no indexed diagnostic capture artifacts" });
    assert.equal(h.sourceReads.length, 0);
  });

  it("excludes another run's real bundle even when it shares this artifact", async () => {
    const h = harness();
    queuedEventOf(h.world, { seed: 2 });
    const otherRun = h.world.authority.getRun(uuidOf(2));
    assert.ok(otherRun);
    h.database.authority.runs.enqueue(otherRun);
    const origin = { kind: "operator-request" as const, requestedBy: "local-operator" };
    h.database.authority.diagnosticBundles.insert(bundleOf(32, origin));
    h.database.authority.diagnosticBundles.insert(bundleOf(33, origin, { runId: uuidOf(2) }));
    const section = await readRunSection(h.deps, uuidOf(1), "captures");
    assert.equal(section.section, "captures");
    if (section.section !== "captures") throw new Error("wrong section");
    assert.deepEqual(section.payload.artifacts[0]?.origins, [{ bundleId: uuidOf(32), originKind: "operator-request" }]);
    assert.equal(canonicalJsonStringify(section).includes(uuidOf(33)), false);
  });

  it("serves one artifact with every verified mixed-origin membership from this run", async () => {
    const h = harness();
    recordFailure(h.database);
    h.database.authority.diagnosticBundles.insert(bundleOf(32, { kind: "failure", failureId: uuidOf(40) }));
    h.database.authority.diagnosticBundles.insert(bundleOf(33, { kind: "operator-request", requestedBy: "local-operator" }));

    const section = await readRunSection(h.deps, uuidOf(1), "captures");

    assert.deepEqual(section, {
      section: "captures", payload: { runId: uuidOf(1), artifacts: [{
        artifact: {
          mediaKind: "data", artifactId: uuidOf(31), mediaType: "application/json",
          byteLength: 2, sha256: ATTACHMENT.digest, sensitivity: "redacted", redaction: "applied",
        },
        origins: [{ bundleId: uuidOf(32), originKind: "failure" },
          { bundleId: uuidOf(33), originKind: "operator-request" }],
      }] },
    });
    assert.deepEqual((await readRunDetail(h.deps, uuidOf(1))).captures, { state: "available", artifactCount: 1 });
  });

  it("serves every ordered origin from many same-run bundles sharing one artifact exactly once", async () => {
    const h = harness();
    recordFailure(h.database);
    const failureId = uuidOf(40);
    const bundles: readonly Readonly<{ seed: number; origin: BundleInput["origin"] }>[] = [
      { seed: 50, origin: { kind: "failure", failureId } },
      { seed: 51, origin: { kind: "operator-request", requestedBy: "local-operator" } },
      { seed: 52, origin: { kind: "unexpected-state", failureId } },
      { seed: 53, origin: { kind: "subject-mismatch", failureId } },
      { seed: 54, origin: { kind: "recovery-park", failureId } },
      { seed: 55, origin: { kind: "operator-request", requestedBy: "local-operator" } },
      { seed: 56, origin: { kind: "failure", failureId } },
      { seed: 57, origin: { kind: "unexpected-state", failureId } },
      { seed: 58, origin: { kind: "subject-mismatch", failureId } },
      { seed: 59, origin: { kind: "recovery-park", failureId } },
      { seed: 60, origin: { kind: "operator-request", requestedBy: "local-operator" } },
      { seed: 61, origin: { kind: "failure", failureId } },
    ];
    for (const { seed, origin } of bundles) {
      h.database.authority.diagnosticBundles.insert(bundleOf(seed, origin));
    }

    const section = await readRunSection(h.deps, uuidOf(1), "captures");

    assert.deepEqual(section, {
      section: "captures",
      payload: {
        runId: uuidOf(1),
        artifacts: [{
          artifact: {
            mediaKind: "data", artifactId: uuidOf(31), mediaType: "application/json",
            byteLength: 2, sha256: ATTACHMENT.digest, sensitivity: "redacted", redaction: "applied",
          },
          origins: [
            { bundleId: uuidOf(50), originKind: "failure" },
            { bundleId: uuidOf(51), originKind: "operator-request" },
            { bundleId: uuidOf(52), originKind: "unexpected-state" },
            { bundleId: uuidOf(53), originKind: "subject-mismatch" },
            { bundleId: uuidOf(54), originKind: "recovery-park" },
            { bundleId: uuidOf(55), originKind: "operator-request" },
            { bundleId: uuidOf(56), originKind: "failure" },
            { bundleId: uuidOf(57), originKind: "unexpected-state" },
            { bundleId: uuidOf(58), originKind: "subject-mismatch" },
            { bundleId: uuidOf(59), originKind: "recovery-park" },
            { bundleId: uuidOf(60), originKind: "operator-request" },
            { bundleId: uuidOf(61), originKind: "failure" },
          ],
        }],
      },
    });
    assert.equal(h.sourceReads.length, 1,
      "one captures request reuses only the completed exact-ref proof across all supporting bundles");
    assert.deepEqual((await readRunDetail(h.deps, uuidOf(1))).captures, {
      state: "available",
      artifactCount: 1,
    });
    assert.equal(h.sourceReads.length, 2,
      "a later request performs a new whole-byte verification pass");
  });

  it.each(["failure", "unexpected-state", "subject-mismatch", "recovery-park", "operator-request"] as const)(
    "preserves the literal %s origin without failure details or actor data", async (kind) => {
      const h = harness();
      recordFailure(h.database);
      const bundle = bundleOf(32, kind === "operator-request"
        ? { kind, requestedBy: "local-operator" } : { kind, failureId: uuidOf(40) });
      h.database.authority.diagnosticBundles.insert(bundle);

      const section = await readRunSection(h.deps, uuidOf(1), "captures");

      assert.equal(section.section, "captures");
      if (section.section !== "captures") throw new Error("wrong section");
      assert.deepEqual(section.payload.artifacts[0]?.origins, [{ bundleId: uuidOf(32), originKind: kind }]);
      assert.doesNotMatch(canonicalJsonStringify(section), /failureId|requestedBy|local-operator|capture fixture failed/u);
    },
  );

  it("keeps capture refs lazy while serving verified availability", async () => {
    const h = harness();
    h.database.authority.diagnosticBundles.insert(bundleOf(32, { kind: "operator-request", requestedBy: "local-operator" }));
    const detail = await readRunDetail(h.deps, uuidOf(1));
    assert.deepEqual(detail.captures, { state: "available", artifactCount: 1 });
    assert.equal(detail.availableSections.includes("captures"), true);
    assert.equal(canonicalJsonStringify(detail).includes(uuidOf(31)), false);
    assert.equal(h.sourceReads.length, 1);
  });

  it.each(["missing", "digest", "size"] as const)("keeps %s bytes visibly corrupt on both public reads", async (fault) => {
    const h = harness();
    h.database.authority.diagnosticBundles.insert(bundleOf(32, { kind: "operator-request", requestedBy: "local-operator" }));
    const ref = refOf(ATTACHMENT);
    if (fault === "missing") h.removeArtifact(ref);
    else h.writeArtifact(ref, Buffer.from(fault === "digest" ? "{}" : "[bad]"));

    const detail = await readRunDetail(h.deps, uuidOf(1));
    assert.equal(detail.captures?.state, "error");
    if (detail.captures?.state !== "error") throw new Error("expected capture error");
    assert.equal(
      detail.captures.code,
      fault === "missing" ? "DIAGNOSTIC_BUNDLE_BYTES_MISSING" : "DIAGNOSTIC_BUNDLE_CORRUPT",
    );
    assert.equal(detail.captures.retryable, false);
    assert.doesNotMatch(detail.captures.message, /PRIVATE_PATH|\[bad\]/u);
    assert.equal(detail.availableSections.includes("captures"), false);
    await assert.rejects(() => readRunSection(h.deps, uuidOf(1), "captures"), DiagnosticBundleCorruptError);
  });

  it.each(["foreign", "duplicate", "conflicting-origin", "malformed", "missing-origin"] as const)(
    "refuses a %s run index before any exact readback or byte open", async (fault) => {
      const h = harness();
      const bundle = bundleOf(32, { kind: "operator-request", requestedBy: "local-operator" });
      const other = fault === "foreign" ? { ...bundle, runId: RunIdSchema.parse(uuidOf(2)) }
        : fault === "malformed" ? { ...bundle, untrusted: "PRIVATE_PATH" }
          : fault === "conflicting-origin" ? { ...bundle, origin: { kind: "failure" as const, failureId: FailureIdSchema.parse(uuidOf(40)) } }
            : { ...bundle };
      if (fault === "missing-origin") Reflect.deleteProperty(other, "origin");
      const get = vi.fn(h.captures.authority.get);
      const deps = { ...h.deps, captures: { ...h.captures,
        authority: { ...h.captures.authority, listByRun: () => [bundle, other], get },
      } };
      const detail = await readRunDetail(deps, uuidOf(1));
      assert.equal(detail.captures?.state, "error");
      if (detail.captures?.state !== "error") throw new Error("expected capture error");
      assert.doesNotMatch(detail.captures.message, new RegExp(`${uuidOf(2)}|PRIVATE_PATH`, "u"));
      await assert.rejects(() => readRunSection(deps, uuidOf(1), "captures"), DiagnosticBundleCorruptError);
      assert.equal(get.mock.calls.length, 0);
      assert.equal(h.sourceReads.length, 0);
    },
  );

  it("refuses a valid re-digested exact readback whose origin differs from the run index", async () => {
    const h = harness();
    recordFailure(h.database);
    const listed = bundleOf(32, { kind: "operator-request", requestedBy: "local-operator" });
    const stored = bundleOf(32, { kind: "failure", failureId: uuidOf(40) });
    h.database.authority.diagnosticBundles.insert(stored);
    const deps = { ...h.deps, captures: { ...h.captures,
      authority: { ...h.captures.authority, listByRun: () => [listed] },
    } };
    await assert.rejects(() => readRunSection(deps, uuidOf(1), "captures"), /exact-id readback disagrees with the run index/u);
  });

  it.each(["missing-bundle", "foreign-bundle", "changed-origin", "missing-index", "changed-index"] as const)(
    "refuses %s exact verification instead of serving a plausible capture", async (fault) => {
      const h = harness();
      const bundle = bundleOf(32, { kind: "operator-request", requestedBy: "local-operator" });
      h.database.authority.diagnosticBundles.insert(bundle);
      const real = h.captures.authority;
      const deps = { ...h.deps, captures: { ...h.captures, authority: {
        ...real,
        get: (id: string) => fault === "missing-bundle" ? undefined
          : fault === "foreign-bundle" ? { ...bundle, bundleId: DiagnosticBundleIdSchema.parse(uuidOf(33)) }
            : fault === "changed-origin" ? { ...bundle, origin: { kind: "failure" as const, failureId: FailureIdSchema.parse(uuidOf(40)) } }
              : real.get(id),
        listAttachments: (id: string) => fault === "missing-index" ? []
          : fault === "changed-index" ? real.listAttachments(id).map((row) => ({ ...row, attachment: { ...row.attachment, byteLength: 3 } }))
            : real.listAttachments(id),
      } } };
      const detail = await readRunDetail(deps, uuidOf(1));
      assert.equal(detail.captures?.state, "error");
      assert.equal(detail.availableSections.includes("captures"), false);
      await assert.rejects(() => readRunSection(deps, uuidOf(1), "captures"), DiagnosticBundleCorruptError);
      assert.equal(h.sourceReads.length, 0);
    },
  );

  it("refuses individually verified bundles that disagree on a shared artifact's dimensions", async () => {
    const h = harness();
    const png = Buffer.from(RGBA_PNG_BASE64, "base64");
    const image = { ...ATTACHMENT, kind: "screenshot" as const, mediaType: "image/png" as const,
      digest: createHash("sha256").update(png).digest("hex"), byteLength: png.byteLength, width: 16, height: 12 };
    h.writeArtifact(ArtifactRefSchema.parse({
      id: image.artifactId,
      sha256: image.digest,
      bytes: image.byteLength,
      mediaType: image.mediaType,
    }), png);
    const origin = { kind: "operator-request" as const, requestedBy: "local-operator" as const };
    h.database.authority.diagnosticBundles.insert(bundleOf(32, origin, { attachments: [image] }));
    h.database.authority.diagnosticBundles.insert(bundleOf(33, origin, { attachments: [{ ...image, width: 17 }] }));
    const detail = await readRunDetail(h.deps, uuidOf(1));
    assert.equal(detail.captures?.state, "error");
    if (detail.captures?.state !== "error") throw new Error("expected capture error");
    assert.match(detail.captures.message, /conflicting verified metadata/u);
    await assert.rejects(() => readRunSection(h.deps, uuidOf(1), "captures"), /conflicting verified metadata/u);
  });

  it.each(["not-an-id", uuidOf(999)])("refuses unavailable run %s before capture authority", async (runId) => {
    const h = harness();
    const listByRun = vi.fn(h.captures.authority.listByRun);
    const deps = { ...h.deps, captures: { ...h.captures, authority: { ...h.captures.authority, listByRun } } };
    const expected = runId === "not-an-id" ? /uuid|invalid/iu : TargetNotFoundError;
    await assert.rejects(() => readRunDetail(deps, runId), expected);
    await assert.rejects(() => readRunSection(deps, runId, "captures"), expected);
    assert.equal(listByRun.mock.calls.length, 0);
    assert.equal(h.sourceReads.length, 0);
  });
});
