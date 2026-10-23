import { default as assert } from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "vitest";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { operatorRequestedCapture } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { type ArtifactWriteFaultStep } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";

{

describe("diagnostic byte retention", () => {
  it("retains shared pinned bytes and removes only unreferenced expired bytes", async () => {
    const w = trustWorld();
    try {
      const run = w.create(820); w.cancel(run, 821);
      const artifacts = createContentAddressedArtifactWriter({ admission: w.profile.admission }); await artifacts.ready;
      const service = createDiagnosticCaptureService({ authority: w.database.authority, artifacts, clock: w.world.clock, ids: { uuid: randomUUID }, retentionDays: 1 });
      const capture = (text: string, pinned = false) => operatorRequestedCapture({ service, runId: run.envelope.runId,
        configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [],
        attachments: [{ kind: "console-summary", mediaType: "application/json", sensitivity: "redacted", bytes: new TextEncoder().encode(text) }],
        ...(pinned ? { retention: { kind: "pinned", reason: "write-recovery" } } : {}) });
      const shared = await capture("{\"safe\":true}"), pinned = await capture("{\"safe\":true}", true), alone = await capture("{\"safe\":false}");
      assert.equal(shared.attachments[0]?.digest, pinned.attachments[0]?.digest);
      const result = w.database.sweepOrdinaryDiagnostics(new Date(w.world.clock.nowMs() + 2 * 86_400_000).toISOString());
      assert.deepEqual([...result.purged].sort(), [shared.bundleId, alone.bundleId].sort());
      assert.equal(existsSync(join(w.profile.admission.artifactRoot, `${shared.attachments[0]?.digest}.artifact`)), true);
      assert.equal(existsSync(join(w.profile.admission.artifactRoot, `${alone.attachments[0]?.digest}.artifact`)), false);
      assert.equal(w.database.authority.diagnosticBundles.get(pinned.bundleId)?.availability, undefined);
    } finally { w.dispose(); }
  });
});
}

{

async function readStream(stream: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("test artifact stream emitted non-bytes");
    chunks.push(Uint8Array.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

describe("task, store, session, provider, and artifact seams", () => {
  it("atomically persists and deduplicates content bytes without exposing a backing path", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifacts-"));
    try {
      assert.throws(() => Reflect.apply(createContentAddressedArtifactWriter, undefined, [{ admission: undefined }]),
        /runtime-admission: required/);
      const writer = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ".tracker/data/artifacts")),
      });
      const bytes = new TextEncoder().encode("same immutable bytes");
      const first = await writer.put(bytes, { mediaType: "text/plain" });
      const reopenedWriter = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ".tracker/data/artifacts")),
      });
      const second = await reopenedWriter.put(Readable.from([bytes]), { mediaType: "text/plain" });
      assert.deepEqual(second, first);
      assert.equal(Object.hasOwn(first, "path"), false);
      assert.equal(Object.hasOwn(writer, "root"), false);
      assert.deepEqual(await readStream(await reopenedWriter.open(first)), bytes);
      await assert.rejects(
        writer.put(bytes, { mediaType: "application/json" }),
        /already exists with media type text\/plain/,
      );
      assert.deepEqual(
        (await readdir(join(workspace, ".tracker/data/artifacts"))).sort(),
        [`${first.sha256}.artifact`],
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  })

  it("cleans pre-publication faults and recovers committed artifacts after every write boundary", async () => {
    const steps: readonly ArtifactWriteFaultStep[] = [
      "temp-written",
      "temp-synced",
      "published",
      "directory-synced",
    ];
    for (const step of steps) {
      const workspace = await mkdtemp(join(tmpdir(), `hrauto-artifact-${step}-`));
      const bytes = new TextEncoder().encode(`fault fixture ${step}`);
      let armed = true;
      try {
        const faulting = createContentAddressedArtifactWriter({
          admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ".tracker/data/artifacts")),
          injectFault(actual) {
            if (armed && actual === step) {
              armed = false;
              throw new Error(`injected ${step}`);
            }
          },
        });
        await assert.rejects(faulting.put(bytes, { mediaType: "text/plain" }), new RegExp(`injected ${step}`));
        const recovery = createContentAddressedArtifactWriter({
          admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ".tracker/data/artifacts")),
        });
        const ref = await recovery.put(bytes, { mediaType: "text/plain" });
        assert.deepEqual(await readStream(await recovery.open(ref)), bytes);
        assert.deepEqual(
          (await readdir(join(workspace, ".tracker/data/artifacts"))).sort(),
          [`${ref.sha256}.artifact`],
        );
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }
  })

  it("recovers after a child process is hard-killed before publication", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-hard-crash-"));
    const bytes = new TextEncoder().encode("hard crash before publication");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const writerModuleUrl = new URL(
      "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.ts",
      import.meta.url,
    ).href;
    const admissionModuleUrl = new URL("../../../../src/backend/storage/admission/admission.ts", import.meta.url).href;
    const childSource = `
      import { createContentAddressedArtifactWriter } from ${JSON.stringify(writerModuleUrl)};
      import { RuntimeAdmission } from ${JSON.stringify(admissionModuleUrl)};
      import { join } from "node:path";
      const writer = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(${JSON.stringify(workspace)}, ".tracker"), join(${JSON.stringify(workspace)}, ".tracker/data/artifacts")),
        injectFault(step) {
          if (step === "temp-synced") process.kill(process.pid, "SIGKILL");
        },
      });
      await writer.put(new TextEncoder().encode("hard crash before publication"), { mediaType: "text/plain" });
    `;
    try {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", childSource],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      const result = await new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
        (resolveResult, rejectResult) => {
          child.once("error", rejectResult);
          child.once("close", (code, signal) => resolveResult({ code, signal }));
        },
      );
      assert.deepEqual(result, { code: null, signal: "SIGKILL" }, stderr);
      assert.notEqual(child.pid, undefined);

      const root = join(workspace, ".tracker/data/artifacts");
      const crashEntries = await readdir(root);
      assert.equal(crashEntries.some((name) => name.endsWith(".lock")), false);
      assert.equal(crashEntries.includes(`${sha256}.artifact`), false);
      assert.equal(crashEntries.length, 1);
      assert.match(crashEntries[0] ?? "", new RegExp(`^${sha256}\\.${String(child.pid)}\\..+\\.tmp$`, "u"));

      const recovery = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ".tracker/data/artifacts")),
      });
      const ref = await recovery.put(bytes, { mediaType: "text/plain" });
      assert.equal(ref.sha256, sha256);
      assert.deepEqual(await readStream(await recovery.open(ref)), bytes);
      assert.deepEqual(await readdir(root), [`${sha256}.artifact`]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  })

  it("fails loud on corrupted artifact JSON, digest, payload, and length metadata", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-corrupt-"));
    try {
      const writer = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ".tracker/data/artifacts")),
      });
      const bytes = new TextEncoder().encode("corruption fixture");
      const ref = await writer.put(bytes, { mediaType: "text/plain" });
      const path = join(workspace, ".tracker/data/artifacts", `${ref.sha256}.artifact`);
      const original = await readFile(path, "utf8");

      await writeFile(path, "not-json", "utf8");
      await assert.rejects(writer.open(ref), /not valid JSON/);

      await writeFile(path, original.replace(ref.sha256, "b".repeat(64)), "utf8");
      await assert.rejects(writer.open(ref), /content digest does not match/);

      const encoded = Buffer.from(bytes).toString("base64");
      const changedPayload = Buffer.from("different bytes").toString("base64");
      await writeFile(path, original.replace(encoded, changedPayload), "utf8");
      await assert.rejects(writer.open(ref), /content digest does not match/);

      await writeFile(path, original.replace(`"bytes":${ref.bytes}`, `"bytes":${ref.bytes + 1}`), "utf8");
      await assert.rejects(writer.open(ref), /byte length does not match/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  })

  it("atomically converges concurrent same-digest writes on one winner ref", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-concurrent-"));
    try {
      const firstWriter = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ".tracker/data/artifacts")),
      });
      const secondWriter = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ".tracker/data/artifacts")),
      });
      const bytes = new TextEncoder().encode("concurrent immutable bytes");
      const results = await Promise.all([
        firstWriter.put(bytes, { mediaType: "text/plain" }),
        secondWriter.put(bytes, { mediaType: "text/plain" }),
      ]);
      assert.deepEqual(results[1], results[0]);
      const winner = await firstWriter.put(bytes, { mediaType: "text/plain" });
      const retried = await secondWriter.put(bytes, { mediaType: "text/plain" });
      assert.deepEqual(retried, winner);
      assert.deepEqual(await readdir(join(workspace, ".tracker/data/artifacts")), [
        `${winner.sha256}.artifact`,
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  })
});
}
