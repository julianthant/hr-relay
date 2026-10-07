import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "vitest";

const probe = String.raw`
  import assert from 'node:assert/strict';
  import { createHash, randomUUID } from 'node:crypto';
  import { resolutionFixture, resolutionCommand } from '../../../failure-resolution/tests/support/helpers/failure-resolution/fixtures.ts';
  import { createTimelineEmitter } from '../../../failure-resolution/src/backend/storage/events/timeline-emitter.ts';
  import { AuthorityDatabase } from '../../../failure-resolution/src/backend/storage/sqlite/authority-database.ts';
  import { localDatePart } from '../../../failure-resolution/src/rules/time/clock.ts';
  const [instant, localDay, cutoff, retained] = process.argv.slice(1);
  const f = resolutionFixture();
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  try {
    f.clock.setWall(new Date(instant));
    assert.equal(localDatePart(f.clock.now()), localDay, 'timezone control');
    AuthorityDatabase.inspectExistingReadOnly(f.path);
    const command = resolutionCommand({ requestedAt: instant });
    assert.equal(f.kernel.execute(command).state, 'applied');
    const resolution = f.db.authority.timelineEvents.page({}).find(row => row.payload.kind === 'failure-resolution');
    assert.ok(resolution);
    const ordinaryId = randomUUID();
    createTimelineEmitter({ repository: f.db.authority.timelineEvents, clock: f.clock, uuid: () => ordinaryId }).emit({
      t: 'span.started', kind: 'worker', workflow: 'person-lookup', ts: instant,
      workerId: 'retention-proof', spanPath: 'worker/retention-proof', name: 'Retention proof',
    });
    const ordinary = f.db.authority.timelineEvents.get(ordinaryId);
    assert.ok(ordinary);
    assert.equal(ordinary.retentionDate, localDay, 'ordinary emitter control');
    assert.equal(resolution.retentionDate, localDay, 'resolution uses the same local append day');
    const state = () => hash({ rows: f.db.authority.timelineEvents.page({}), meta: f.db.getMeta(),
      annotation: f.db.authority.failureResolution.read(f.record.runId, f.record.failureId),
      command: f.db.authority.commands.get(command.commandId), audit: f.db.authority.commandAudits.findByCommand(command.commandId) });
    const beforeReplay = state();
    assert.equal(f.kernel.execute(command).state, 'already-applied');
    assert.equal(state(), beforeReplay, 'exact replay changes no authority');
    f.db.authority.timelineEvents.pruneBefore(cutoff);
    assert.equal(f.db.authority.timelineEvents.get(resolution.eventId) !== undefined, retained === 'yes');
    assert.equal(f.db.authority.timelineEvents.get(ordinaryId) !== undefined, retained === 'yes');
    const afterPrune = state();
    assert.equal(f.kernel.execute(command).state, 'already-applied');
    assert.equal(state(), afterPrune, 'replay never resurrects pruned history');
    assert.equal(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId)?.resolution.status, 'resolved');
    AuthorityDatabase.inspectExistingReadOnly(f.path);
    const other = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: 'retention-reopen' }, f.clock);
    try { assert.deepEqual(other.authority.timelineEvents.page({}), f.db.authority.timelineEvents.page({})); }
    finally { other.close(); }
  } finally { f.dispose(); }
`;

for (const [label, tz, instant, localDay, cutoff, retained] of [
  ["Los Angeles before UTC/local rollover", "America/Los_Angeles", "2026-09-10T02:00:00.000Z", "2026-09-09", "2026-09-10", "no"],
  ["Tokyo after UTC/local rollover", "Asia/Tokyo", "2026-09-09T16:00:00.000Z", "2026-09-10", "2026-09-10", "yes"],
  ["UTC control", "UTC", "2026-09-10T02:00:00.000Z", "2026-09-10", "2026-09-11", "no"],
  ["Los Angeles midday control", "America/Los_Angeles", "2026-09-10T19:00:00.000Z", "2026-09-10", "2026-09-11", "no"],
] as const) {
  it(`retains and prunes resolution history with ordinary events: ${label}`, () => {
    const child = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", probe, instant, localDay, cutoff, retained],
      { cwd: process.cwd(), env: { ...process.env, TZ: tz }, encoding: "utf8", timeout: 20_000 });
    assert.equal(child.status, 0, `${child.error?.message ?? ""}${child.stdout}${child.stderr}`);
  });
}
