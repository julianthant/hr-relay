import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { RuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter } from "../../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { ArtifactRefSchema } from "../../../../../../src/models/artifacts/artifacts.js";

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
