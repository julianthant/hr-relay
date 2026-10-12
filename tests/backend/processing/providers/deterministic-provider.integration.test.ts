import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createDeterministicProviderHarness } from "../../../../src/backend/processing/providers/deterministic-provider.js";
import { executeClaimedRun, type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { FingerprintSchema, IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";

{

const { SIGNAL, SCENARIO, providersOnlyContract, fixtureDescriptor, wiringHarness, queuedRunFor, claim, cleanup } = createCapabilityWiringTestWorld();

const providersOnlyTask = defineTask(providersOnlyContract, {
  sessions: [],
  async run() {
    throw new Error("providers refusal fixture must never be invoked without wiring");
  },
});

const providersDescriptor = fixtureDescriptor("wiring-refusal-providers", "wp", providersOnlyContract);

function registryFor(task: typeof providersOnlyTask) {
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

/* ── the arms ────────────────────────────────────────────────────────────── */

describe("executor capability wiring refusals", () => {
afterEach(cleanup);

  it("refuses provider admission when the run's retained config snapshot is absent", async () => {
    const adapter = createDeterministicProviderHarness("geocode.census", []);
    const harness = wiringHarness(providersDescriptor, registryFor(providersOnlyTask));
    const { database } = harness.authority;
    const deps: RunExecutorDependencies = {
      ...harness.deps,
      providers: Object.freeze({
        adapters: { "geocode.census": adapter.adapter },

        configSnapshots: database.authority.configSnapshots,
        idFactory: admissionIdFactory(),
      }),
    };
    database.authority.runs.enqueue(queuedRunFor(providersDescriptor));
    const claimed = claim(harness.authority, providersDescriptor);

    const raw = new DatabaseSync(harness.authority.path);
    try {
      const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name='settings_snapshots_retained'").get();
      if (typeof trigger?.sql !== "string") throw new Error("fixture immutable snapshot trigger missing");
      raw.exec("PRAGMA foreign_keys=OFF");
      raw.exec("DROP TRIGGER settings_snapshots_retained");
      try { raw.prepare("DELETE FROM settings_snapshots WHERE id=?").run(claimed.run.envelope.configSnapshotId); }
      finally { raw.exec(trigger.sql); }
    } finally { raw.close(); }
    await assert.rejects(executeClaimedRun(deps, { ...claimed, signal: SIGNAL }), /settings-snapshot-missing/u);
    const unchanged = new DatabaseSync(harness.authority.path, { readOnly: true });
    try { assert.equal(unchanged.prepare("SELECT state FROM runs WHERE id=?").get(claimed.run.envelope.runId)?.state, "claimed"); } finally { unchanged.close(); }
    assert.equal(adapter.calls().length, 0);
  });
});
}

{

describe("task, store, session, provider, and artifact seams", () => {

  it("validates deterministic provider envelopes and fails loud when scripted outcomes end", async () => {
    const hash = FingerprintSchema.parse("a".repeat(64));
    const response = {
      state: "produced" as const,
      value: { schemaHash: hash, value: { text: "recognized" } },
    };
    const harness = createDeterministicProviderHarness("ocr.extract", [{
      kind: "return",

      outcome: {
        response,

        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema.parse("2026-08-03T12:00:00.000Z") },
      },
    }]);
    const signal = new AbortController().signal;
    const request = { capability: "ocr.extract" as const, payload: { schemaHash: hash, value: { artifact: "fixture" } } };
    assert.deepEqual(
      await harness.adapter.invoke(request, {
        signal,
        deadlineMonotonicMs: 100,
        requestId: "00000000-0000-4000-8000-000000000021",
      }),
      {
        response,

        evidence: { summary: "deterministic fixture", capturedAt: IsoInstantSchema.parse("2026-08-03T12:00:00.000Z") },
      },
    );
    assert.equal(harness.calls().length, 1);
    await assert.rejects(harness.adapter.invoke(request, { signal, deadlineMonotonicMs: 100, requestId: "00000000-0000-4000-8000-000000000022" }), /no queued script/);
    await assert.rejects(harness.adapter.invoke({ capability: "geocode.nominatim", payload: request.payload }, { signal, deadlineMonotonicMs: 100, requestId: "00000000-0000-4000-8000-000000000023" }), /cannot invoke capability/);

  })
});
}
