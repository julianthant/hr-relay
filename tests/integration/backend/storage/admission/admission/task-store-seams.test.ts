import { RuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "vitest";
import { createDeterministicSessionProvider } from "../../../../../../src/workflow-kit/session.js";
import {
  FingerprintSchema,
  IsoInstantSchema,
  ProviderAdmissionIdSchema,
} from "../../../../../../src/rules/identity/ids.js";
import { createContentAddressedArtifactWriter } from "../../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import type { ArtifactWriteFaultStep } from "../../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createDeterministicProviderHarness } from "../../../../../../src/backend/processing/providers/deterministic-provider.js";

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
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker"), join(workspace, ".tracker/artifacts")),
      });
      const bytes = new TextEncoder().encode("same immutable bytes");
      const first = await writer.put(bytes, { mediaType: "text/plain" });
      const reopenedWriter = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker"), join(workspace, ".tracker/artifacts")),
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
        (await readdir(join(workspace, ".tracker/artifacts"))).sort(),
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
          admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker"), join(workspace, ".tracker/artifacts")),
          injectFault(actual) {
            if (armed && actual === step) {
              armed = false;
              throw new Error(`injected ${step}`);
            }
          },
        });
        await assert.rejects(faulting.put(bytes, { mediaType: "text/plain" }), new RegExp(`injected ${step}`));
        const recovery = createContentAddressedArtifactWriter({
          admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker"), join(workspace, ".tracker/artifacts")),
        });
        const ref = await recovery.put(bytes, { mediaType: "text/plain" });
        assert.deepEqual(await readStream(await recovery.open(ref)), bytes);
        assert.deepEqual(
          (await readdir(join(workspace, ".tracker/artifacts"))).sort(),
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
      "../../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.ts",
      import.meta.url,
    ).href;
    const admissionModuleUrl = new URL("../../../../../../src/backend/storage/admission/admission.ts", import.meta.url).href;
    const childSource = `
      import { createContentAddressedArtifactWriter } from ${JSON.stringify(writerModuleUrl)};
      import { RuntimeAdmission } from ${JSON.stringify(admissionModuleUrl)};
      import { join } from "node:path";
      const writer = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(${JSON.stringify(workspace)}, ".tracker"), join(${JSON.stringify(workspace)}, ".tracker/artifacts")),
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

      const root = join(workspace, ".tracker/artifacts");
      const crashEntries = await readdir(root);
      assert.equal(crashEntries.some((name) => name.endsWith(".lock")), false);
      assert.equal(crashEntries.includes(`${sha256}.artifact`), false);
      assert.equal(crashEntries.length, 1);
      assert.match(crashEntries[0] ?? "", new RegExp(`^${sha256}\\.${String(child.pid)}\\..+\\.tmp$`, "u"));

      const recovery = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker"), join(workspace, ".tracker/artifacts")),
      });
      const ref = await recovery.put(bytes, { mediaType: "text/plain" });
      assert.equal(ref.sha256, sha256);
      assert.deepEqual(await readStream(await recovery.open(ref)), bytes);
      assert.deepEqual(await readdir(root), [`${sha256}.artifact`]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  })

  it("rejects relative fixture roots and symlinked storage roots", async () => {
    assert.throws(() => RuntimeAdmission.syntheticRoots("relative-workspace", "relative-workspace/artifacts"),
      /fixture path must be absolute/);

    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-symlink-"));
    const aliasRoot = await mkdtemp(join(tmpdir(), "hrauto-artifact-alias-"));
    const outside = await mkdtemp(join(tmpdir(), "hrauto-artifact-outside-"));
    try {
      const workspaceAlias = join(aliasRoot, "workspace");
      await symlink(workspace, workspaceAlias, "dir");
      assert.throws(() => RuntimeAdmission.syntheticRoots(join(workspaceAlias, ".tracker"), join(workspaceAlias, ".tracker/artifacts")),
        /unsafe synthetic fixture ancestor/);

      await symlink(outside, join(workspace, ".tracker"), "dir");
      assert.throws(() => RuntimeAdmission.syntheticRoots(join(workspace, ".tracker"), join(workspace, ".tracker/artifacts")),
        /unsafe synthetic fixture ancestor/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(aliasRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  })

  it("fails loud on corrupted artifact JSON, digest, payload, and length metadata", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-corrupt-"));
    try {
      const writer = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker"), join(workspace, ".tracker/artifacts")),
      });
      const bytes = new TextEncoder().encode("corruption fixture");
      const ref = await writer.put(bytes, { mediaType: "text/plain" });
      const path = join(workspace, ".tracker/artifacts", `${ref.sha256}.artifact`);
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
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker"), join(workspace, ".tracker/artifacts")),
      });
      const secondWriter = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker"), join(workspace, ".tracker/artifacts")),
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
      assert.deepEqual(await readdir(join(workspace, ".tracker/artifacts")), [
        `${winner.sha256}.artifact`,
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  })

  it("validates deterministic provider envelopes and fails loud when scripted outcomes end", async () => {
    const hash = FingerprintSchema.parse("a".repeat(64));
    const response = {
      state: "produced" as const,
      value: { schemaHash: hash, value: { text: "recognized" } },
    };
    const harness = createDeterministicProviderHarness("ocr.extract", [{
      kind: "return",
      estimate: { maximumCostUsdMicros: 0 },
      outcome: {
        response,
        usage: { requestCount: 1, costUsdMicros: 0 },
        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema.parse("2026-08-03T12:00:00.000Z") },
      },
    }]);
    const signal = new AbortController().signal;
    const request = { capability: "ocr.extract" as const, payload: { schemaHash: hash, value: { artifact: "fixture" } } };
    assert.deepEqual(harness.adapter.estimate(request), { maximumCostUsdMicros: 0 });
    assert.deepEqual(
      await harness.adapter.invoke(request, {
        signal,
        deadlineMonotonicMs: 100,
        admissionId: ProviderAdmissionIdSchema.parse("00000000-0000-4000-8000-000000000021"),
      }),
      {
        response,
        usage: { requestCount: 1, costUsdMicros: 0 },
        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema.parse("2026-08-03T12:00:00.000Z") },
      },
    );
    assert.equal(harness.calls().length, 1);
    assert.throws(() => harness.adapter.estimate(request), /no queued script/);
    assert.throws(
      () => harness.adapter.estimate({
        capability: "geocode.nominatim",
        payload: { schemaHash: hash, value: "fixture" },
      }),
      /cannot estimate capability geocode\.nominatim/,
    );
  })

  it("records deterministic session calls without manufacturing fallback results", async () => {
    const harness = createDeterministicSessionProvider(
      "onbase",
      ["already-authenticated", "logged-in"],
      { exclusive: true },
    );
    assert.equal(await harness.provider.login(undefined, { instance: "test" }), "already-authenticated");
    assert.equal(await harness.provider.login(undefined, {}), "logged-in");
    assert.equal(harness.calls().length, 2);
    await assert.rejects(harness.provider.login(undefined, {}), /no queued login result/);
  })
});
