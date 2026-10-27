import { createWiredCapabilityTask } from "../../../support/helpers/backend/capability-wiring-world.js";
import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { createDeterministicProviderHarness } from "../../../../src/backend/processing/providers/deterministic-provider.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { FingerprintSchema, IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import type { ContentAddressedArtifactWriter } from "../../../../src/workflow-kit/artifacts.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { HASH_A, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { disposers, SIGNAL, SCENARIO, FIXTURE_BYTES, PAYLOAD, FixtureOutput: _FixtureOutput, providersOnlyContract, artifactsOnlyContract, wiredContract, byteLength, fixtureDescriptor, queuedRunFor, wiringHarness, claim, cleanup } = createCapabilityWiringTestWorld();

afterEach(cleanup);

let observed: { artifactSha?: string; artifactBytes?: number; providerState?: string } = {};

const _providersOnlyTask = defineTask(providersOnlyContract, {
  sessions: [],
  async run(): Promise<z.output<typeof _FixtureOutput>> {
    throw new Error("providers refusal fixture must never be invoked without wiring");
  },
});

const _artifactsOnlyTask = defineTask(artifactsOnlyContract, {
  sessions: [],
  async run(): Promise<z.output<typeof _FixtureOutput>> {
    throw new Error("artifacts refusal fixture must never be invoked without wiring");
  },
});

const wiredTask = createWiredCapabilityTask(wiredContract, FIXTURE_BYTES, PAYLOAD, byteLength, () => observed);
const wiredDescriptor = fixtureDescriptor("wiring-wired", "ww", wiredContract);

function registryFor(task: typeof _providersOnlyTask | typeof _artifactsOnlyTask | typeof wiredTask) {
  const store = defineServiceStore("ocr", { fixture: task });
  return defineTaskStoreRegistry([store], {
    scenarioIds: [SCENARIO],
    tasks: [{ id: task.contract.id, effect: task.contract.effect }],
  });
}

function admissionIdFactory() {
  let next = 0;
  return Object.freeze({
    next: () => {
      next += 1;
      return `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
    },
  });
}

function tempArtifactWriter(): ContentAddressedArtifactWriter {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hrauto-wiring-artifacts-"));
  disposers.push(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  return createContentAddressedArtifactWriter({
    admission: RuntimeAdmission.syntheticRoots(join(workspaceRoot, ".tracker"), join(workspaceRoot, ".tracker/data/artifacts")),
  });
}

describe("executor capability wiring, wired", () => {
  it("mints current clients over the retained snapshot and injects request identity", async () => {
    observed = {};
    const adapter = createDeterministicProviderHarness("geocode.census", [{
      kind: "return",

      outcome: {
        response: {
          state: "produced",
          value: { schemaHash: FingerprintSchema.parse(HASH_A), value: { extracted: true } },
        },

        evidence: { summary: "deterministic wiring fixture", capturedAt: IsoInstantSchema.parse(NOW) },
      },
    }]);
    const artifacts = tempArtifactWriter();
    const harness = await wiringHarness(wiredDescriptor, registryFor(wiredTask));
    const { database } = harness.authority;
    const admissionIds = admissionIdFactory();
    const deps: RunExecutorDependencies = {
      ...harness.deps,
      providers: Object.freeze({
        adapters: { "geocode.census": adapter.adapter },

        configSnapshots: database.authority.configSnapshots,
        idFactory: admissionIds,
      }),
      artifacts,
    };
    database.authority.runs.enqueue(queuedRunFor(wiredDescriptor));
    const claimed = claim(harness.authority, wiredDescriptor);

    const outcome = await executeClaimedRun(deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");

    // The task saw the REAL wired capabilities: the writer round-tripped the
    // exact bytes, and the provider answer arrived through admission.
    assert.equal(observed.artifactBytes, FIXTURE_BYTES.byteLength);
    assert.equal(observed.artifactSha?.length, 64);
    assert.equal(observed.providerState, "produced");

    // Exactly one adapter call, carrying the task's payload under the declared
    // capability — the client added nothing and dropped nothing.
    const calls = adapter.calls();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.request, { capability: "geocode.census", payload: PAYLOAD });


    assert.equal(calls[0]?.options.requestId, "00000000-0000-4000-8000-000000000001");

  });
});
