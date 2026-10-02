import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { foundationFixture, admission, generic, id, NOW } from "./helpers/fixtures.js";
import { failure, terminalizeFixtureFailure } from "../../helpers/database-foundation/fixtures.js";
import { createGenericProviderAccounting, inspectGenericProviderAccounting } from "../../../src/backend/storage/sqlite/provider-accounting.js";
import { GenericProviderUsageSchema, type ProviderUsageStorage } from "../../../src/domain/provider-accounting.js";
import { sha256Hex } from "../../../src/domain/sha256.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";

const instant = (minute: number) => new Date(Date.parse(NOW) + minute * 60_000).toISOString();
const finish = (n: number, minute = 0) => ({ requestId: id(n), expectedVersion: 1, now: instant(minute),
  state: "settled", usage: [{ meter: "requests", quantity: { kind: "measured", value: 1 } }], reason: null });
function minuteRequest(f: ReturnType<typeof foundationFixture>, n: number, minute = 0, upperBound = 1) {
  const input = admission(f, n);
  return { ...input, now: instant(minute), budgets: input.budgets.map(b => ({ ...b, upperBound,
    windows: [{ ...b.windows[0], id: `minute-${minute}`, startsAt: instant(minute), endsAt: instant(minute + 1) }],
  })) };
}
function seedHistory(f: ReturnType<typeof foundationFixture>, count: number, active?: ProviderUsageStorage) {
  const template = active ?? generic(f).usage;
  assert.equal(template.kind, "generic");
  if (template.kind !== "generic") throw new Error("generic-usage-required");
  const usage = GenericProviderUsageSchema.parse({ ...template,
    usageId: `usage/${sha256Hex(canonicalJsonStringify([template.scope.id, template.meter]))}`,
    windows: [...Array.from({ length: count }, (_, n) => ({ id: `expired-${n}`,
      startsAt: instant(n - count), endsAt: instant(n - count + 1),
      settled: { kind: "measured", value: 1 }, retainedUnknown: 0, reserved: 0,
      limit: { kind: "configured", value: 3, provenance: "synthetic-policy" },
    })), ...(active === undefined ? [] : template.windows)],
    cumulative: { kind: "measured", value: count },
    tracking: { ...template.tracking, startedAt: instant(-count) }, createdAt: instant(-count),
    version: active === undefined ? 1 : template.version + 1,
  });
  f.db.authority.providerAccounting.transaction(s => s.writeUsage(usage, active === undefined ? null : template.version));
  return usage.tracking;
}
function verify(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try { inspectGenericProviderAccounting(raw); }
  finally { raw.close(); }
}

for (const count of [9999, 10000]) it(`rolls over ${count} finalized windows through deletion and reopen`, () => {
  const f = foundationFixture();
  let reopened: AuthorityDatabase | undefined;
  try {
    const otherRun = f.createRun(id(300));
    const tracking = seedHistory(f, count);
    verify(f.path);
    const accounting = createGenericProviderAccounting(f.db.authority.providerAccounting);
    assert.equal(accounting.reserve(minuteRequest(f, 400)).state, "reserved");
    accounting.finish(finish(400));
    assert.equal(accounting.read()[0].windows.length, 1);
    assert.deepEqual(accounting.read()[0].cumulative, { kind: "measured", value: count + 1 });
    assert.deepEqual(accounting.read()[0].tracking, tracking);
    const beforeDeletion = accounting.read();
    terminalizeFixtureFailure(f, f.run, failure());
    f.db.authority.runs.delete({ runId: f.run.envelope.runId, origin: "queue", commandId: id(500), now: NOW });
    assert.deepEqual(accounting.read(), beforeDeletion);
    f.db.close();
    reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "provider-rollover-test" }, f.clock);
    const next = createGenericProviderAccounting(reopened.authority.providerAccounting);
    const input = minuteRequest(f, 401, 1);
    assert.equal(next.reserve({ ...input, execution: { ...input.execution, runId: otherRun.envelope.runId } }).state, "reserved");
    assert.equal(next.read()[0].windows.length, 1);
    assert.deepEqual(next.read()[0].cumulative, { kind: "measured", value: count + 1 });
    assert.deepEqual(next.read()[0].tracking, tracking);
    verify(f.path);
  } finally { reopened?.close(); f.dispose(); }
});

for (const upperBound of [0, 1]) it(`retains original active allocations with bound ${upperBound} until late settlement and exact replay`, () => {
  const f = foundationFixture();
  let reopened: AuthorityDatabase | undefined;
  try {
    let accounting = createGenericProviderAccounting(f.db.authority.providerAccounting);
    const original = minuteRequest(f, 410, 0, upperBound);
    assert.equal(accounting.reserve(original).state, "reserved");
    const usage = accounting.read()[0];
    const { windows, ...stored } = usage;
    seedHistory(f, 9999, { ...stored, windows: windows.map(({ remaining: _remaining, ...window }) => window) });
    verify(f.path);
    assert.equal(accounting.reserve(minuteRequest(f, 411, 1)).state, "reserved");
    assert.deepEqual(accounting.read()[0].windows.map(w => w.id), ["minute-0", "minute-1"]);
    f.db.close();
    reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "provider-late-test" }, f.clock);
    accounting = createGenericProviderAccounting(reopened.authority.providerAccounting);
    accounting.finish(finish(410, 1));
    assert.equal(accounting.read()[0].windows[0].reserved, 0);
    assert.deepEqual(accounting.read()[0].windows[0].settled, { kind: "measured", value: 1 });
    accounting.finish(finish(411, 1));
    assert.equal(accounting.reserve(minuteRequest(f, 412, 2)).state, "reserved");
    const final = accounting.read(), generation = reopened.getMeta().authorityGeneration;
    assert.deepEqual(final[0].windows.map(w => w.id), ["minute-2"]);
    assert.deepEqual(final[0].cumulative, { kind: "measured", value: 10001 });
    assert.equal(accounting.reserve(original).state, "existing");
    accounting.finish(finish(410, 1));
    assert.deepEqual(accounting.read(), final);
    assert.equal(reopened.getMeta().authorityGeneration, generation);
    assert.throws(() => accounting.finish({ ...finish(410, 1), reason: "changed replay" }), /replay-conflict/u);
    verify(f.path);
  } finally { reopened?.close(); f.dispose(); }
});

for (const upperBound of [0, 1]) it(`keeps integrity when an expired finalized window label is reused after bound ${upperBound}`, () => {
  const f = foundationFixture();
  let reopened: AuthorityDatabase | undefined;
  try {
    const accounting = createGenericProviderAccounting(f.db.authority.providerAccounting);
    const original = minuteRequest(f, 420, 0, upperBound);
    const later = minuteRequest(f, 421, 1);
    const reused = { ...later, budgets: later.budgets.map(b => ({ ...b,
      windows: b.windows.map(w => ({ ...w, id: "minute-0" })),
    })) };
    assert.equal(accounting.reserve(original).state, "reserved");
    const active = accounting.read(), activeGeneration = f.db.getMeta().authorityGeneration;
    assert.throws(() => accounting.reserve(reused), /provider-window-policy-conflict/u);
    assert.deepEqual(accounting.read(), active);
    assert.equal(f.db.getMeta().authorityGeneration, activeGeneration);
    accounting.finish(finish(420, 1));
    assert.equal(accounting.reserve(reused).state, "reserved");
    verify(f.path);
    assert.equal(accounting.read()[0].windows[0].startsAt, instant(1));
    accounting.finish(finish(421, 1));
    assert.deepEqual(accounting.read()[0].cumulative, { kind: "measured", value: 2 });
    const final = accounting.read(), generation = f.db.getMeta().authorityGeneration;
    assert.equal(accounting.reserve(original).state, "existing");
    accounting.finish(finish(420, 1));
    assert.deepEqual(accounting.read(), final);
    assert.equal(f.db.getMeta().authorityGeneration, generation);
    // Finalization alone cannot forgive a corrupt window still inside its period.
    const raw = new DatabaseSync(f.path);
    try {
      const saved = raw.prepare("SELECT record_json FROM provider_usage WHERE json_extract(record_json,'$.kind')='generic'").get()?.record_json;
      assert.equal(typeof saved, "string");
      raw.prepare("UPDATE provider_usage SET record_json=json_set(record_json,'$.windows[0].startsAt',?) WHERE json_extract(record_json,'$.kind')='generic'").run(new Date(Date.parse(instant(1)) + 1000).toISOString());
      assert.throws(() => inspectGenericProviderAccounting(raw), /provider-generic-allocation-mismatch/u);
      raw.prepare("UPDATE provider_usage SET record_json=? WHERE json_extract(record_json,'$.kind')='generic'").run(saved!);
      inspectGenericProviderAccounting(raw);
    } finally { raw.close(); }
    f.db.close();
    reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "provider-label-reuse" }, f.clock);
    assert.deepEqual(createGenericProviderAccounting(reopened.authority.providerAccounting).read(), final);
  } finally { reopened?.close(); f.dispose(); }
});
