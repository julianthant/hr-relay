import { default as assert } from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter, inspectArtifactDeletionFile, removeArtifactDeletionFile } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";

const fileIo = vi.hoisted(() => ({
  reads: 0,
  tailReadLength: undefined as number | undefined,
  afterStat: undefined as (() => void) | undefined,
}));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    fstatSync: (...args: Parameters<typeof actual.fstatSync>) => {
      const status = actual.fstatSync(...args);
      const hook = fileIo.afterStat;
      fileIo.afterStat = undefined;
      hook?.();
      return status;
    },
    readSync: (...args: Parameters<typeof actual.readSync>) => {
      fileIo.reads++;
      if (fileIo.reads === 2 && fileIo.tailReadLength !== undefined) {
        return actual.readSync(args[0], args[1], 0, fileIo.tailReadLength, 0);
      }
      return Reflect.apply<typeof actual, Parameters<typeof actual.readSync>, number>(actual.readSync, actual, args);
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  fileIo.reads = 0;
  fileIo.tailReadLength = undefined;
  fileIo.afterStat = undefined;
});

it("reuses a settled file's full deletion proof until its identity changes or it is removed", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "artifact-deletion-cache-")));
  const admission = RuntimeAdmission.syntheticRoots(join(root, "state"), join(root, "artifacts"));
  try {
    const ref = await createContentAddressedArtifactWriter({ admission }).put(Buffer.alloc(2 * 1024 * 1024, 9), { mediaType: "application/pdf" });
    const path = join(admission.artifactRoot, `${ref.sha256}.artifact`), stored = readFileSync(path);
    const proveCounted = () => { fileIo.reads = 0; const proof = inspectArtifactDeletionFile(admission, ref); return { proof, reads: fileIo.reads }; };
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

it("refuses a whole-file proof if the file grows after the opening stat", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "artifact-deletion-append-")));
  const admission = RuntimeAdmission.syntheticRoots(join(root, "state"), join(root, "artifacts"));
  try {
    const ref = await createContentAddressedArtifactWriter({ admission }).put(Buffer.from("payload"), { mediaType: "application/pdf" });
    const path = join(admission.artifactRoot, `${ref.sha256}.artifact`);
    writeFileSync(path, ` ${readFileSync(path, "utf8")}`);
    fileIo.afterStat = () => appendFileSync(path, "!");

    assert.throws(() => inspectArtifactDeletionFile(admission, ref), /artifact-deletion-custody-changed/u);
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});

it("rejects malformed closing bytes when a short tail read ends at the ref's closing bytes", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "artifact-deletion-short-tail-")));
  const admission = RuntimeAdmission.syntheticRoots(join(root, "state"), join(root, "artifacts"));
  try {
    const ref = await createContentAddressedArtifactWriter({ admission }).put(Buffer.from("payload"), { mediaType: "application/pdf" });
    const path = join(admission.artifactRoot, `${ref.sha256}.artifact`);
    const stored = readFileSync(path, "utf8");
    const refEnd = stored.indexOf('},"payloadBase64":') + 1;
    assert.ok(refEnd > 1 && stored.slice(refEnd - 2, refEnd) === '"}');
    writeFileSync(path, `${stored.slice(0, -2)}xx`);
    fileIo.reads = 0;
    fileIo.tailReadLength = refEnd;

    assert.throws(() => inspectArtifactDeletionFile(admission, ref), SyntaxError);
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});
