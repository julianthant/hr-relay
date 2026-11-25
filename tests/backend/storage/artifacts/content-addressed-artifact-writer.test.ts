import { forceExactFileMetadata } from "../../../support/helpers/exact-file-metadata.js";
import { default as assert } from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter, decodeStoredArtifact, inspectArtifactDeletionFile, pendingDiagnosticArtifacts, reclaimDiagnosticStages, removeArtifactDeletionFile } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../../src/models/artifacts/artifacts.js";

{

it("creates artifact folders only at put and leaves ready and failed open without disk effects", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "artifact-lazy-")));
  const artifactRoot = join(root, "artifacts");
  const admission = RuntimeAdmission.syntheticRoots(join(root, "state"), artifactRoot);
  try {
    const bytes = Buffer.from("current safe artifact");
    const writer = createContentAddressedArtifactWriter({ admission });
    assert.equal(existsSync(artifactRoot), false);
    await writer.ready;
    assert.equal(existsSync(artifactRoot), false);
    await assert.rejects(writer.open(ArtifactRefSchema.parse({ id: "00000000-0000-4000-8000-000000000001",
      sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength,
      mediaType: "application/octet-stream" })), { code: "ENOENT" });
    assert.equal(existsSync(artifactRoot), false);
    const ref = await writer.put(bytes, { mediaType: "application/octet-stream" });
    assert.equal(existsSync(artifactRoot), true);
    const stream = await writer.open(ref);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) { assert.ok(chunk instanceof Uint8Array); chunks.push(Buffer.from(chunk)); }
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.deepEqual(await writer.put(bytes, { mediaType: "application/octet-stream" }), ref);
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});

it("refuses a root replaced by a symlink before ready or put", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "artifact-lazy-safety-")));
  const artifactRoot = join(root, "artifacts");
  const admission = RuntimeAdmission.syntheticRoots(join(root, "state"), artifactRoot);
  try {
    const writer = createContentAddressedArtifactWriter({ admission });
    symlinkSync(root, artifactRoot);
    await assert.rejects(writer.ready, /unsafe synthetic fixture ancestor|symbolic link/u);
    await assert.rejects(writer.put(Buffer.from("safe"), { mediaType: "application/octet-stream" }), /unsafe synthetic fixture ancestor|symbolic link/u);
    assert.equal(existsSync(join(root, `${createHash("sha256").update("safe").digest("hex")}.artifact`)), false);
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});
}

{

it("never deletes an unregistered shared winner during stopped cleanup and preserves its accounted witness", async () => {
  const profile = await createBoundProfileFixture(), admission = profile.admission;
  try {
    const writer = createContentAddressedArtifactWriter({ admission });
    const bytes = Buffer.from("shared winner bytes");
    const winner = await writer.put(bytes, { mediaType: "application/json" });
    const stage = await writer.stageDiagnostic(bytes, { mediaType: "application/json" }, "ordinary");
    assert.deepEqual(stage.publish(), winner);
    const before = readdirSync(admission.artifactRoot).sort();
    assert.throws(() => reclaimDiagnosticStages(admission, () => false), /shared-publication-unresolved/u);
    assert.deepEqual(readdirSync(admission.artifactRoot).sort(), before);
    assert.deepEqual(pendingDiagnosticArtifacts(admission), [stage.ref]);
    assert.equal(reclaimDiagnosticStages(admission, ref => ref.id === winner.id), 1);
    assert.deepEqual(readdirSync(admission.artifactRoot).sort(), before.filter(name => !name.endsWith(".diagnostic.tmp")));
    assert.equal(existsSync(join(admission.artifactRoot, `${winner.sha256}.artifact`)), true);
  } finally { await profile.close(); }
});
}


it.skipIf(process.platform !== "linux")("publishes and disposes a diagnostic with exact high file IDs", async () => {
  const f = await createBoundProfileFixture(), restore = forceExactFileMetadata(f.admission.artifactRoot);
  try {
    const writer = createContentAddressedArtifactWriter({ admission: f.admission });
    const bytes = Buffer.from("exact diagnostic fixture"), stage = await writer.stageDiagnostic(bytes, { mediaType: "application/json" }, "ordinary");
    const name = readdirSync(f.admission.artifactRoot).find(name => name.endsWith(".diagnostic.tmp")); assert.ok(name);
    const path = join(f.admission.artifactRoot, name);
    const inode = (1n << 54n) + (lstatSync(path, { bigint: true }).ino << 2n);
    for (const source of ["path", "descriptor"] as const) assert.ok(restore.observations.some(observation =>
      observation.path === path && observation.source === source && observation.inode === inode), `missing exact ${source} identity`);
    assert.equal(stage.publish().sha256, createHash("sha256").update(bytes).digest("hex"));
    stage.dispose();
    const chunks: Buffer[] = [];
    for await (const chunk of await writer.open(stage.ref)) { assert.ok(chunk instanceof Uint8Array); chunks.push(Buffer.from(chunk)); }
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.deepEqual(pendingDiagnosticArtifacts(f.admission), []);
  } finally { restore(); await f.close(); }
});

it.skipIf(process.platform !== "linux")("refuses an adjacent high-ID diagnostic stage substitution", async () => {
  const f = await createBoundProfileFixture();
  let substituted = false;
  const restore = forceExactFileMetadata(f.admission.artifactRoot, (path, info) => {
    if (substituted && path.endsWith(".diagnostic.tmp")) { assert.equal(Number(info.ino), Number(info.ino + 1n)); info.ino += 1n; }
  });
  try {
    const writer = createContentAddressedArtifactWriter({ admission: f.admission });
    const bytes = Buffer.from("preserved diagnostic fixture"), stage = await writer.stageDiagnostic(bytes, { mediaType: "application/json" }, "ordinary");
    const before = readdirSync(f.admission.artifactRoot).sort();
    substituted = true;
    assert.throws(() => stage.publish(), /diagnostic-stage-custody-changed/u);
    assert.deepEqual(readdirSync(f.admission.artifactRoot).sort(), before);
    substituted = false; stage.publish(); stage.dispose();
  } finally { restore(); await f.close(); }
});

function legacyVerdict(stored: Buffer, digest: string): string {
  try { decodeStoredArtifact(JSON.parse(stored.toString("utf8")) as unknown, digest); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  throw new Error("legacy decode accepted a corrupt fixture");
}

function replacePayloadText(stored: Buffer, offset: number, text: string): Buffer {
  const copy = Buffer.from(stored);
  copy.write(text, stored.indexOf(",\"payloadBase64\":\"") + 18 + offset, "latin1");
  return copy;
}

it("proves a deletion file from one streamed hash without parsing its payload and keeps every Base64, digest and reference check", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "artifact-deletion-proof-")));
  const admission = RuntimeAdmission.syntheticRoots(join(root, "state"), join(root, "artifacts"));
  try {
    const writer = createContentAddressedArtifactWriter({ admission });
    const ref = await writer.put(Buffer.alloc(3 * 1024 * 1024 + 1, 7), { mediaType: "application/pdf" });
    const path = join(admission.artifactRoot, `${ref.sha256}.artifact`), stored = readFileSync(path);
    const parse = vi.spyOn(JSON, "parse");
    try {
      assert.deepEqual(inspectArtifactDeletionFile(admission, ref),
        { ref, storedSha256: createHash("sha256").update(stored).digest("hex"), storedBytes: stored.byteLength });
      assert.equal(parse.mock.calls.some(([text]) => typeof text === "string" && text.length > 64 * 1024), false);
    } finally { parse.mockRestore(); }
    for (const other of [{ id: "00000000-0000-4000-8000-000000000001" }, { bytes: ref.bytes + 1 }, { mediaType: "application/json" }]) {
      assert.throws(() => inspectArtifactDeletionFile(admission, ArtifactRefSchema.parse({ ...ref, ...other })), /artifact-deletion-reference-mismatch/u);
    }
    const header = stored.subarray(0, stored.indexOf(",\"payloadBase64\":\""));
    for (const [corrupt, error] of [[Buffer.concat([stored.subarray(0, stored.byteLength - 6), Buffer.from("\"}")]), /content digest does not match/u],
      [Buffer.concat([stored.subarray(0, stored.byteLength - 2), Buffer.from("\"")]), /JSON/u],
      [Buffer.from("{\"ref\":{}}"), /payloadBase64/u],
      [Buffer.concat([header, Buffer.from(",\"payloadBase64\":\"\"}")]), /content digest does not match/u],
      [replacePayloadText(stored, 1_000_000, "!"), /invalid base64 payload/u],
      [replacePayloadText(stored, 1_000_000, "C"), /content digest does not match/u],
      [replacePayloadText(stored, stored.byteLength - stored.indexOf(",\"payloadBase64\":\"") - 18 - 5, "x"), /invalid base64 payload/u]] as const) {
      writeFileSync(path, corrupt);
      assert.throws(() => inspectArtifactDeletionFile(admission, ref), error);
      assert.throws(() => inspectArtifactDeletionFile(admission, ref), { message: legacyVerdict(corrupt, ref.sha256) });
    }
    writeFileSync(path, stored);
    assert.equal(removeArtifactDeletionFile(admission, inspectArtifactDeletionFile(admission, ref)), "removed");
    assert.equal(existsSync(path), false);
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});

it("keeps the stored envelope grammar: padding only at the payload's end, large writer refs and reordered envelopes", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "artifact-deletion-grammar-")));
  const admission = RuntimeAdmission.syntheticRoots(join(root, "state"), join(root, "artifacts"));
  try {
    const writer = createContentAddressedArtifactWriter({ admission });
    const proof = (ref: ArtifactRef, bytes: Buffer) => ({ ref, storedSha256: createHash("sha256").update(bytes).digest("hex"), storedBytes: bytes.byteLength });
    // The first streamed chunk is exactly first's padded Base64, so only a whole-payload check sees the early padding.
    const first = Buffer.alloc(1024 * 1024 / 4 * 3 - 2, 1), second = Buffer.alloc(300_000, 2), content = Buffer.concat([first, second]);
    const padded = ArtifactRefSchema.parse({ id: randomUUID(), sha256: createHash("sha256").update(content).digest("hex"), bytes: content.byteLength, mediaType: "application/pdf" });
    const paddedFile = Buffer.from(JSON.stringify({ ref: padded, payloadBase64: first.toString("base64") + second.toString("base64") }));
    assert.equal(first.toString("base64").endsWith("=="), true);
    assert.equal(paddedFile.byteLength - JSON.stringify({ ref: padded, payloadBase64: content.toString("base64") }).length, 0);
    await writer.put(Buffer.from("creates the artifact root"), { mediaType: "application/json" });
    writeFileSync(join(admission.artifactRoot, `${padded.sha256}.artifact`), paddedFile, { mode: 0o600 });
    assert.throws(() => inspectArtifactDeletionFile(admission, padded), { message: legacyVerdict(paddedFile, padded.sha256) });
    assert.throws(() => inspectArtifactDeletionFile(admission, padded), /invalid base64 payload/u);
    const large = await writer.put(Buffer.from("large media type"), { mediaType: `application/${"x".repeat(1_100_000)}` });
    assert.deepEqual(inspectArtifactDeletionFile(admission, large), proof(large, readFileSync(join(admission.artifactRoot, `${large.sha256}.artifact`))));
    const body = Buffer.from("reordered envelope"), reordered = ArtifactRefSchema.parse({ id: randomUUID(),
      sha256: createHash("sha256").update(body).digest("hex"), bytes: body.byteLength, mediaType: "application/json" });
    const reorderedFile = Buffer.from(` ${JSON.stringify({ payloadBase64: body.toString("base64"), ref: reordered }, null, 2)}\n`);
    writeFileSync(join(admission.artifactRoot, `${reordered.sha256}.artifact`), reorderedFile, { mode: 0o600 });
    assert.deepEqual(inspectArtifactDeletionFile(admission, reordered), proof(reordered, reorderedFile));
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});
