import { default as assert } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter, inspectArtifactDeletionFile, removeArtifactDeletionFile } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";

const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, readSync: (...args: Parameters<typeof actual.readSync>) => { reads.count++; return Reflect.apply(actual.readSync, actual, args) as number; } };
});

afterEach(() => { vi.useRealTimers(); });

it("reuses a settled file's full deletion proof until its identity changes or it is removed", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "artifact-deletion-cache-")));
  const admission = RuntimeAdmission.syntheticRoots(join(root, "state"), join(root, "artifacts"));
  try {
    const ref = await createContentAddressedArtifactWriter({ admission }).put(Buffer.alloc(2 * 1024 * 1024, 9), { mediaType: "application/pdf" });
    const path = join(admission.artifactRoot, `${ref.sha256}.artifact`), stored = readFileSync(path);
    const proveCounted = () => { reads.count = 0; const proof = inspectArtifactDeletionFile(admission, ref); return { proof, reads: reads.count }; };
    const first = proveCounted();
    assert.ok(first.reads > 0);
    assert.ok(proveCounted().reads > 0, "a file changed within the coarse clock window is proved again");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 60_000);
    assert.ok(proveCounted().reads > 0);
    assert.deepEqual(proveCounted(), { proof: first.proof, reads: 0 });
    assert.throws(() => inspectArtifactDeletionFile(admission, { ...ref, mediaType: "application/json" }), /artifact-deletion-reference-mismatch/u);
    const corrupt = Buffer.from(stored); corrupt.write("D", stored.indexOf(",\"payloadBase64\":\"") + 18 + 1_000_000, "latin1");
    writeFileSync(path, corrupt);
    assert.throws(() => inspectArtifactDeletionFile(admission, ref), /content digest does not match/u);
    writeFileSync(path, stored);
    assert.equal(removeArtifactDeletionFile(admission, inspectArtifactDeletionFile(admission, ref)), "removed");
    assert.equal(existsSync(path), false);
    writeFileSync(path, stored);
    assert.ok(proveCounted().reads > 0, "a removed file's proof is not reused");
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});
