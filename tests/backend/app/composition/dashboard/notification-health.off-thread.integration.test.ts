import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { createNotificationHealthObserver, readNotificationHealth } from "../../../../../src/backend/app/composition/dashboard/notification-health.js";
import { createTrustNotifications } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import * as authorityInspection from "../../../../../src/backend/storage/sqlite/authority-inspection-off-thread.js";
import { AuthoritySourceChangedError } from "../../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { createDebugEventWriter } from "../../../../../src/backend/logs/debug-events.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { syntheticStateRoot } from "../../../../support/helpers/synthetic-storage-admission.js";

const { fixture } = createNotificationCompositionTestWorld();
type Fixture = Awaited<ReturnType<typeof fixture>>;
const read = (f: Fixture, signal?: AbortSignal) => readNotificationHealth({ admission: syntheticStateRoot(f.root), database: f.db, reader: f.reader, stateRoot: f.root, clock: f.clock,
  ...(signal === undefined ? {} : { signal }) });
/** Enough diagnostic events that the whole-store inspection takes over a second; events, unlike live runs, add nothing to the reading's own run list. */
const LARGE_STORE_EVENTS = 60_000;
function seedLargeStore(f: Fixture): void {
  f.db.withAuthorityTransaction(repos => {
    const events = createDebugEventWriter({ repository: repos.timelineEvents, clock: f.clock, build: "test", development: false });
    for (let index = 0; index < LARGE_STORE_EVENTS; index++) events.emit({ category: "boot", phase: "settled", area: "event-loop", reason: "event-loop-stall",
      correlationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, durationMs: 250 });
  });
}

/** A consistent copy of the store in its own state root, with an audit row whose command does not exist: it fails foreign-key validation. */
function damagedCopy(f: Fixture): string {
  const root = mkdtempSync(join(tmpdir(), "relay-damaged-state-"));
  const source = new DatabaseSync(f.path, { readOnly: true });
  try { source.exec(`VACUUM INTO '${join(root, "state.db")}'`); } finally { source.close(); }
  const raw = new DatabaseSync(join(root, "state.db"));
  try {
    raw.exec("PRAGMA foreign_keys=OFF");
    raw.prepare("INSERT INTO command_audits (id, command_id, payload_json, created_at) VALUES (?, ?, ?, ?)").run(randomUUID(), randomUUID(), "{}", f.clock.now().toISOString());
  } finally { raw.close(); }
  return root;
}

describe("notification health off the event loop", () => {
  it("keeps the event loop running while it inspects a store that takes over a second to inspect", async () => {
    const f = await fixture();
    try {
      seedLargeStore(f);
      let last = performance.now(), longestGap = 0;
      const ticks = setInterval(() => { const now = performance.now(); longestGap = Math.max(longestGap, now - last); last = now; }, 10);
      const started = performance.now();
      try { expect((await read(f)).integrityFailed).toBe(false); }
      finally { clearInterval(ticks); }
      // A reading that held the loop to its end leaves no tick behind to see the block.
      longestGap = Math.max(longestGap, performance.now() - last);
      expect(performance.now() - started).toBeGreaterThan(1_000);
      expect(longestGap).toBeLessThan(250);
    } finally { await f.close(); }
  });

  it("still raises the integrity-check concern for a damaged store", async () => {
    const f = await fixture();
    const damaged = damagedCopy(f);
    try {
      const observe = createNotificationHealthObserver({ database: f.db, clock: f.clock, inbox: f.inbox,
        read: () => readNotificationHealth({ admission: syntheticStateRoot(damaged), database: f.db, reader: f.reader, stateRoot: damaged, clock: f.clock }) });
      await observe();
      expect(f.db.authority.notificationHealth.get("integrity-check")?.active).toBe(true);
      expect(f.inbox.list("local-operator").filter(row => row.title.includes("integrity-check"))).toHaveLength(1);
    } finally { rmSync(damaged, { recursive: true, force: true }); await f.close(); }
  });

  it("a stop while the store inspection runs writes and publishes nothing", async () => {
    const f = await fixture();
    const inspections = vi.spyOn(authorityInspection, "inspectAuthorityOffThread");
    try {
      const { observer, inbox } = createTrustNotifications({ admission: syntheticStateRoot(f.root), database: f.db, clock: f.clock, ids: sequentialIdFactory("stop"), reader: f.reader, stateRoot: f.root });
      const pass = observer.observe();
      await vi.waitFor(() => expect(inspections).toHaveBeenCalledTimes(1));
      await observer.stop();
      await pass;
      expect(observer.status().state).toBe("stopped");
      expect(inbox.list("local-operator")).toEqual([]);
      expect(f.db.authority.notificationHealth.get("integrity-check")).toBeUndefined();
    } finally { inspections.mockRestore(); await f.close(); }
  });

  it("an inspection a write overtook is no verdict: nothing fails and the next reading inspects again", async () => {
    const f = await fixture();
    const inspections = vi.spyOn(authorityInspection, "inspectAuthorityOffThread");
    try {
      inspections.mockRejectedValueOnce(new AuthoritySourceChangedError());
      expect((await read(f)).integrityFailed).toBe(false);
      expect((await read(f)).integrityFailed).toBe(false);
      expect(inspections).toHaveBeenCalledTimes(2);
      await read(f);
      expect(inspections).toHaveBeenCalledTimes(2);
    } finally { inspections.mockRestore(); await f.close(); }
  });

  it("an overtaken first inspection after a restart keeps a stored integrity-check failure", async () => {
    const f = await fixture();
    const inspections = vi.spyOn(authorityInspection, "inspectAuthorityOffThread");
    try {
      const at = f.clock.now().toISOString();
      f.db.withAuthorityTransaction(repos => repos.notificationHealth.put({ concern: "integrity-check", active: true, occurrence: 1, observedAt: at, createdAt: at, samples: [] }));
      inspections.mockRejectedValueOnce(new AuthoritySourceChangedError());
      await createNotificationHealthObserver({ database: f.db, clock: f.clock, inbox: f.inbox, read: () => read(f) })();
      expect(inspections).toHaveBeenCalledTimes(1);
      expect(f.db.authority.notificationHealth.get("integrity-check")?.active).toBe(true);
    } finally { inspections.mockRestore(); await f.close(); }
  });
});

// Select the unchanged schema-39 sweep case in task CI.
