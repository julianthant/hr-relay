import { join } from "node:path";
import { RuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { ActorIdSchema, DiagnosticBundleIdSchema, FailureIdSchema } from "../../../src/domain/ids.js";
import { DiagnosticBundleSchema, type DiagnosticBundle } from "../../../src/domain/trust/diagnostic.js";
import { deriveDiagnosticContentDigest } from "../../../src/domain/trust/diagnostic-capture.js";
import { createServerVerifiedArtifactReader } from "../../../src/infra/artifacts/server-verified-artifact-reader.js";
import { buildReceiptFailureSection } from "../../../src/server/dashboard/queries/run-detail/receipts-failures.js";
import { DiagnosticBundleCorruptError } from "../../../src/server/failures.js";
import { HASH_A, HASH_B, NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { trustWorld } from "./helpers/trust-authority-fixture.js";

const worlds: ReturnType<typeof trustWorld>[] = [];
afterEach(() => { for (const world of worlds.splice(0).reverse()) world.dispose(); });

function fixture() {
  const f = trustWorld();
  worlds.push(f);
  const run = f.fail(f.create(301), 302);
  const failure = f.database.authority.failures.listByRun(run.envelope.runId).at(-1);
  assert.ok(failure);
  const captures = {
    authority: f.database.authority.diagnosticBundles,
    artifactReader: createServerVerifiedArtifactReader({
      admission: RuntimeAdmission.syntheticRoots(join(f.world.stateRoot, ".tracker"), join(f.world.stateRoot, ".tracker/artifacts")),
    }),
  };
  const bundle = (seed: number, origin: DiagnosticBundle["origin"], runId = run.envelope.runId) => {
    const content = {
      runId,
      origin,
      capturedAt: NOW,
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      redaction: { fields: [], warnings: [] },
      attachments: [],
    };
    const { capturedAt, ...stored } = content;
    return DiagnosticBundleSchema.parse({
      ...stored,
      bundleId: `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`,
      createdAt: capturedAt,
      contentDigest: deriveDiagnosticContentDigest(content),
      retention: { kind: "pinned", reason: "write-recovery" },
    });
  };
  const trustWithBundle = (diagnosticBundleId?: string) => ({
      ...f.receipts,
      getFailure: (failureId: string) => {
        const current = f.receipts.getFailure(failureId);
        return current === undefined || diagnosticBundleId === undefined
          ? current
          : { ...current, diagnosticBundleId: DiagnosticBundleIdSchema.parse(diagnosticBundleId) };
      },
    });
  const read = (diagnosticBundleId?: string, captureAuthority = captures.authority) => {
    return buildReceiptFailureSection({
      ...f.deps,
      trust: trustWithBundle(diagnosticBundleId),
      captures: { ...captures, authority: captureAuthority },
    }, run.envelope.runId, "failure");
  };
  const readWithoutCaptures = (diagnosticBundleId: string) => buildReceiptFailureSection({
    ...f.deps,
    trust: trustWithBundle(diagnosticBundleId),
    captures: undefined,
  }, run.envelope.runId, "failure");
  return { f, run, failure, captures, bundle, read, readWithoutCaptures };
}

function availableFailure(response: ReturnType<typeof buildReceiptFailureSection>) {
  assert.equal(response.section, "failure");
  if (response.section !== "failure" || response.payload.state !== "available") {
    throw new Error("failure evidence was not available");
  }
  return response.payload.value;
}

describe("run-detail failure diagnostic-bundle linkage", () => {
  it("keeps an unlinked failure's capture absent", () => {
    const h = fixture();
    const value = availableFailure(buildReceiptFailureSection(h.f.deps, h.run.envelope.runId, "failure"));
    assert.equal(value.diagnosticBundle.state, "absent");
  });

  it.each([
    { kind: "failure" as const },
    { kind: "subject-mismatch" as const },
    { kind: "recovery-park" as const },
    { kind: "unexpected-state" as const },
  ])("serves a bundle linked to this run and failure origin: $kind", ({ kind }) => {
    const h = fixture();
    const row = h.bundle(303, { kind, failureId: h.failure.failureId });
    h.f.database.authority.diagnosticBundles.insert(row);
    const before = canonicalJsonStringify(h.failure);
    const value = availableFailure(h.read(row.bundleId));
    assert.deepEqual(value.diagnosticBundle, { state: "present", bundleId: row.bundleId });
    assert.equal(canonicalJsonStringify(h.f.database.authority.failures.get(h.failure.failureId)), before);
  });

  it("fails loudly when a failure names a bundle but capture authority is absent", () => {
    const h = fixture();
    const row = h.bundle(304, { kind: "failure", failureId: h.failure.failureId });
    assert.throws(() => h.readWithoutCaptures(row.bundleId), DiagnosticBundleCorruptError);
  });

  it("fails loudly when the exact bundle record is missing", () => {
    const h = fixture();
    const row = h.bundle(305, { kind: "failure", failureId: h.failure.failureId });
    assert.throws(() => h.read(row.bundleId), DiagnosticBundleCorruptError);
  });

  it("fails loudly when a named bundle belongs to another run", () => {
    const h = fixture();
    const foreignRun = h.f.create(306).envelope.runId;
    const row = h.bundle(307, { kind: "failure", failureId: h.failure.failureId }, foreignRun);
    const authority = {
      ...h.captures.authority,
      get: (id: string) => id === row.bundleId ? row : h.captures.authority.get(id),
    };
    assert.throws(() => h.read(row.bundleId, authority), DiagnosticBundleCorruptError);
  });

  it("fails loudly when the origin belongs to a different failure or an operator request", () => {
    const h = fixture();
    const wrongFailure = h.bundle(308, {
      kind: "failure",
      failureId: FailureIdSchema.parse("00000000-0000-4000-8000-000000000309"),
    });
    const wrongFailureAuthority = {
      ...h.captures.authority,
      get: (id: string) => id === wrongFailure.bundleId ? wrongFailure : h.captures.authority.get(id),
    };
    assert.throws(() => h.read(wrongFailure.bundleId, wrongFailureAuthority), DiagnosticBundleCorruptError);

    const operatorBundle = h.bundle(310, {
      kind: "operator-request",
      requestedBy: ActorIdSchema.parse("local-operator"),
    });
    const operatorAuthority = {
      ...h.captures.authority,
      get: (id: string) => id === operatorBundle.bundleId ? operatorBundle : h.captures.authority.get(id),
    };
    assert.throws(() => h.read(operatorBundle.bundleId, operatorAuthority), DiagnosticBundleCorruptError);
  });

  it("requires exact membership and matching contents between lookup and run index", () => {
    const h = fixture();
    const row = h.bundle(311, { kind: "failure", failureId: h.failure.failureId });
    const indexedElsewhere = {
      ...h.captures.authority,
      get: (id: string) => id === row.bundleId ? row : h.captures.authority.get(id),
      listByRun: (runId: string) => runId === h.run.envelope.runId
        ? []
        : h.captures.authority.listByRun(runId),
    };
    assert.throws(() => h.read(row.bundleId, indexedElsewhere), DiagnosticBundleCorruptError);

    h.f.database.authority.diagnosticBundles.insert(row);
    const substituted = { ...row, retention: { kind: "pinned" as const, reason: "fix" as const } };
    const disagreeing = {
      ...h.captures.authority,
      get: (id: string) => id === row.bundleId ? row : h.captures.authority.get(id),
      listByRun: (runId: string) => runId === h.run.envelope.runId
        ? [substituted]
        : h.captures.authority.listByRun(runId),
    };
    assert.throws(() => h.read(row.bundleId, disagreeing), DiagnosticBundleCorruptError);
  });
});
