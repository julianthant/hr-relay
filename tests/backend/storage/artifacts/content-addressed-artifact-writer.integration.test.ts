import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { spawn as spawn_m1 } from "node:child_process";
import { createHash as createHash_m1,randomUUID as randomUUID_m0 } from "node:crypto";
import { existsSync as existsSync_m0 } from "node:fs";
import { mkdtemp as mkdtemp_m1,readFile as readFile_m1,readdir as readdir_m1,rm as rm_m1,writeFile as writeFile_m1 } from "node:fs/promises";
import { tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { Readable as Readable_m1 } from "node:stream";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { createDiagnosticCaptureService as createDiagnosticCaptureService_m0 } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { operatorRequestedCapture as operatorRequestedCapture_m0 } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { RuntimeAdmission as RuntimeAdmission_m1 } from "../../../../src/backend/storage/admission/admission.js";
import type { ArtifactWriteFaultStep as ArtifactWriteFaultStep_m1 } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createContentAddressedArtifactWriter as createContentAddressedArtifactWriter_m0,createContentAddressedArtifactWriter as createContentAddressedArtifactWriter_m1 } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { trustWorld as trustWorld_m0 } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { syntheticStateRoot as syntheticStateRoot_m0 } from "../../../support/helpers/synthetic-storage-admission.js";


{


describe_m0("diagnostic byte retention", () => {
  it_m0("retains shared pinned bytes and removes only unreferenced expired bytes", async () => {
    const w = trustWorld_m0();
    try {
      const run = w.create(820); w.cancel(run, 821);
      const artifacts = createContentAddressedArtifactWriter_m0({ admission: syntheticStateRoot_m0(w.world.stateRoot) }); await artifacts.ready;
      const service = createDiagnosticCaptureService_m0({ authority: w.database.authority, artifacts, clock: w.world.clock, ids: { uuid: randomUUID_m0 }, retentionDays: 1 });
      const capture = (text: string, pinned = false) => operatorRequestedCapture_m0({ service, runId: run.envelope.runId,
        configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [],
        attachments: [{ kind: "console-summary", mediaType: "application/json", sensitivity: "redacted", bytes: new TextEncoder().encode(text) }],
        ...(pinned ? { retention: { kind: "pinned", reason: "write-recovery" } } : {}) });
      const shared = await capture("{\"safe\":true}"), pinned = await capture("{\"safe\":true}", true), alone = await capture("{\"safe\":false}");
      assert_m0.equal(shared.attachments[0]?.digest, pinned.attachments[0]?.digest);
      const result = w.database.sweepOrdinaryDiagnostics(new Date(w.world.clock.nowMs() + 2 * 86_400_000).toISOString());
      assert_m0.deepEqual([...result.purged].sort(), [shared.bundleId, alone.bundleId].sort());
      assert_m0.equal(existsSync_m0(join_m0(w.world.stateRoot, "artifacts", `${shared.attachments[0]?.digest}.artifact`)), true);
      assert_m0.equal(existsSync_m0(join_m0(w.world.stateRoot, "artifacts", `${alone.attachments[0]?.digest}.artifact`)), false);
      assert_m0.equal(w.database.authority.diagnosticBundles.get(pinned.bundleId)?.availability, undefined);
    } finally { w.dispose(); }
  });
});
}

{


async function readStream(stream: Readable_m1): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("test artifact stream emitted non-bytes");
    chunks.push(Uint8Array.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

describe_m1("task, store, session, provider, and artifact seams", () => {
  it_m1("atomically persists and deduplicates content bytes without exposing a backing path", async () => {
    const workspace = await mkdtemp_m1(join_m1(tmpdir_m1(), "hrauto-artifacts-"));
    try {
      assert_m1.throws(() => Reflect.apply(createContentAddressedArtifactWriter_m1, undefined, [{ admission: undefined }]),
        /runtime-admission: required/);
      const writer = createContentAddressedArtifactWriter_m1({
        admission: RuntimeAdmission_m1.syntheticRoots(join_m1(workspace, ".tracker/data"), join_m1(workspace, ".tracker/data/artifacts")),
      });
      const bytes = new TextEncoder().encode("same immutable bytes");
      const first = await writer.put(bytes, { mediaType: "text/plain" });
      const reopenedWriter = createContentAddressedArtifactWriter_m1({
        admission: RuntimeAdmission_m1.syntheticRoots(join_m1(workspace, ".tracker/data"), join_m1(workspace, ".tracker/data/artifacts")),
      });
      const second = await reopenedWriter.put(Readable_m1.from([bytes]), { mediaType: "text/plain" });
      assert_m1.deepEqual(second, first);
      assert_m1.equal(Object.hasOwn(first, "path"), false);
      assert_m1.equal(Object.hasOwn(writer, "root"), false);
      assert_m1.deepEqual(await readStream(await reopenedWriter.open(first)), bytes);
      await assert_m1.rejects(
        writer.put(bytes, { mediaType: "application/json" }),
        /already exists with media type text\/plain/,
      );
      assert_m1.deepEqual(
        (await readdir_m1(join_m1(workspace, ".tracker/data/artifacts"))).sort(),
        [`${first.sha256}.artifact`],
      );
    } finally {
      await rm_m1(workspace, { recursive: true, force: true });
    }
  })

  it_m1("cleans pre-publication faults and recovers committed artifacts after every write boundary", async () => {
    const steps: readonly ArtifactWriteFaultStep_m1[] = [
      "temp-written",
      "temp-synced",
      "published",
      "directory-synced",
    ];
    for (const step of steps) {
      const workspace = await mkdtemp_m1(join_m1(tmpdir_m1(), `hrauto-artifact-${step}-`));
      const bytes = new TextEncoder().encode(`fault fixture ${step}`);
      let armed = true;
      try {
        const faulting = createContentAddressedArtifactWriter_m1({
          admission: RuntimeAdmission_m1.syntheticRoots(join_m1(workspace, ".tracker/data"), join_m1(workspace, ".tracker/data/artifacts")),
          injectFault(actual) {
            if (armed && actual === step) {
              armed = false;
              throw new Error(`injected ${step}`);
            }
          },
        });
        await assert_m1.rejects(faulting.put(bytes, { mediaType: "text/plain" }), new RegExp(`injected ${step}`));
        const recovery = createContentAddressedArtifactWriter_m1({
          admission: RuntimeAdmission_m1.syntheticRoots(join_m1(workspace, ".tracker/data"), join_m1(workspace, ".tracker/data/artifacts")),
        });
        const ref = await recovery.put(bytes, { mediaType: "text/plain" });
        assert_m1.deepEqual(await readStream(await recovery.open(ref)), bytes);
        assert_m1.deepEqual(
          (await readdir_m1(join_m1(workspace, ".tracker/data/artifacts"))).sort(),
          [`${ref.sha256}.artifact`],
        );
      } finally {
        await rm_m1(workspace, { recursive: true, force: true });
      }
    }
  })

  it_m1("recovers after a child process is hard-killed before publication", async () => {
    const workspace = await mkdtemp_m1(join_m1(tmpdir_m1(), "hrauto-artifact-hard-crash-"));
    const bytes = new TextEncoder().encode("hard crash before publication");
    const sha256 = createHash_m1("sha256").update(bytes).digest("hex");
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
      const child = spawn_m1(
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
      assert_m1.deepEqual(result, { code: null, signal: "SIGKILL" }, stderr);
      assert_m1.notEqual(child.pid, undefined);

      const root = join_m1(workspace, ".tracker/data/artifacts");
      const crashEntries = await readdir_m1(root);
      assert_m1.equal(crashEntries.some((name) => name.endsWith(".lock")), false);
      assert_m1.equal(crashEntries.includes(`${sha256}.artifact`), false);
      assert_m1.equal(crashEntries.length, 1);
      assert_m1.match(crashEntries[0] ?? "", new RegExp(`^${sha256}\\.${String(child.pid)}\\..+\\.tmp$`, "u"));

      const recovery = createContentAddressedArtifactWriter_m1({
        admission: RuntimeAdmission_m1.syntheticRoots(join_m1(workspace, ".tracker/data"), join_m1(workspace, ".tracker/data/artifacts")),
      });
      const ref = await recovery.put(bytes, { mediaType: "text/plain" });
      assert_m1.equal(ref.sha256, sha256);
      assert_m1.deepEqual(await readStream(await recovery.open(ref)), bytes);
      assert_m1.deepEqual(await readdir_m1(root), [`${sha256}.artifact`]);
    } finally {
      await rm_m1(workspace, { recursive: true, force: true });
    }
  })

  it_m1("fails loud on corrupted artifact JSON, digest, payload, and length metadata", async () => {
    const workspace = await mkdtemp_m1(join_m1(tmpdir_m1(), "hrauto-artifact-corrupt-"));
    try {
      const writer = createContentAddressedArtifactWriter_m1({
        admission: RuntimeAdmission_m1.syntheticRoots(join_m1(workspace, ".tracker/data"), join_m1(workspace, ".tracker/data/artifacts")),
      });
      const bytes = new TextEncoder().encode("corruption fixture");
      const ref = await writer.put(bytes, { mediaType: "text/plain" });
      const path = join_m1(workspace, ".tracker/data/artifacts", `${ref.sha256}.artifact`);
      const original = await readFile_m1(path, "utf8");

      await writeFile_m1(path, "not-json", "utf8");
      await assert_m1.rejects(writer.open(ref), /not valid JSON/);

      await writeFile_m1(path, original.replace(ref.sha256, "b".repeat(64)), "utf8");
      await assert_m1.rejects(writer.open(ref), /content digest does not match/);

      const encoded = Buffer.from(bytes).toString("base64");
      const changedPayload = Buffer.from("different bytes").toString("base64");
      await writeFile_m1(path, original.replace(encoded, changedPayload), "utf8");
      await assert_m1.rejects(writer.open(ref), /content digest does not match/);

      await writeFile_m1(path, original.replace(`"bytes":${ref.bytes}`, `"bytes":${ref.bytes + 1}`), "utf8");
      await assert_m1.rejects(writer.open(ref), /byte length does not match/);
    } finally {
      await rm_m1(workspace, { recursive: true, force: true });
    }
  })

  it_m1("atomically converges concurrent same-digest writes on one winner ref", async () => {
    const workspace = await mkdtemp_m1(join_m1(tmpdir_m1(), "hrauto-artifact-concurrent-"));
    try {
      const firstWriter = createContentAddressedArtifactWriter_m1({
        admission: RuntimeAdmission_m1.syntheticRoots(join_m1(workspace, ".tracker/data"), join_m1(workspace, ".tracker/data/artifacts")),
      });
      const secondWriter = createContentAddressedArtifactWriter_m1({
        admission: RuntimeAdmission_m1.syntheticRoots(join_m1(workspace, ".tracker/data"), join_m1(workspace, ".tracker/data/artifacts")),
      });
      const bytes = new TextEncoder().encode("concurrent immutable bytes");
      const results = await Promise.all([
        firstWriter.put(bytes, { mediaType: "text/plain" }),
        secondWriter.put(bytes, { mediaType: "text/plain" }),
      ]);
      assert_m1.deepEqual(results[1], results[0]);
      const winner = await firstWriter.put(bytes, { mediaType: "text/plain" });
      const retried = await secondWriter.put(bytes, { mediaType: "text/plain" });
      assert_m1.deepEqual(retried, winner);
      assert_m1.deepEqual(await readdir_m1(join_m1(workspace, ".tracker/data/artifacts")), [
        `${winner.sha256}.artifact`,
      ]);
    } finally {
      await rm_m1(workspace, { recursive: true, force: true });
    }
  })
});
}
