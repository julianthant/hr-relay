import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { afterEach,describe,it } from "vitest";
import { createDeterministicProviderHarness } from "../../../../src/backend/processing/providers/deterministic-provider.js";
import { executeClaimedRun,type RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { defineServiceStore,defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";

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
    const harness = await wiringHarness(providersDescriptor, registryFor(providersOnlyTask));
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
      const snapshot = z.strictObject({ id: z.string(), revision: z.number(), fingerprint: z.string(),
        payload_json: z.string(), captured_at: z.string() }).parse(
        raw.prepare("SELECT * FROM settings_snapshots WHERE id=?").get(claimed.run.envelope.configSnapshotId));
      assert.ok(database.authority.configSnapshots.get(claimed.run.envelope.configSnapshotId));
      const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name='settings_snapshots_retained'").get();
      if (typeof trigger?.sql !== "string") throw new Error("fixture immutable snapshot trigger missing");
      raw.exec("PRAGMA foreign_keys=OFF");
      raw.exec("DROP TRIGGER settings_snapshots_retained");
      try { raw.prepare("DELETE FROM settings_snapshots WHERE id=?").run(claimed.run.envelope.configSnapshotId); }
      finally { raw.exec(trigger.sql); }
      try {
        await assert.rejects(executeClaimedRun(deps, { ...claimed, signal: SIGNAL }), /settings-snapshot-missing/u);
        assert.equal(raw.prepare("SELECT state FROM runs WHERE id=?").get(claimed.run.envelope.runId)?.state, "claimed");
        assert.equal(adapter.calls().length, 0);
      } finally {
        raw.prepare("INSERT INTO settings_snapshots(id,revision,fingerprint,payload_json,captured_at) VALUES(?,?,?,?,?)")
          .run(snapshot.id, snapshot.revision, snapshot.fingerprint, snapshot.payload_json, snapshot.captured_at);
        assert.deepEqual({ ...raw.prepare("SELECT * FROM settings_snapshots WHERE id=?").get(snapshot.id) }, snapshot);
      }
    } finally { raw.close(); }
  });
});
}
