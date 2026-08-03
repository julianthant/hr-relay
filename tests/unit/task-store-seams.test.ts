import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  declareDriver,
  declareDriverFor,
  defineBrowserStore,
  defineServiceStore,
  defineTaskStoreRegistry,
} from "../../src/base/store.js";
import {
  createDeterministicSessionProvider,
  defineUnwiredSessionProvider,
} from "../../src/base/session.js";
import { defineTask } from "../../src/base/task.js";
import { defineTaskContract } from "../../src/domain/contracts/base.js";
import {
  FingerprintSchema,
  IsoInstantSchema,
  ProviderAdmissionIdSchema,
  ScenarioIdSchema,
  taskId,
} from "../../src/domain/ids.js";
import type { UcpathPersonOrgDriver } from "../../src/domain/ui/ucpath-person-org.js";
import { createContentAddressedArtifactWriter } from "../../src/infra/artifacts/content-addressed-artifact-writer.js";
import type { ArtifactWriteFaultStep } from "../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { createDeterministicProviderHarness } from "../../src/infra/providers/deterministic-provider.js";
import { browserStoreRegistry } from "../../src/stores/index.js";

const SCENARIO = ScenarioIdSchema.parse("ucpath/store-fixture-happy");
const INPUT = z.strictObject({ value: z.string().min(1) });
const OUTPUT = z.strictObject({ value: z.string().min(1) });
const FIXTURE_DRIVER = declareDriverFor<UcpathPersonOrgDriver>()("ucpath", "semantic-ready");

function fixtureReadContract() {
  return defineTaskContract({
    id: taskId("ucpath/search-store-fixture"),
    title: "Search store fixture",
    effect: "read",
    input: INPUT,
    output: OUTPUT,
    errorCodes: ["fixture-missing"] as const,
    subject: { kind: "none", reason: "registry resolution fixture" },
    scenarios: [SCENARIO],
    freshness: { defaultMaxAgeMs: 0 },
    provenance: { default: "live" },
    example: { value: "fixture" },
  });
}

function fixtureReadTask() {
  const contract = fixtureReadContract();
  return defineTask(FIXTURE_DRIVER, contract, {
    sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
    async run({ input }) {
      return input;
    },
  });
}

async function readStream(stream: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("test artifact stream emitted non-bytes");
    chunks.push(Uint8Array.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

describe("task, store, session, provider, and artifact seams", () => {
  it("declares all nine browser stores with wired worker authentication and OnBase-only exclusivity", async () => {
    const expected = [
      "crm",
      "i9",
      "kuali",
      "new-kronos",
      "old-kronos",
      "onbase",
      "servicenow",
      "sharepoint",
      "ucpath",
    ];
    assert.deepEqual(browserStoreRegistry.stores.map(({ namespace }) => namespace).sort(), expected);
    const authenticated: string[] = [];
    const handle = {
      authenticate(system: string) {
        authenticated.push(system);
        return Promise.resolve("logged-in" as const);
      },
    };
    for (const store of browserStoreRegistry.stores) {
      assert.equal(store.kind, "browser");
      assert.equal(store.driver.system, store.namespace);
      assert.equal(store.session.system, store.namespace);
      assert.equal(store.session.exclusive === true, store.namespace === "onbase");
      assert.equal(await store.session.login(handle, {}), "logged-in");
    }
    assert.deepEqual(authenticated.sort(), expected);
    assert.throws(() => defineUnwiredSessionProvider("onbase"), /must declare exclusive:true/);
    assert.throws(
      () => defineUnwiredSessionProvider("ucpath", { exclusive: true }),
      /cannot declare exclusive:true/,
    );
  });

  it("binds tasks to exact effects/sessions and resolves corpus references in the store registry", () => {
    const task = fixtureReadTask();
    const session = createDeterministicSessionProvider("ucpath", ["logged-in"]).provider;
    const store = defineBrowserStore(
      "ucpath",
      FIXTURE_DRIVER,
      session,
      { searchStoreFixture: task },
    );
    assert.equal(task.driver, FIXTURE_DRIVER);
    assert.equal(store.tasks.searchStoreFixture.driver, store.driver);
    const corpus = {
      scenarioIds: [SCENARIO],
      tasks: [{ id: task.contract.id, effect: task.contract.effect }],
    };
    assert.doesNotThrow(() => defineTaskStoreRegistry([store], corpus));
    assert.throws(
      () => defineTaskStoreRegistry([store], { ...corpus, scenarioIds: [] }),
      /unresolved scenario/,
    );
    assert.throws(
      () => defineTaskStoreRegistry([store], { scenarioIds: [SCENARIO], tasks: [] }),
      /absent from the contract corpus/,
    );
    assert.throws(() => Reflect.apply(defineTask, undefined, [FIXTURE_DRIVER, task.contract, {
      sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
      run: async ({ input }: { input: z.output<typeof INPUT> }) => input,
    }]), /requires read session access/);
    assert.throws(() => Reflect.apply(defineTask, undefined, [FIXTURE_DRIVER, { ...task.contract }, task.impl]),
      /exact contract object returned by defineTaskContract/);
    assert.throws(() => Reflect.apply(defineTask, undefined, [FIXTURE_DRIVER, task.contract, { run: task.impl.run }]),
      /requires sessions/);
    assert.throws(
      () => Reflect.apply(defineTask, undefined, [declareDriver("crm", "unwired"), task.contract, task.impl]),
      /cannot bind crm driver/,
    );
    const replacementDriver = declareDriverFor<UcpathPersonOrgDriver>()("ucpath", "semantic-ready");
    assert.throws(
      () => defineBrowserStore("ucpath", replacementDriver, session, { searchStoreFixture: task }),
      /must use the browser store's exact driver declaration/,
    );
    assert.throws(
      () => defineBrowserStore("crm", declareDriver("crm", "unwired"), session, {}),
      /cannot use ucpath session provider/,
    );
  });

  it("keeps service tasks sessionless and provider declarations capability-narrowed", () => {
    const scenario = ScenarioIdSchema.parse("ocr/provider-fixture-happy");
    const contract = defineTaskContract({
      id: taskId("ocr/read-provider-fixture"),
      title: "Read provider fixture",
      effect: "read",
      input: z.strictObject({}),
      output: OUTPUT,
      errorCodes: ["provider-unavailable"] as const,
      providers: ["ocr.extract"] as const,
      subject: { kind: "none", reason: "service provider fixture" },
      scenarios: [scenario],
      freshness: { defaultMaxAgeMs: 0 },
      provenance: { default: "derived" },
      example: { value: "fixture" },
    });
    const task = defineTask(contract, {
      sessions: [],
      async run() {
        return { value: "fixture" };
      },
    });
    const store = defineServiceStore("ocr", { readProviderFixture: task });
    assert.throws(
      () => Reflect.apply(defineTask, undefined, [FIXTURE_DRIVER, contract, task.impl]),
      /headless task cannot bind a browser driver/,
    );
    assert.doesNotThrow(() => defineTaskStoreRegistry([store], {
      scenarioIds: [scenario],
      tasks: [{ id: contract.id, effect: "read" }],
    }));
  });

  it("atomically persists and deduplicates content bytes without exposing a backing path", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifacts-"));
    try {
      assert.throws(() => createContentAddressedArtifactWriter({
        workspaceRoot: workspace,
        artifactRoot: ".tracker/artifacts",
      }), /Invalid input/);
      const writer = createContentAddressedArtifactWriter({
        workspaceRoot: workspace,
        artifactRoot: ".tracker-rebuild/artifacts",
      });
      const bytes = new TextEncoder().encode("same immutable bytes");
      const first = await writer.put(bytes, { mediaType: "text/plain" });
      const reopenedWriter = createContentAddressedArtifactWriter({
        workspaceRoot: workspace,
        artifactRoot: ".tracker-rebuild/artifacts",
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
        (await readdir(join(workspace, ".tracker-rebuild/artifacts"))).sort(),
        [`${first.sha256}.artifact`],
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

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
          workspaceRoot: workspace,
          artifactRoot: ".tracker-rebuild/artifacts",
          injectFault(actual) {
            if (armed && actual === step) {
              armed = false;
              throw new Error(`injected ${step}`);
            }
          },
        });
        await assert.rejects(faulting.put(bytes, { mediaType: "text/plain" }), new RegExp(`injected ${step}`));
        const recovery = createContentAddressedArtifactWriter({
          workspaceRoot: workspace,
          artifactRoot: ".tracker-rebuild/artifacts",
        });
        const ref = await recovery.put(bytes, { mediaType: "text/plain" });
        assert.deepEqual(await readStream(await recovery.open(ref)), bytes);
        assert.deepEqual(
          (await readdir(join(workspace, ".tracker-rebuild/artifacts"))).sort(),
          [`${ref.sha256}.artifact`],
        );
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }
  });

  it("recovers after a child process is hard-killed before publication", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-hard-crash-"));
    const bytes = new TextEncoder().encode("hard crash before publication");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const writerModuleUrl = new URL(
      "../../src/infra/artifacts/content-addressed-artifact-writer.ts",
      import.meta.url,
    ).href;
    const childSource = `
      import { createContentAddressedArtifactWriter } from ${JSON.stringify(writerModuleUrl)};
      const writer = createContentAddressedArtifactWriter({
        workspaceRoot: ${JSON.stringify(workspace)},
        artifactRoot: ".tracker-rebuild/artifacts",
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

      const root = join(workspace, ".tracker-rebuild/artifacts");
      const crashEntries = await readdir(root);
      assert.equal(crashEntries.some((name) => name.endsWith(".lock")), false);
      assert.equal(crashEntries.includes(`${sha256}.artifact`), false);
      assert.equal(crashEntries.length, 1);
      assert.match(crashEntries[0] ?? "", new RegExp(`^${sha256}\\.${String(child.pid)}\\..+\\.tmp$`, "u"));

      const recovery = createContentAddressedArtifactWriter({
        workspaceRoot: workspace,
        artifactRoot: ".tracker-rebuild/artifacts",
      });
      const ref = await recovery.put(bytes, { mediaType: "text/plain" });
      assert.equal(ref.sha256, sha256);
      assert.deepEqual(await readStream(await recovery.open(ref)), bytes);
      assert.deepEqual(await readdir(root), [`${sha256}.artifact`]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects relative workspaces, a symlinked workspace, and symlinked rebuild roots", async () => {
    const relativeWriter = createContentAddressedArtifactWriter({
      workspaceRoot: "relative-workspace",
      artifactRoot: ".tracker-rebuild/artifacts",
    });
    await assert.rejects(
      relativeWriter.put(new Uint8Array(), { mediaType: "application/octet-stream" }),
      /workspaceRoot must be absolute/,
    );

    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-symlink-"));
    const aliasRoot = await mkdtemp(join(tmpdir(), "hrauto-artifact-alias-"));
    const outside = await mkdtemp(join(tmpdir(), "hrauto-artifact-outside-"));
    try {
      const workspaceAlias = join(aliasRoot, "workspace");
      await symlink(workspace, workspaceAlias, "dir");
      const aliasWriter = createContentAddressedArtifactWriter({
        workspaceRoot: workspaceAlias,
        artifactRoot: ".tracker-rebuild/artifacts",
      });
      await assert.rejects(
        aliasWriter.put(new Uint8Array(), { mediaType: "application/octet-stream" }),
        /artifact workspace root cannot be a symbolic link/,
      );

      await symlink(outside, join(workspace, ".tracker-rebuild"), "dir");
      const writer = createContentAddressedArtifactWriter({
        workspaceRoot: workspace,
        artifactRoot: ".tracker-rebuild/artifacts",
      });
      await assert.rejects(
        writer.put(new Uint8Array(), { mediaType: "application/octet-stream" }),
        /cannot be a symbolic link/,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(aliasRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("fails loud on corrupted artifact JSON, digest, payload, and length metadata", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-corrupt-"));
    try {
      const writer = createContentAddressedArtifactWriter({
        workspaceRoot: workspace,
        artifactRoot: ".tracker-rebuild/artifacts",
      });
      const bytes = new TextEncoder().encode("corruption fixture");
      const ref = await writer.put(bytes, { mediaType: "text/plain" });
      const path = join(workspace, ".tracker-rebuild/artifacts", `${ref.sha256}.artifact`);
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
  });

  it("atomically converges concurrent same-digest writes on one winner ref", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-concurrent-"));
    try {
      const firstWriter = createContentAddressedArtifactWriter({
        workspaceRoot: workspace,
        artifactRoot: ".tracker-rebuild/artifacts",
      });
      const secondWriter = createContentAddressedArtifactWriter({
        workspaceRoot: workspace,
        artifactRoot: ".tracker-rebuild/artifacts",
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
      assert.deepEqual(await readdir(join(workspace, ".tracker-rebuild/artifacts")), [
        `${winner.sha256}.artifact`,
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

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
        capability: "ai.advisory",
        payload: { schemaHash: hash, value: "fixture" },
      }),
      /cannot estimate capability ai\.advisory/,
    );
  });

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
  });
});
