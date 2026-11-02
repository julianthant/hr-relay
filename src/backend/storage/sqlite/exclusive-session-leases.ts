import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ExclusiveSessionLeaseSchema, type ExclusiveSessionLease } from "../../../models/sessions/exclusive-session-lease.js";
import { BrowserSessionIdSchema, FingerprintSchema, IsoInstantSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

export const EXCLUSIVE_SESSION_LEASE_MIGRATION = Object.freeze({ version: 12, statements: Object.freeze([
  `CREATE TABLE exclusive_session_leases (
    id TEXT PRIMARY KEY, generation INTEGER NOT NULL CHECK(generation>0),
    worker_id TEXT NOT NULL REFERENCES worker_slots(id), worker_lease_generation INTEGER NOT NULL CHECK(worker_lease_generation>0),
    session_id TEXT NOT NULL UNIQUE, acquired_at TEXT NOT NULL, released_at TEXT
  ) STRICT`,
  `CREATE TRIGGER exclusive_session_lease_retained BEFORE DELETE ON exclusive_session_leases
    BEGIN SELECT RAISE(ABORT,'exclusive-session-lease-retained'); END`,
  `CREATE TRIGGER exclusive_session_lease_no_replace BEFORE INSERT ON exclusive_session_leases
    WHEN EXISTS(SELECT 1 FROM exclusive_session_leases WHERE id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'exclusive-session-lease-replace-refused'); END`,
  `CREATE TRIGGER exclusive_session_lease_transition BEFORE UPDATE ON exclusive_session_leases
    WHEN NEW.id<>OLD.id OR NOT (
      (OLD.released_at IS NULL AND NEW.released_at IS NOT NULL AND NEW.released_at>=OLD.acquired_at
        AND NEW.generation=OLD.generation AND NEW.worker_id=OLD.worker_id
        AND NEW.worker_lease_generation=OLD.worker_lease_generation AND NEW.session_id=OLD.session_id AND NEW.acquired_at=OLD.acquired_at)
      OR (OLD.released_at IS NOT NULL AND NEW.released_at IS NULL AND NEW.generation=OLD.generation+1
        AND NEW.session_id<>OLD.session_id AND NEW.acquired_at>=OLD.released_at))
    BEGIN SELECT RAISE(ABORT,'exclusive-session-lease-transition-refused'); END`,
]) });

const RowSchema = z.strictObject({ id: FingerprintSchema, generation: z.number().int().positive(), worker_id: WorkerIdSchema,
  worker_lease_generation: z.number().int().positive(), session_id: BrowserSessionIdSchema, acquired_at: IsoInstantSchema, released_at: IsoInstantSchema.nullable() });
export function exclusiveSessionLeaseFromRow(input: unknown): ExclusiveSessionLease {
  const row = RowSchema.parse(input);
  return ExclusiveSessionLeaseSchema.parse({ identityKey: row.id, generation: row.generation, workerId: row.worker_id,
    workerLeaseGeneration: row.worker_lease_generation, sessionId: row.session_id, acquiredAt: row.acquired_at, releasedAt: row.released_at });
}

interface Ports {
  database: DatabaseSync;
  read<T>(work: () => T): T;
  mutate<T>(work: () => Readonly<{ result: T; changes: number }>): T;
}
export function createExclusiveSessionLeaseRepository(ports: Ports) {
  const { database } = ports;
  const get = (key: string) => {
    const row = database.prepare("SELECT * FROM exclusive_session_leases WHERE id=?").get(FingerprintSchema.parse(key));
    return row === undefined ? undefined : exclusiveSessionLeaseFromRow(row);
  };
  return Object.freeze({
    get: (identityKey: string) => ports.read(() => get(identityKey)),
    acquire(input: Readonly<{ identityKey: string; workerId: string; sessionId: string; now: string }>) {
      const request = z.strictObject({ identityKey: FingerprintSchema, workerId: WorkerIdSchema, sessionId: BrowserSessionIdSchema, now: IsoInstantSchema }).parse(input);
      return ports.mutate((): { result: Readonly<{ state: "acquired" | "held"; lease: ExclusiveSessionLease }>; changes: number } => {
        const before = get(request.identityKey);
        if (before?.releasedAt === null) return { result: { state: "held", lease: before }, changes: 0 };
        const owner = z.strictObject({ lease_generation: z.number().int().positive() }).parse(database.prepare(
          "SELECT l.lease_generation FROM worker_leases l JOIN worker_slots s ON s.id=l.worker_id WHERE l.worker_id=? AND s.retired_at IS NULL AND l.state NOT IN ('stopped','stopping') ORDER BY l.lease_generation DESC LIMIT 1",
        ).get(request.workerId));
        if (before !== undefined && request.now < (before.releasedAt ?? before.acquiredAt)) throw new Error("exclusive-session-lease-clock-regressed");
        const lease = ExclusiveSessionLeaseSchema.parse({ identityKey: request.identityKey, generation: (before?.generation ?? 0) + 1,
          workerId: request.workerId, workerLeaseGeneration: owner.lease_generation, sessionId: request.sessionId, acquiredAt: request.now, releasedAt: null });
        if (before === undefined) database.prepare("INSERT INTO exclusive_session_leases VALUES(?,?,?,?,?,?,NULL)")
          .run(lease.identityKey, lease.generation, lease.workerId, lease.workerLeaseGeneration, lease.sessionId, lease.acquiredAt);
        else {
          const updated = database.prepare("UPDATE exclusive_session_leases SET generation=?,worker_id=?,worker_lease_generation=?,session_id=?,acquired_at=?,released_at=NULL WHERE id=? AND generation=? AND released_at IS NOT NULL")
            .run(lease.generation, lease.workerId, lease.workerLeaseGeneration, lease.sessionId, lease.acquiredAt, lease.identityKey, before.generation);
          if (updated.changes !== 1) throw new Error("exclusive-session-lease-cas-conflict");
        }
        return { result: { state: "acquired", lease }, changes: 1 };
      });
    },
    release(input: ExclusiveSessionLease, now: string) {
      const token = ExclusiveSessionLeaseSchema.parse(input), releasedAt = IsoInstantSchema.parse(now);
      return ports.mutate(() => {
        const current = get(token.identityKey);
        if (token.releasedAt !== null || current === undefined || canonicalJsonStringify(current) !== canonicalJsonStringify(token)
          || releasedAt < token.acquiredAt) throw new Error("exclusive-session-lease-release-refused");
        const updated = database.prepare("UPDATE exclusive_session_leases SET released_at=? WHERE id=? AND generation=? AND session_id=? AND released_at IS NULL")
          .run(releasedAt, token.identityKey, token.generation, token.sessionId);
        if (updated.changes !== 1) throw new Error("exclusive-session-lease-cas-conflict");
        return { result: ExclusiveSessionLeaseSchema.parse({ ...token, releasedAt }), changes: 1 };
      });
    },
  });
}
