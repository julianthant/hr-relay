import type { ProviderAccountingStorage } from "../../base/provider-accounting.js";
import { ProviderUsageStorageSchema, type ProviderRequestStorage, type ProviderUsageStorage } from "../../domain/provider-accounting.js";
import { ProviderRequestStorageSchema } from "../../domain/provider-accounting.js";
import { readProviderRequest, readProviderUsage, writeProviderRequest, writeProviderUsage } from "./provider-storage.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ProviderAdmissionRepository } from "../../base/providers.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { providerBudget, type ProviderBudget } from "../../domain/config/schema.js";
import { ConfigSnapshotRecordSchema, type ConfigSnapshotRecord } from "../../domain/config/snapshot.js";
import { ProviderCapabilityIdSchema, ProviderAdmissionIdSchema } from "../../domain/ids.js";
import type { RunRecord } from "../../domain/run/record.js";
import type { TableName, AuthorityTableName } from "../../domain/authority.js";
import {
  ProviderAdmissionDenyRequestSchema,
  ProviderAdmissionInterruptRequestSchema,
  ProviderAdmissionMutationOutcomeSchema,
  ProviderAdmissionRecordSchema,
  ProviderAdmissionReserveOutcomeSchema,
  ProviderAdmissionReserveRequestSchema,
  ProviderAdmissionSettleRequestSchema,
  ProviderAdmissionSweepOutcomeSchema,
  ProviderAdmissionSweepRequestSchema,
  ProviderBudgetCounterSchema,
  ProviderUnavailableReasonSchema,
  isRunNodeExecutionIdentity,
  type ProviderAdmissionRecord,
  type ProviderBudgetCounter,
} from "../../domain/provider-admission.js";
interface ProviderAccountingPorts {
  database: DatabaseSync;
  transaction<T>(work: () => T): T;
  mutate<O extends Readonly<{ result: unknown; changes: number }>>(table: AuthorityTableName, work: () => O): O["result"];
  readRecord<S extends z.ZodType>(table: TableName, key: string, schema: S): z.output<S> | undefined;
  readRun(id: string): RunRecord | undefined;
}
const NextEligibleRowSchema = z.strictObject({ next_eligible_at: z.string().nullable() });
const JsonRowSchema = z.strictObject({ record_json: z.string() });
function parseJsonRecord<S extends z.ZodType>(schema: S, text: string): z.output<S> { return schema.parse(JSON.parse(text)); }
function fixedUtcMinuteStart(instant: string): string {
  const milliseconds = Date.parse(instant);
  return new Date(Math.floor(milliseconds / 60_000) * 60_000).toISOString();
}

function fixedUtcDayStart(instant: string): string {
  const at = new Date(Date.parse(instant));
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString();
}

function nextFixedWindow(start: string, milliseconds: number): string {
  return new Date(Date.parse(start) + milliseconds).toISOString();
}


/** The legacy capability path uses the same owning SQLite transaction as commands and deletion. */
export class SqliteProviderAccounting {
  constructor(private readonly ports: ProviderAccountingPorts) {}
  #readProviderCounter(capability: string): ProviderBudgetCounter | undefined {
    return this.#readRecord(
      "provider_usage",
      ProviderCapabilityIdSchema.parse(capability),
      ProviderBudgetCounterSchema,
    );
  }

  #readRecord<S extends z.ZodType>(table: TableName, key: string, schema: S): z.output<S> | undefined {
    if (table === "provider_usage" || table === "provider_requests") {
      const stored = table === "provider_usage" ? readProviderUsage(this.ports.database, key) : readProviderRequest(this.ports.database, key);
      if (stored === undefined) return undefined;
      if (stored.kind !== "legacy-capability") throw new Error("provider-legacy-identity-conflict");
      return schema.parse(stored.record);
    }
    return this.ports.readRecord(table, key, schema);
  }
  #writeProviderCounter(record: ProviderBudgetCounter, mode: "insert" | "update"): void {
    this.ports.mutate("provider_usage", () => {
      const old = readProviderUsage(this.ports.database, record.capability);
      if (old !== undefined && old.kind !== "legacy-capability") throw new Error("provider-legacy-identity-conflict");
      writeProviderUsage(this.ports.database, { format: 1, kind: "legacy-capability", record,
        tracking: old?.tracking ?? { startedAt: record.createdAt, coverage: "complete-since-start", evidence: "legacy-reported" },
        cumulative: old?.cumulative ?? { requests: 0, chargedUsdMicros: 0 },
      }, mode === "insert" ? null : record.version - 1);
      return { result: undefined, changes: 1 };
    });
  }
  #writeProviderAdmission(record: ProviderAdmissionRecord, mode: "insert" | "update"): void {
    this.ports.mutate("provider_requests", () => {
      const old = readProviderRequest(this.ports.database, record.admissionId);
      if (old !== undefined && old.kind !== "legacy-capability") throw new Error("provider-legacy-identity-conflict");
      const origin = old?.origin ?? "tracked";
      writeProviderRequest(this.ports.database, { format: 1, kind: "legacy-capability", record, origin,
        attribution: { kind: "legacy-capability", capability: record.capability },
        tracking: old?.tracking ?? { startedAt: record.createdAt, coverage: "complete-since-start", evidence: "legacy-reported" },
      }, mode === "insert" ? null : record.version - 1);
      const usage = readProviderUsage(this.ports.database, record.capability);
      if (usage === undefined || usage.kind !== "legacy-capability") throw new Error("provider-legacy-usage-missing");
      if (origin === "tracked") {
        const newReservation = old === undefined && record.lifecycle.state === "reserved";
        const settlement = old?.record.lifecycle.state === "reserved" && record.lifecycle.state === "settled";
        if (newReservation || settlement) {
          const refund = settlement && record.lifecycle.state === "settled" ? record.reservation.maximumCostUsdMicros - record.lifecycle.actualUsage.costUsdMicros : 0;
          writeProviderUsage(this.ports.database, { ...usage, cumulative: {
            requests: usage.cumulative.requests + (newReservation ? 1 : 0),
            chargedUsdMicros: usage.cumulative.chargedUsdMicros + (newReservation ? record.reservation.maximumCostUsdMicros : 0) - refund,
          } }, usage.record.version);
        }
      }
      return { result: undefined, changes: 1 };
    });
  }

  #providerAdmissionContext(request: z.infer<typeof ProviderAdmissionReserveRequestSchema>
    | z.infer<typeof ProviderAdmissionDenyRequestSchema>): ConfigSnapshotRecord {
    const run = this.ports.readRun(request.execution.runId);
    if (run === undefined) throw new Error(`provider admission run ${request.execution.runId} does not exist`);
    if (run.envelope.attempt !== request.execution.attempt
      || run.envelope.configSnapshotId !== request.configSnapshotId
      || run.envelope.configFingerprint !== request.configFingerprint) {
      throw new Error(`provider admission ${request.admissionId} does not match run ${request.execution.runId} execution/config identity`);
    }
    // A run-NODE admission must be the node the run is executing right now.
    // An operator-advisory admission (D178) deliberately makes no such claim:
    // ref operator-trust §4.4's advisory reads FINISHED authority on the presentation lane,
    // so requiring a live node would either make the feature impossible or
    // force it to name a node the descriptor never reached. What it still
    // binds is everything that is true — the run's identity, its retained
    // attempt, and its own config snapshot, all checked directly above.
    if (isRunNodeExecutionIdentity(request.execution)
      && (run.lifecycle.state !== "running" || run.lifecycle.currentNodeId !== request.execution.nodeId)) {
      throw new Error(`provider admission ${request.admissionId} run ${request.execution.runId} is not executing node ${request.execution.nodeId}`);
    }
    const snapshot = this.#readRecord(
      "settings_snapshots",
      request.configSnapshotId,
      ConfigSnapshotRecordSchema,
    );
    if (snapshot === undefined) throw new Error(`provider config snapshot ${request.configSnapshotId} does not exist`);
    if (snapshot.fingerprint !== request.configFingerprint) {
      throw new Error(`provider config snapshot ${request.configSnapshotId} fingerprint mismatch`);
    }
    return snapshot;
  }

  #assertProviderAdmissionRequestMatches(
    existing: ProviderAdmissionRecord,
    request: z.infer<typeof ProviderAdmissionReserveRequestSchema>
      | z.infer<typeof ProviderAdmissionDenyRequestSchema>,
  ): void {
    const expected = {
      admissionId: request.admissionId,
      execution: request.execution,
      capability: request.capability,
      configSnapshotId: request.configSnapshotId,
      configFingerprint: request.configFingerprint,
      requestFingerprint: request.requestFingerprint,
      estimate: request.estimate,
    };
    const actual = {
      admissionId: existing.admissionId,
      execution: existing.execution,
      capability: existing.capability,
      configSnapshotId: existing.configSnapshotId,
      configFingerprint: existing.configFingerprint,
      requestFingerprint: existing.requestFingerprint,
      estimate: existing.estimate,
    };
    if (canonicalJsonStringify(actual) !== canonicalJsonStringify(expected)) {
      throw new Error(`provider admission id ${request.admissionId} was reused with different content`);
    }
  }

  #createProviderCounter(capability: z.infer<typeof ProviderCapabilityIdSchema>, now: string): ProviderBudgetCounter {
    const record = ProviderBudgetCounterSchema.parse({
      capability,
      minuteWindowStartedAt: fixedUtcMinuteStart(now),
      minuteRequests: 0,
      dayWindowStartedAt: fixedUtcDayStart(now),
      dayRequests: 0,
      dayReservedCostUsdMicros: 0,
      activeReservations: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    this.#writeProviderCounter(record, "insert");
    return record;
  }

  #rollProviderCounter(counter: ProviderBudgetCounter, now: string): ProviderBudgetCounter {
    const minuteWindowStartedAt = fixedUtcMinuteStart(now);
    const dayWindowStartedAt = fixedUtcDayStart(now);
    const minuteRolled = minuteWindowStartedAt !== counter.minuteWindowStartedAt;
    const dayRolled = dayWindowStartedAt !== counter.dayWindowStartedAt;
    if (!minuteRolled && !dayRolled) return counter;
    const rolled = ProviderBudgetCounterSchema.parse({
      ...counter,
      minuteWindowStartedAt,
      minuteRequests: minuteRolled ? 0 : counter.minuteRequests,
      dayWindowStartedAt,
      dayRequests: dayRolled ? 0 : counter.dayRequests,
      dayReservedCostUsdMicros: dayRolled ? 0 : counter.dayReservedCostUsdMicros,
      ...(dayRolled ? { blockedByAdmissionId: undefined } : {}),
      version: counter.version + 1,
      updatedAt: now,
    });
    this.#writeProviderCounter(rolled, "update");
    return rolled;
  }

  #expireProviderLeases(counter: ProviderBudgetCounter, now: string): {
    readonly counter: ProviderBudgetCounter;
    readonly expired: readonly ProviderAdmissionRecord[];
  } {
    const rows = this.ports.database.prepare(`
      SELECT json_extract(record_json, '$.record') AS record_json FROM provider_requests
      WHERE json_extract(record_json,'$.kind')='legacy-capability' AND capability = ? AND state = 'reserved' AND lease_expires_at <= ?
      ORDER BY lease_expires_at, record_key
    `).all(counter.capability, now);
    if (rows.length === 0) return { counter, expired: Object.freeze([]) };
    const expired: ProviderAdmissionRecord[] = [];
    for (const row of rows) {
      const current = parseJsonRecord(
        ProviderAdmissionRecordSchema,
        JsonRowSchema.parse(row).record_json,
      );
      const record = ProviderAdmissionRecordSchema.parse({
        ...current,
        lifecycle: {
          state: "lease-expired",
          expiredAt: now,
          accounting: "full-reservation-retained",
        },
        version: current.version + 1,
        updatedAt: now,
      });
      this.#writeProviderAdmission(record, "update");
      expired.push(record);
    }
    if (counter.activeReservations < expired.length) {
      throw new Error(`provider counter ${counter.capability} cannot release ${String(expired.length)} expired leases from ${String(counter.activeReservations)} active reservations`);
    }
    const updated = ProviderBudgetCounterSchema.parse({
      ...counter,
      activeReservations: counter.activeReservations - expired.length,
      version: counter.version + 1,
      updatedAt: now,
    });
    this.#writeProviderCounter(updated, "update");
    return { counter: updated, expired: Object.freeze(expired) };
  }

  #prepareProviderCounter(capability: z.infer<typeof ProviderCapabilityIdSchema>, now: string): ProviderBudgetCounter {
    const initial = this.#readProviderCounter(capability) ?? this.#createProviderCounter(capability, now);
    const expired = this.#expireProviderLeases(initial, now).counter;
    return this.#rollProviderCounter(expired, now);
  }

  #providerBudgetDenial(
    counter: ProviderBudgetCounter,
    budget: ProviderBudget,
    estimate: number,
  ): z.infer<typeof ProviderUnavailableReasonSchema> | undefined {
    if (counter.activeReservations >= budget.concurrency) {
      const row = this.ports.database.prepare(`
        SELECT MIN(lease_expires_at) AS next_eligible_at FROM provider_requests
        WHERE json_extract(record_json,'$.kind')='legacy-capability' AND capability = ? AND state = 'reserved'
      `).get(counter.capability);
      const retryAt = NextEligibleRowSchema.parse(row).next_eligible_at;
      if (retryAt === null) throw new Error(`provider counter ${counter.capability} reports exhausted concurrency without an active lease`);
      return ProviderUnavailableReasonSchema.parse({
        code: "concurrency-exhausted",
        message: `${counter.capability} concurrency is exhausted`,
        retryAt,
      });
    }
    if (counter.minuteRequests >= budget.requestsPerMinute) {
      return ProviderUnavailableReasonSchema.parse({
        code: "rate-exhausted",
        message: `${counter.capability} fixed UTC-minute request budget is exhausted`,
        retryAt: nextFixedWindow(counter.minuteWindowStartedAt, 60_000),
      });
    }
    if (counter.dayRequests >= budget.dailyRequestLimit) {
      return ProviderUnavailableReasonSchema.parse({
        code: "daily-request-exhausted",
        message: `${counter.capability} fixed UTC-day request budget is exhausted`,
        retryAt: nextFixedWindow(counter.dayWindowStartedAt, 86_400_000),
      });
    }
    if (counter.blockedByAdmissionId !== undefined
      || counter.dayReservedCostUsdMicros + estimate > budget.costLimitUsdMicros) {
      return ProviderUnavailableReasonSchema.parse({
        code: "daily-cost-exhausted",
        message: counter.blockedByAdmissionId === undefined
          ? `${counter.capability} fixed UTC-day cost budget is exhausted`
          : `${counter.capability} admission ${counter.blockedByAdmissionId} breached its maximum cost estimate`,
        retryAt: nextFixedWindow(counter.dayWindowStartedAt, 86_400_000),
      });
    }
    return undefined;
  }

  #newProviderAdmission(
    request: z.infer<typeof ProviderAdmissionReserveRequestSchema>
      | z.infer<typeof ProviderAdmissionDenyRequestSchema>,
    snapshot: ConfigSnapshotRecord,
    lifecycle: ProviderAdmissionRecord["lifecycle"],
  ): ProviderAdmissionRecord {
    const budget = providerBudget(snapshot.config, request.capability);
    return ProviderAdmissionRecordSchema.parse({
      admissionId: request.admissionId,
      execution: request.execution,
      capability: request.capability,
      configSnapshotId: request.configSnapshotId,
      configFingerprint: request.configFingerprint,
      requestFingerprint: request.requestFingerprint,
      budget,
      estimate: request.estimate,
      reservation: { requestCount: 1, maximumCostUsdMicros: request.estimate.maximumCostUsdMicros },
      lifecycle,
      version: 1,
      createdAt: request.now,
      updatedAt: request.now,
    });
  }

  accounting(): ProviderAccountingStorage {
    const storage:ProviderAccountingStorage = {
      transaction: <T>(work:(repository:ProviderAccountingStorage)=>T):T => this.ports.transaction(()=>work(storage)),
      getRequest:(id:string)=>readProviderRequest(this.ports.database,id),
      getUsage:(id:string)=>readProviderUsage(this.ports.database,id),
      listUsage:()=>this.ports.database.prepare("SELECT record_json FROM provider_usage ORDER BY record_key").all().map(row=>ProviderUsageStorageSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json))),
      writeRequest:(record:ProviderRequestStorage,expectedVersion:number|null)=>this.ports.mutate("provider_requests",()=>{writeProviderRequest(this.ports.database,record,expectedVersion);return {result:undefined,changes:1};}),
      writeUsage:(record:ProviderUsageStorage,expectedVersion:number|null)=>this.ports.mutate("provider_usage",()=>{writeProviderUsage(this.ports.database,record,expectedVersion);return {result:undefined,changes:1};}),
    };
    return Object.freeze(storage);
  }

  repository(): ProviderAdmissionRepository {
    return Object.freeze({
      reserve: (input: unknown) => {
        const request = ProviderAdmissionReserveRequestSchema.parse(input);
        return this.ports.transaction(() => {
          const existing = this.#readRecord(
            "provider_requests",
            request.admissionId,
            ProviderAdmissionRecordSchema,
          );
          if (existing !== undefined) {
            this.#assertProviderAdmissionRequestMatches(existing, request);
            return ProviderAdmissionReserveOutcomeSchema.parse({ state: "existing", admission: existing });
          }
          const snapshot = this.#providerAdmissionContext(request);
          let counter = this.#prepareProviderCounter(request.capability, request.now);
          const budget = providerBudget(snapshot.config, request.capability);
          const denial = this.#providerBudgetDenial(
            counter,
            budget,
            request.estimate.maximumCostUsdMicros,
          );
          if (denial !== undefined) {
            const admission = this.#newProviderAdmission(request, snapshot, {
              state: "denied", deniedAt: request.now, reason: denial,
            });
            this.#writeProviderAdmission(admission, "insert");
            return ProviderAdmissionReserveOutcomeSchema.parse({ state: "denied", admission, counter });
          }
          counter = ProviderBudgetCounterSchema.parse({
            ...counter,
            minuteRequests: counter.minuteRequests + 1,
            dayRequests: counter.dayRequests + 1,
            dayReservedCostUsdMicros:
              counter.dayReservedCostUsdMicros + request.estimate.maximumCostUsdMicros,
            activeReservations: counter.activeReservations + 1,
            version: counter.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderCounter(counter, "update");
          const admission = this.#newProviderAdmission(request, snapshot, {
            state: "reserved",
            reservedAt: request.now,
            leaseExpiresAt: request.leaseExpiresAt,
            deadlineAt: request.deadlineAt,
          });
          this.#writeProviderAdmission(admission, "insert");
          return ProviderAdmissionReserveOutcomeSchema.parse({ state: "reserved", admission, counter });
        });
      },
      deny: (input: unknown) => {
        const request = ProviderAdmissionDenyRequestSchema.parse(input);
        return this.ports.transaction(() => {
          const existing = this.#readRecord(
            "provider_requests",
            request.admissionId,
            ProviderAdmissionRecordSchema,
          );
          if (existing !== undefined) {
            this.#assertProviderAdmissionRequestMatches(existing, request);
            if (existing.lifecycle.state !== "denied"
              || canonicalJsonStringify(existing.lifecycle.reason) !== canonicalJsonStringify(request.reason)) {
              throw new Error(`provider admission id ${request.admissionId} was reused with a different denial`);
            }
            return ProviderAdmissionReserveOutcomeSchema.parse({ state: "existing", admission: existing });
          }
          const snapshot = this.#providerAdmissionContext(request);
          const counter = this.#prepareProviderCounter(request.capability, request.now);
          const admission = this.#newProviderAdmission(request, snapshot, {
            state: "denied", deniedAt: request.now, reason: request.reason,
          });
          this.#writeProviderAdmission(admission, "insert");
          return ProviderAdmissionReserveOutcomeSchema.parse({ state: "denied", admission, counter });
        });
      },
      settle: (input: unknown) => {
        const request = ProviderAdmissionSettleRequestSchema.parse(input);
        return this.ports.transaction(() => {
          const current = this.#readRecord(
            "provider_requests", request.admissionId, ProviderAdmissionRecordSchema,
          );
          if (current === undefined) throw new Error(`provider admission ${request.admissionId} does not exist`);
          let counter = this.#prepareProviderCounter(current.capability, request.now);
          if (current.lifecycle.state === "settled") {
            const exact = current.version === request.expectedVersion + 1
              && current.lifecycle.adapterDisposition === request.adapterDisposition
              && canonicalJsonStringify(current.lifecycle.actualUsage) === canonicalJsonStringify(request.actualUsage)
              && canonicalJsonStringify(current.lifecycle.evidence) === canonicalJsonStringify(request.evidence)
              && current.lifecycle.settledAt === request.now;
            if (!exact) throw new Error(`provider admission ${request.admissionId} settlement replay differs from durable content`);
            return ProviderAdmissionMutationOutcomeSchema.parse({ admission: current, counter });
          }
          if (current.lifecycle.state !== "reserved" || current.version !== request.expectedVersion) {
            throw new Error(`provider admission ${request.admissionId} is ${current.lifecycle.state} at version ${String(current.version)}`);
          }
          if (request.actualUsage.costUsdMicros > current.estimate.maximumCostUsdMicros) {
            throw new Error(`provider admission ${request.admissionId} actual cost exceeds its conservative maximum estimate`);
          }
          const sameDay = fixedUtcDayStart(current.lifecycle.reservedAt) === counter.dayWindowStartedAt;
          if (counter.activeReservations < 1) throw new Error(`provider counter ${current.capability} has no active reservation to settle`);
          counter = ProviderBudgetCounterSchema.parse({
            ...counter,
            activeReservations: counter.activeReservations - 1,
            dayReservedCostUsdMicros: sameDay
              ? counter.dayReservedCostUsdMicros
                - (current.estimate.maximumCostUsdMicros - request.actualUsage.costUsdMicros)
              : counter.dayReservedCostUsdMicros,
            version: counter.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderCounter(counter, "update");
          const admission = ProviderAdmissionRecordSchema.parse({
            ...current,
            lifecycle: {
              state: "settled",
              settledAt: request.now,
              adapterDisposition: request.adapterDisposition,
              actualUsage: request.actualUsage,
              evidence: request.evidence,
            },
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderAdmission(admission, "update");
          return ProviderAdmissionMutationOutcomeSchema.parse({ admission, counter });
        });
      },
      interrupt: (input: unknown) => {
        const request = ProviderAdmissionInterruptRequestSchema.parse(input);
        return this.ports.transaction(() => {
          const current = this.#readRecord(
            "provider_requests", request.admissionId, ProviderAdmissionRecordSchema,
          );
          if (current === undefined) throw new Error(`provider admission ${request.admissionId} does not exist`);
          let counter = this.#prepareProviderCounter(current.capability, request.now);
          if (current.lifecycle.state === "interrupted") {
            const exact = current.version === request.expectedVersion + 1
              && current.lifecycle.code === request.code
              && current.lifecycle.message === request.message
              && canonicalJsonStringify(current.lifecycle.evidence) === canonicalJsonStringify(request.evidence)
              && current.lifecycle.interruptedAt === request.now;
            if (!exact) throw new Error(`provider admission ${request.admissionId} interruption replay differs from durable content`);
            return ProviderAdmissionMutationOutcomeSchema.parse({ admission: current, counter });
          }
          if (current.lifecycle.state !== "reserved" || current.version !== request.expectedVersion) {
            throw new Error(`provider admission ${request.admissionId} is ${current.lifecycle.state} at version ${String(current.version)}`);
          }
          if (counter.activeReservations < 1) throw new Error(`provider counter ${current.capability} has no active reservation to interrupt`);
          counter = ProviderBudgetCounterSchema.parse({
            ...counter,
            activeReservations: counter.activeReservations - 1,
            ...(request.code === "cost-estimate-breach"
              ? { blockedByAdmissionId: current.admissionId }
              : {}),
            version: counter.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderCounter(counter, "update");
          const admission = ProviderAdmissionRecordSchema.parse({
            ...current,
            lifecycle: {
              state: "interrupted",
              interruptedAt: request.now,
              code: request.code,
              message: request.message,
              accounting: "full-reservation-retained",
              ...(request.evidence === undefined ? {} : { evidence: request.evidence }),
            },
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderAdmission(admission, "update");
          return ProviderAdmissionMutationOutcomeSchema.parse({ admission, counter });
        });
      },
      sweepExpired: (input: unknown) => {
        const request = ProviderAdmissionSweepRequestSchema.parse(input);
        return this.ports.transaction(() => {
          const rows = this.ports.database.prepare(`
            SELECT json_extract(record_json, '$.record') AS record_json FROM provider_usage WHERE json_extract(record_json,'$.kind')='legacy-capability' ORDER BY capability
          `).all();
          const expired: ProviderAdmissionRecord[] = [];
          const counters: ProviderBudgetCounter[] = [];
          for (const row of rows) {
            const initial = parseJsonRecord(
              ProviderBudgetCounterSchema,
              JsonRowSchema.parse(row).record_json,
            );
            const swept = this.#expireProviderLeases(initial, request.now);
            expired.push(...swept.expired);
            counters.push(this.#rollProviderCounter(swept.counter, request.now));
          }
          return ProviderAdmissionSweepOutcomeSchema.parse({ expired, counters });
        });
      },
      get: (admissionId: string) => this.#readRecord(
        "provider_requests",
        ProviderAdmissionIdSchema.parse(admissionId),
        ProviderAdmissionRecordSchema,
      ),
      getCounter: (capability: string) => this.#readProviderCounter(capability),
    });
  }

}

/** Shared deletion calls this port inside its tombstone/authority transaction. */
export function finalizeProviderRun(database: DatabaseSync, legacy: ProviderAdmissionRepository, runId: string, now: string): void {
  for (const raw of database.prepare("SELECT record_json FROM provider_requests WHERE run_id=? AND state='reserved'").all(runId)) {
    const stored = ProviderRequestStorageSchema.parse(JSON.parse(JsonRowSchema.parse(raw).record_json));
    if (stored.kind !== "legacy-capability") throw new Error("provider-generic-deletion-accounting-unavailable");
    legacy.interrupt({ admissionId: stored.record.admissionId, expectedVersion: stored.record.version,
      code: "aborted", message: "Owning run deleted; reservation retained", now });
  }
}
