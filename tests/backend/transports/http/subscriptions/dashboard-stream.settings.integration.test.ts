import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { buildSettingsEditor } from "../../../../../src/backend/runs/queries/settings-editor.js";
import { createProtectedSettingsRuntimeReader } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { createDashboardStreamHub, type DashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { initialProtectedStoreRecord } from "../../../../../src/models/config/protected-settings.js";
import { initialSettingsFileRecord, settingsRuntimeIdentity } from "../../../../../src/models/config/settings.js";
import { EditableSettingsWireSchema, type EditableSettingsWire } from "../../../../../src/models/dashboard/settings-editor.js";
import type { DashboardStreamEnvelope, StreamRow } from "../../../../../src/models/dashboard/subscription.js";
import { DAY, makeWorld, type DashboardWorld } from "../../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [], hubs: DashboardStreamHub[] = [];
afterEach(async () => { for (const hub of hubs.splice(0)) hub.close(); for (const world of worlds.splice(0)) await world.dispose(); });

/** A hub serving the editable document the test sets, whose read the test can make throw, and the commit signal it hears. */
async function setup() {
  const world = await makeWorld(); worlds.push(world);
  const record = initialSettingsFileRecord();
  const fingerprint = resolveConfigWithProvenance({}, hostConfigFacts({}), world.clock).fingerprint;
  const initial = buildSettingsEditor({ protectedSettings: createProtectedSettingsRuntimeReader({ read: initialProtectedStoreRecord }),
    settings: { read: () => ({ record, runtimeStatus: { state: "current", identity: settingsRuntimeIdentity(record, fingerprint) } }) },
    environment: {}, clock: world.clock });
  let document: EditableSettingsWire = initial, throws = false;
  const listeners = new Set<() => void>();
  const timers: { delayMs: number; task: () => void; cancelled: boolean }[] = [];
  const hub = createDashboardStreamHub({
    projection: world.projection,
    backfillGaps: { detected: () => { throw new Error("no gap is expected"); } },
    settings: {
      read: () => { if (throws) throw new Error("settings read failed"); return document; },
      onChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    schedule: (delayMs, task) => { const timer = { delayMs, task, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
  }); hubs.push(hub);
  return {
    world, hub, initial, listeners,
    commit: (revision: number) => {
      assert(initial.runtimeStatus.state === "current");
      // The document's revision must match its runtime identity's, or the row fails its schema.
      document = EditableSettingsWireSchema.parse({ ...initial, revision,
        runtimeStatus: { state: "current", identity: { ...initial.runtimeStatus.identity, settingsRevision: revision } } });
      for (const listener of [...listeners]) listener();
    },
    failReads: (value: boolean) => { throws = value; },
    fire: () => { const due = timers.splice(0).filter(timer => !timer.cancelled); for (const timer of due) timer.task(); return due; },
  };
}

type SettingsRow = Extract<StreamRow, { model: "settings" }>;
const settingsOf = (envelope: DashboardStreamEnvelope | undefined): SettingsRow["value"] | undefined => {
  if (envelope?.type !== "snapshot" && envelope?.type !== "change") return undefined;
  return envelope.rows.find((row): row is SettingsRow => row.model === "settings")?.value;
};
const revisionOf = (envelope: DashboardStreamEnvelope | undefined): number | undefined => {
  const value = settingsOf(envelope);
  return value?.state === "available" ? value.value.revision : undefined;
};

it("carries the settings row in the snapshot and one rows-only change per commit", async () => {
  const { hub, initial, commit } = await setup();
  const connection = await hub.connect({ day: DAY });
  const snapshot = connection.initial.find(envelope => envelope.type === "snapshot");
  assert(snapshot?.type === "snapshot");
  assert.deepEqual(snapshot.rows, [{ model: "settings", key: "editable", value: { state: "available", value: initial } }]);

  commit(initial.revision + 1);

  const change = await connection.next();
  assert(change?.type === "change");
  assert.equal(change.day, undefined, "a settings change carries no day part");
  assert.equal(change.after, snapshot.cursor);
  assert.equal(revisionOf(change), initial.revision + 1);
  assert.equal(connection.pending, 0, "one commit, one row");
  connection.close();
});

it("carries the settings row in a resumed handoff", async () => {
  const { world, hub, initial } = await setup();
  const first = await hub.connect({ day: DAY });
  const held = world.projection.cursor();
  first.close();
  const resumed = await hub.connect({ day: DAY, lastEventId: held, lastProjectionGeneration: world.projection.generation() });
  assert.equal(revisionOf(resumed.initial.at(-1)), initial.revision);
  resumed.close();
});

it("sends a first settings row that cannot be read as unavailable, then the retry's document", async () => {
  const { hub, initial, failReads, fire } = await setup();
  failReads(true);
  const connection = await hub.connect({ day: DAY });
  assert.equal(settingsOf(connection.initial.find(envelope => envelope.type === "snapshot"))?.state, "unavailable");
  failReads(false);
  assert.deepEqual(fire().map(timer => timer.delayMs), [5_000]);
  assert.equal(revisionOf(await connection.next()), initial.revision);
  assert.equal(fire().length, 0, "an available row is not read again");
  connection.close();
});

it("sends a commit whose row cannot be read as unavailable, then the retried document", async () => {
  const { hub, initial, commit, failReads, fire } = await setup();
  const connection = await hub.connect({ day: DAY });
  failReads(true);
  commit(initial.revision + 1);
  assert.equal(settingsOf(await connection.next())?.state, "unavailable");
  failReads(false);
  fire();
  assert.equal(revisionOf(await connection.next()), initial.revision + 1);
  connection.close();
});

it("drops its commit listener on close", async () => {
  const { hub, listeners } = await setup();
  assert.equal(listeners.size, 1);
  hub.close();
  assert.equal(listeners.size, 0);
});
