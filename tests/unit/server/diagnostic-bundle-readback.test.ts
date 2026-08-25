/** E29: durable D137 bundle readback and its browser-safe strict wire. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { DiagnosticBundleWireSchema } from "../../../src/domain/dashboard/diagnostic-bundle.js";
import { DiagnosticAttachmentSchema, DiagnosticBundleSchema } from "../../../src/domain/trust/diagnostic.js";
import { sequentialIdFactory, RUN_ID } from "../fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../fixtures/phase1f-executor-harness.js";
import { HASH_A, HASH_B, NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { createDiagnosticCaptureService } from "../../../src/services/trust/diagnostic-capture.js";
import { readDiagnosticBundle } from "../../../src/server/dashboard/queries/diagnostic-bundle.js";
import { DiagnosticBundleCorruptError, TargetNotFoundError } from "../../../src/server/failures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hrauto-diagnostic-readback-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "diagnostic-readback-test" },
    manualClock(new Date(NOW)),
  );
  const artifacts = createContentAddressedArtifactWriter({ workspaceRoot: root, artifactRoot: ".tracker-rebuild/artifacts" });
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const service = createDiagnosticCaptureService({
    authority: database.authority,
    artifacts,
    clock: manualClock(new Date(NOW)),
    ids: sequentialIdFactory("d"),
  });
  database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
  return { database, artifacts, service };
}

describe("E29 diagnostic bundle readback", () => {
  it("round-trips the D137 writer through verified bytes and canonical manifest", async () => {
    const { database, artifacts, service } = fixture();
    const bundle = await service.capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [
        { key: "screen", classification: "safe-diagnostic", transform: "allow", value: "crm.onboarding" },
        { key: "employeeName", classification: "sensitive-hr", transform: "digest", value: "Jane Q Public" },
      ],
      attachments: [{
        kind: "accessibility-excerpt",
        mediaType: "text/yaml",
        bytes: new TextEncoder().encode("- button: Submit"),
        sensitivity: "redacted",
      }],
    });
    const result = await readDiagnosticBundle({ authority: database.authority.diagnosticBundles, artifacts }, bundle.bundleId);

    assert.equal(result.wire.bundleId, bundle.bundleId);
    assert.equal(result.wire.capturedAt, bundle.createdAt);
    assert.equal(result.wire.byteSize, bundle.attachments[0]?.byteLength);
    assert.equal(result.wire.contentDigest, bundle.contentDigest);
    assert.equal(result.wire.contents[0]?.artifactId, bundle.attachments[0]?.artifactId);
    assert.deepEqual(JSON.parse(result.manifest), bundle, "manifest is the stored durable row, not a browser reconstruction");
  });

  it("refuses a missing id, a traversal-shaped id, a bad digest and a mismatched attachment index", async () => {
    const { database, artifacts, service } = fixture();
    const bundle = await service.capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      fields: [],
      attachments: [{
        kind: "console-summary",
        mediaType: "application/json",
        bytes: new TextEncoder().encode("[]"),
        sensitivity: "redacted",
      }],
    });
    const deps = { authority: database.authority.diagnosticBundles, artifacts };

    await assert.rejects(() => readDiagnosticBundle(deps, "00000000-0000-4000-8000-000000000099"), TargetNotFoundError);
    await assert.rejects(() => readDiagnosticBundle(deps, "../../latest"), /uuid|invalid/i);
    await assert.rejects(
      () => readDiagnosticBundle({
        ...deps,
        authority: {
          get: () => DiagnosticBundleSchema.parse({ ...bundle, contentDigest: "0".repeat(64) }),
          listAttachments: () => [],
        },
      }, bundle.bundleId),
      DiagnosticBundleCorruptError,
    );
    await assert.rejects(
      () => readDiagnosticBundle({
        ...deps,
        authority: {
          get: () => bundle,
          listAttachments: () => [{
            bundleId: bundle.bundleId,
            attachment: DiagnosticAttachmentSchema.parse({
              ...bundle.attachments[0],
              artifactId: "00000000-0000-4000-8000-000000000123",
            }),
            createdAt: bundle.createdAt,
          }],
        },
      }, bundle.bundleId),
      DiagnosticBundleCorruptError,
    );
  });

  it("keeps the wire recursively strict and rejects impossible content dimensions", () => {
    const wire = {
      bundleId: "00000000-0000-4000-8000-000000000001",
      capturedAt: NOW,
      byteSize: 0,
      contentDigest: "a".repeat(64),
      redaction: { fields: [], warnings: [] },
      contents: [],
    };
    assert.equal(DiagnosticBundleWireSchema.safeParse({ ...wire, unexpected: true }).success, false);
    assert.equal(DiagnosticBundleWireSchema.safeParse({
      ...wire,
      contents: [{
        kind: "accessibility-excerpt",
        key: "Accessibility excerpt",
        detail: "text/yaml · 3 bytes · redacted",
        artifactId: "00000000-0000-4000-8000-000000000002",
        mediaType: "text/yaml",
        byteLength: 3,
        digest: "b".repeat(64),
        sensitivity: "redacted",
        width: 10,
      }],
    }).success, false);
  });
});
