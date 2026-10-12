import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";

const {SIGNAL, SCENARIO, FIXTURE_BYTES, PAYLOAD, FixtureOutput: _FixtureOutput, providersOnlyContract, artifactsOnlyContract, wiredContract, byteLength, fixtureDescriptor, queuedRunFor, wiringHarness, claim, cleanup } = createCapabilityWiringTestWorld();

afterEach(cleanup);

const observed: { artifactSha?: string; artifactBytes?: number; providerState?: string } = {};

const providersOnlyTask = defineTask(providersOnlyContract, {
  sessions: [],
  async run(): Promise<z.output<typeof _FixtureOutput>> {
    throw new Error("providers refusal fixture must never be invoked without wiring");
  },
});

const artifactsOnlyTask = defineTask(artifactsOnlyContract, {
  sessions: [],
  async run(): Promise<z.output<typeof _FixtureOutput>> {
    throw new Error("artifacts refusal fixture must never be invoked without wiring");
  },
});

const _wiredTask = defineTask(wiredContract, {
  sessions: [],
  async run({ ctx }) {
    const ref = await ctx.artifacts.put(FIXTURE_BYTES, { mediaType: "text/plain" });
    const bytes = await byteLength(await ctx.artifacts.open(ref));
    const response = await ctx.providers["geocode.census"].call(PAYLOAD);
    if (response.state !== "produced") {
      ctx.fail("provider-unavailable", `ocr.extract answered ${response.state}`);
    }
    observed.artifactSha = ref.sha256;
    observed.artifactBytes = bytes;
    observed.providerState = response.state;
    ctx.recordData([
      { direction: "read", field: "providerState", value: response.state },
      { direction: "read", field: "artifactSha", value: ref.sha256 },
      { direction: "read", field: "artifactBytes", value: bytes },
    ]);
    return { providerState: response.state, artifactSha: ref.sha256, artifactBytes: bytes };
  },
});

const providersDescriptor = fixtureDescriptor("wiring-refusal-providers", "wp", providersOnlyContract);
const artifactsDescriptor = fixtureDescriptor("wiring-refusal-artifacts", "wa", artifactsOnlyContract);

function registryFor(task: typeof providersOnlyTask | typeof artifactsOnlyTask | typeof _wiredTask) {
  const store = defineServiceStore("ocr", { fixture: task });
  return defineTaskStoreRegistry([store], {
    scenarioIds: [SCENARIO],
    tasks: [{ id: task.contract.id, effect: task.contract.effect }],
  });
}

function terminalFailure(database: AuthorityDatabase) {
  const run = database.authority.runs.get(RUN_ID);
  assert.ok(run !== undefined && run.lifecycle.state === "terminal");
  const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
  assert.ok(failureId !== undefined);
  const failure = database.authority.failures.get(failureId);
  assert.ok(failure !== undefined);
  return failure;
}

/* ── the arms ────────────────────────────────────────────────────────────── */

describe("executor capability wiring refusals", () => {
  it("refuses a providers-declaring contract when the composition wires no admitted client", async () => {
    const harness = wiringHarness(providersDescriptor, registryFor(providersOnlyTask));
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(providersDescriptor));
    const claimed = claim(harness.authority, providersDescriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const failure = terminalFailure(database);
    assert.equal(failure.nodeId, "extract");
    assert.match(failure.summary, /wires no admitted provider client/u);
  });

  it("refuses an artifacts-declaring contract when the composition wires no writer", async () => {
    const harness = wiringHarness(artifactsDescriptor, registryFor(artifactsOnlyTask));
    const { database } = harness.authority;
    database.authority.runs.enqueue(queuedRunFor(artifactsDescriptor));
    const claimed = claim(harness.authority, artifactsDescriptor);

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const failure = terminalFailure(database);
    assert.equal(failure.nodeId, "extract");
    assert.match(failure.summary, /wires no artifact writer/u);
  });
});
