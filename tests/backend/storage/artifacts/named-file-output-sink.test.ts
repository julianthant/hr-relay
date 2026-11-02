import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { ArtifactSinkConflictError } from "../../../../src/backend/storage/artifacts/artifact-sink.js";
import { createNamedFileOutputSink, type NamedFilePublicationPoint } from "../../../../src/backend/storage/artifacts/named-file-output-sink.js";
import { ArtifactOutboxStorageRecordSchema } from "../../../../src/models/artifacts/generated-artifact.js";
import type { ArtifactRef } from "../../../../src/models/artifacts/artifacts.js";
import { namedArtifactOutput } from "../../../../src/workflow-kit/artifacts.js";

async function fixture(fault?: (point: NamedFilePublicationPoint) => void) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "named-file-output-")), directory = join(root, "documents");
  const admission = RuntimeAdmission.syntheticRoots(root, join(root, "artifacts"));
  const artifacts = createContentAddressedArtifactWriter({ admission }); await artifacts.ready;
  const bytes = Buffer.from("retained archive bytes"), artifact = await artifacts.put(bytes, { mediaType: "application/zip" });
  const runId = randomUUID(), fileName = "Onboarding Docs 2026-11-01 batch.zip";
  const row = ArtifactOutboxStorageRecordSchema.parse({ outboxId: randomUUID(), artifactId: randomUUID(), projectionId: "batch-archive", stableKeyFingerprint: "a".repeat(64),
    keyValues: [{ field: "archive.fileName", value: fileName }], sinkId: `documents-file-${runId}`, sourceRunId: runId, sourceNodeId: "archive", state: "pending",
    payload: { schemaHash: "b".repeat(64), value: namedArtifactOutput(artifact, fileName) }, createdAt: "2026-11-01T12:00:00.000Z" });
  const sink = createNamedFileOutputSink({ artifacts, documentsDirectory: () => directory, ...(fault === undefined ? {} : { fault }) });
  let prepared: ArtifactRef | undefined;
  const request = { row, head: undefined, previousArtifact: undefined, lockPath: await sink.writerLockPath(row), assertCurrent: async () => admission.assertLive(),
    prepare(value: ArtifactRef) { prepared = value; }, assertPrepared(value: ArtifactRef) { assert.deepEqual(value, prepared); } };
  return { root, directory, bytes, artifact, sink, request, path: join(directory, fileName), prepared: () => prepared,
    close() { admission.release(); rmSync(root, { recursive: true }); } };
}

it("publishes the exact retained artifact under its requested filename", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.sink.project(f.request), { contentSha256: f.artifact.sha256, artifact: f.artifact });
    assert.deepEqual(f.prepared(), f.artifact); assert.deepEqual(readFileSync(f.path), f.bytes);
    assert.deepEqual(readdirSync(f.directory), ["Onboarding Docs 2026-11-01 batch.zip"]);
  } finally { f.close(); }
});

it.each(["identical", "different", "directory", "symlink"] as const)("refuses an existing %s destination before prepare", async kind => {
  const f = await fixture();
  try {
    if (kind === "directory") mkdirSync(f.path);
    else if (kind === "symlink") symlinkSync(join(f.root, "missing"), f.path);
    else writeFileSync(f.path, kind === "identical" ? f.bytes : "operator content");
    await assert.rejects(f.sink.project(f.request), ArtifactSinkConflictError);
    assert.equal(f.prepared(), undefined);
    if (kind === "identical" || kind === "different") assert.deepEqual(readFileSync(f.path), kind === "identical" ? f.bytes : Buffer.from("operator content"));
    assert.equal(readdirSync(f.directory).length, 1);
  } finally { f.close(); }
});

it("refuses a racing destination without overwriting it", async () => {
  let publish: () => void = () => { throw new Error("fixture not ready"); };
  const f = await fixture(point => { if (point === "prepared") publish(); });
  publish = () => writeFileSync(f.path, "racing operator content", { flag: "wx" });
  try {
    await assert.rejects(f.sink.project(f.request), ArtifactSinkConflictError);
    assert.deepEqual(readFileSync(f.path), Buffer.from("racing operator content"));
    assert.deepEqual(f.prepared(), f.artifact);
  } finally { f.close(); }
});

it("refuses changed staging before preparing or publishing the output", async () => {
  let tamper: () => void = () => { throw new Error("fixture not ready"); };
  const f = await fixture(point => { if (point === "staged") tamper(); });
  tamper = () => { const stage = readdirSync(f.directory).find(name => name.endsWith(".tmp")); assert.ok(stage); writeFileSync(join(f.directory, stage), "changed"); };
  try {
    await assert.rejects(f.sink.project(f.request), /staged-bytes-changed/u);
    assert.equal(existsSync(f.path), false); assert.equal(f.prepared(), undefined);
  } finally { f.close(); }
});
