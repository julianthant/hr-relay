import { sha256Hex } from "../../../rules/validation/sha256.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import { GenericProviderRequestSchema, GenericProviderUsageSchema } from "../../../rules/providers/provider-accounting.js";
import type { ProviderAccountingStorage } from "../../../workflow-kit/provider-accounting.js";
import { ProviderUsageStorageSchema, type ProviderRequestStorage, type ProviderUsageStorage } from "../../../rules/providers/provider-accounting.js";
import { ProviderRequestStorageSchema } from "../../../rules/providers/provider-accounting.js";
import { readProviderRequest, readProviderUsage, writeProviderRequest, writeProviderUsage } from "./provider-storage.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ProviderAdmissionRepository } from "../../../workflow-kit/providers.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { providerBudget, type ProviderBudget } from "../../../models/config/schema.js";
import { ConfigSnapshotRecordSchema, type ConfigSnapshotRecord } from "../../../models/config/snapshot.js";
import { ProviderCapabilityIdSchema, ProviderAdmissionIdSchema } from "../../../rules/identity/ids.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { TableName, AuthorityTableName } from "../../../models/config/authority.js";
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
} from "../../../rules/providers/provider-admission.js";
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
      reservedWindowIds:(scopeId,meter)=>reservedWindowIds(this.ports.database,scopeId,meter),
      writeRequest:(record:ProviderRequestStorage,expectedVersion:number|null)=>this.ports.mutate("provider_requests",()=>{
        if(record.kind==="generic"){
          const run=this.ports.readRun(record.execution.runId);
          const snapshot=this.#readRecord("settings_snapshots",record.configSnapshotId,ConfigSnapshotRecordSchema);
          if(run===undefined||snapshot===undefined)throw new Error("provider-execution-missing");
          if(run.envelope.attempt!==record.execution.attempt||run.envelope.configSnapshotId!==record.configSnapshotId
            ||run.envelope.configFingerprint!==record.configFingerprint||snapshot.fingerprint!==record.configFingerprint)throw new Error("provider-execution-config-mismatch");
          if(expectedVersion===null&&isRunNodeExecutionIdentity(record.execution)
            &&(run.lifecycle.state!=="running"||run.lifecycle.currentNodeId!==record.execution.nodeId))throw new Error("provider-execution-node-mismatch");
        }
        writeProviderRequest(this.ports.database,record,expectedVersion);return {result:undefined,changes:1};
      }),
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
    if (stored.kind === "generic") {
      // The caller already owns the authority transaction, including tombstone
      // and generation. Do not start a nested SQLite transaction here.
      const storage:ProviderAccountingStorage={
        transaction:work=>work(storage),getRequest:id=>readProviderRequest(database,id),getUsage:id=>readProviderUsage(database,id),
        listUsage:()=>database.prepare("SELECT record_json FROM provider_usage ORDER BY record_key").all().map(row=>ProviderUsageStorageSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json))),
        reservedWindowIds:(scopeId,meter)=>reservedWindowIds(database,scopeId,meter),
        writeRequest:(record,version)=>writeProviderRequest(database,record,version),writeUsage:(record,version)=>writeProviderUsage(database,record,version),
      };
      createGenericProviderAccounting(storage).finish({requestId:stored.requestId,expectedVersion:stored.version,now,
        state:"interrupted",usage:[],reason:"Owning run deleted; reservation retained"});
      continue;
    }
    legacy.interrupt({ admissionId: stored.record.admissionId, expectedVersion: stored.record.version,
      code: "aborted", message: "Owning run deleted; reservation retained", now });
  }
}

// Generic policy lives on F's frozen storage port. No provider registry or adapter
// is consulted. Scope references and limits are explicit caller-supplied inputs.
type GenericRequest = Extract<ProviderRequestStorage, { kind: "generic" }>;
type GenericUsage = Extract<ProviderUsageStorage, { kind: "generic" }>;
type Quantity = GenericUsage["cumulative"];
type Window = GenericUsage["windows"][number];
const BoundSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const GenericBudgetSchema = z.strictObject({
  scope: GenericProviderUsageSchema.shape.scope,
  meter: GenericProviderUsageSchema.shape.meter,
  upperBound: BoundSchema.nullable(),
  windows: z.array(GenericProviderUsageSchema.shape.windows.element.pick({id:true,startsAt:true,endsAt:true,limit:true})).min(1).max(128),
});
const GenericReserveSchema = z.strictObject(GenericProviderRequestSchema.shape).pick({
  requestId:true,execution:true,capability:true,configSnapshotId:true,configFingerprint:true,requestFingerprint:true,attribution:true,
}).extend({now:IsoInstantSchema,leaseExpiresAt:IsoInstantSchema,deadlineAt:IsoInstantSchema,budgets:z.array(GenericBudgetSchema).min(1).max(128)});
const GenericFinishSchema = z.strictObject({
  requestId:z.uuid(),expectedVersion:z.number().int().positive(),now:IsoInstantSchema,
  state:z.enum(["settled","interrupted","lease-expired"]),
  usage:GenericProviderRequestSchema.shape.usage,reason:z.string().min(1).max(512).nullable(),
});
function same(a:unknown,b:unknown):boolean { return canonicalJsonStringify(a)===canonicalJsonStringify(b); }
function amount(q:Quantity):number|null {return q.kind==="unknown"?q.retainedUpperBound:q.value;}
function addAmount(a:number,b:number):number {return BoundSchema.parse(a+b);}
function addQuantity(a:Quantity,b:Quantity):Quantity {
  const av=amount(a),bv=amount(b);
  if(a.kind==="unknown"||b.kind==="unknown")return {kind:"unknown",retainedUpperBound:av===null||bv===null?null:addAmount(av,bv)};
  return {kind:a.kind==="estimated"||b.kind==="estimated"?"estimated":"measured",value:addAmount(a.value,b.value)};
}
function usageIdentity(scopeId:string,meter:string):string {return `usage/${sha256Hex(canonicalJsonStringify([scopeId,meter]))}`;}
function checkedUsage(input:unknown):GenericUsage {
  const record=ProviderUsageStorageSchema.parse(input);
  if(record.kind!=="generic")throw new Error("provider-generic-identity-conflict");
  const u=GenericProviderUsageSchema.parse(record);
  if(new Set(u.windows.map(w=>w.id)).size!==u.windows.length)throw new Error("provider-duplicate-window");
  for(const w of u.windows){
    if(w.endsAt!==null&&Date.parse(w.endsAt)<=Date.parse(w.startsAt))throw new Error("provider-window-invalid");
    BoundSchema.parse(w.reserved);BoundSchema.parse(w.retainedUnknown);
    if(w.settled.kind==="unknown")throw new Error("provider-window-unknown-in-settled");
  }
  return u;
}
/** Remaining is local accounting, including conservative unknown charges exactly once. */
export function providerWindowRemaining(window:Window):{kind:"known";value:number}|{kind:"unknown";reason:string} {
  if(window.limit.kind==="unknown")return {kind:"unknown",reason:"limit-not-supplied"};
  const settled=amount(window.settled);
  if(settled===null)return {kind:"unknown",reason:"usage-not-bounded"};
  return {kind:"known",value:window.limit.value-addAmount(addAmount(settled,window.retainedUnknown),window.reserved)};
}

function reservedWindowIds(database:DatabaseSync,scopeId:string,meter:string):readonly string[] {
  return database.prepare(`SELECT DISTINCT json_extract(a.value,'$.windowId') AS id
    FROM provider_requests AS r, json_each(r.record_json,'$.allocations') AS a
    WHERE r.state='reserved' AND json_extract(r.record_json,'$.kind')='generic'
      AND json_extract(a.value,'$.scopeId')=? AND json_extract(a.value,'$.meter')=?`)
    .all(scopeId,meter).map(row=>z.strictObject({id:z.string()}).parse(row).id);
}

export function createGenericProviderAccounting(storage:ProviderAccountingStorage) {
  const finish=(input:unknown):GenericRequest=>{
    const req=GenericFinishSchema.parse(input);
    return storage.transaction(s=>{
      const current=s.getRequest(req.requestId);
      if(current?.kind!=="generic")throw new Error("provider-request-missing");
      if(new Set(req.usage.map(u=>u.meter)).size!==req.usage.length)throw new Error("provider-duplicate-meter");
      if(current.state!=="reserved"){
        if(current.version===req.expectedVersion+1&&current.state===req.state&&same(current.usage,req.usage)&&current.reason===req.reason&&current.updatedAt===req.now)return current;
        throw new Error("provider-finalization-replay-conflict");
      }
      if(current.version!==req.expectedVersion)throw new Error("provider-request-version-conflict");
      if(Date.parse(req.now)<Date.parse(current.updatedAt))throw new Error("provider-time-backwards");
      if(current.leaseExpiresAt===null)throw new Error("provider-reservation-lease-missing");
      if(req.state==="lease-expired"&&Date.parse(req.now)<Date.parse(current.leaseExpiresAt))throw new Error("provider-lease-not-expired");
      if(req.state==="settled"&&Date.parse(req.now)>=Date.parse(current.leaseExpiresAt))throw new Error("provider-lease-expired");
      const meters=new Set(current.allocations.map(a=>a.meter));
      if(req.usage.some(u=>!meters.has(u.meter)))throw new Error("provider-unreserved-meter");
      if(req.state!=="settled"&&req.usage.length!==0)throw new Error("provider-uncertain-outcome-has-usage");
      const changes=new Map<string,GenericUsage>();
      const charged=new Set<string>();
      for(const a of current.allocations){
        const key=usageIdentity(a.scopeId,a.meter);
        let u=changes.get(key);
        if(u===undefined){const found=s.getUsage(key);if(found===undefined)throw new Error("provider-allocation-usage-missing");u=checkedUsage(found);}
        const index=u.windows.findIndex(w=>w.id===a.windowId);
        const w=u.windows[index];
        if(w===undefined||w.startsAt!==a.windowStartedAt||w.endsAt!==a.windowEndsAt||w.reserved<a.upperBound)throw new Error("provider-allocation-window-mismatch");
        const supplied=req.usage.find(v=>v.meter===a.meter)?.quantity;
        const q:Quantity=supplied?.kind==="unknown"||supplied===undefined
          ?{kind:"unknown",retainedUpperBound:Math.max(a.upperBound,supplied?.retainedUpperBound??0)}:supplied;
        const value=amount(q);if(value===null)throw new Error("provider-unbounded-settlement");BoundSchema.parse(value);
        const windows=[...u.windows];windows[index]={...w,reserved:w.reserved-a.upperBound,
          settled:q.kind==="unknown"?w.settled:addQuantity(w.settled,q),
          retainedUnknown:q.kind==="unknown"?addAmount(w.retainedUnknown,value):w.retainedUnknown};
        const cumulative=charged.has(key)||a.trackingOrigin==="pre-tracking"?u.cumulative:addQuantity(u.cumulative,q);
        charged.add(key);changes.set(key,{...u,windows,cumulative});
      }
      const updated=GenericProviderRequestSchema.parse({...current,state:req.state,usage:req.usage,reason:req.reason,
        leaseExpiresAt:null,deadlineAt:null,version:current.version+1,updatedAt:req.now});
      s.writeRequest(updated,current.version);
      for(const u of changes.values())s.writeUsage(GenericProviderUsageSchema.parse({...u,version:u.version+1,updatedAt:req.now}),u.version);
      return updated;
    });
  };
  return Object.freeze({
    reserve(input:unknown):{state:"reserved"|"denied"|"existing";request:GenericRequest} {
      const req=GenericReserveSchema.parse(input);
      if(req.attribution.kind==="legacy-capability"||req.budgets.some(b=>b.scope.kind==="legacy-capability"))throw new Error("provider-generic-legacy-scope");
      if(Date.parse(req.deadlineAt)<=Date.parse(req.now)||Date.parse(req.leaseExpiresAt)<Date.parse(req.deadlineAt))throw new Error("provider-deadline-invalid");
      const scopeKeys=req.budgets.map(b=>usageIdentity(b.scope.id,b.meter));
      if(new Set(scopeKeys).size!==scopeKeys.length)throw new Error("provider-duplicate-scope-meter");
      const bounds=new Map<string,number|null>();
      for(const b of req.budgets){
        if(bounds.has(b.meter)&&bounds.get(b.meter)!==b.upperBound)throw new Error("provider-meter-bound-conflict");bounds.set(b.meter,b.upperBound);
        if(new Set(b.windows.map(w=>w.id)).size!==b.windows.length)throw new Error("provider-duplicate-window");
        for(const w of b.windows)if(Date.parse(w.startsAt)>Date.parse(req.now)||(w.endsAt!==null&&Date.parse(req.now)>=Date.parse(w.endsAt)))throw new Error("provider-window-not-current");
      }
      // Binding the full admission input also protects denied decisions (which
      // correctly have no allocations) against changed-budget replay.
      const fingerprint=sha256Hex(canonicalJsonStringify(req));
      return storage.transaction(s=>{
        const old=s.getRequest(req.requestId);
        if(old!==undefined){
          if(old.kind!=="generic"||old.requestFingerprint!==fingerprint)throw new Error("provider-reservation-replay-conflict");
          return {state:"existing",request:old};
        }
        const allocations:GenericRequest["allocations"]=[];
        const changes:{usage:GenericUsage;previous:number|null}[]=[];
        let refusal:string|null=null;
        for(const b of req.budgets){
          const key=usageIdentity(b.scope.id,b.meter);const stored=s.getUsage(key);
          const u:GenericUsage=stored===undefined?GenericProviderUsageSchema.parse({format:1,kind:"generic",usageId:key,scope:b.scope,meter:b.meter,
            tracking:{startedAt:req.now,coverage:"complete-since-start",evidence:"caller-supplied"},cumulative:{kind:"measured",value:0},windows:[],version:1,createdAt:req.now,updatedAt:req.now}):checkedUsage(stored);
          if(!same(u.scope,b.scope)||u.meter!==b.meter)throw new Error("provider-scope-identity-conflict");
          if(Date.parse(req.now)<Date.parse(u.updatedAt))throw new Error("provider-time-backwards");
          const held=new Set(s.reservedWindowIds(b.scope.id,b.meter));
          // Only finalized, expired history may leave the bounded aggregate.
          // Requests keep their immutable allocations for exact replay; active
          // allocations retain original windows even when their bound is zero.
          const windows=u.windows.filter(w=>w.endsAt===null||Date.parse(w.endsAt)>Date.parse(req.now)||w.reserved!==0||held.has(w.id));
          for(const policy of b.windows){
            const index=windows.findIndex(w=>w.id===policy.id);const oldWindow=windows[index];
            if(oldWindow!==undefined&&!same({id:oldWindow.id,startsAt:oldWindow.startsAt,endsAt:oldWindow.endsAt,limit:oldWindow.limit},policy))throw new Error("provider-window-policy-conflict");
            const w:Window=oldWindow??{...policy,settled:{kind:"measured",value:0},reserved:0,retainedUnknown:0};
            const remaining=providerWindowRemaining(w);
            if(b.upperBound===null)refusal="upper-bound-required";
            else {
              if(w.limit.kind==="configured"&&(remaining.kind==="unknown"||remaining.value<b.upperBound))refusal="budget-exhausted";
              allocations.push({scopeId:b.scope.id,meter:b.meter,windowId:w.id,windowStartedAt:w.startsAt,windowEndsAt:w.endsAt,upperBound:b.upperBound,trackingOrigin:"tracked"});
              const next={...w,reserved:addAmount(w.reserved,b.upperBound)};
              if(index===-1)windows.push(next);else windows[index]=next;
            }
          }
          changes.push({usage:checkedUsage({...u,windows,version:stored===undefined?1:u.version+1,updatedAt:req.now}),previous:stored===undefined?null:u.version});
        }
        const request=GenericProviderRequestSchema.parse({format:1,kind:"generic",requestId:req.requestId,execution:req.execution,capability:req.capability,
          configSnapshotId:req.configSnapshotId,configFingerprint:req.configFingerprint,requestFingerprint:fingerprint,attribution:req.attribution,
          allocations:refusal===null?allocations:[],state:refusal===null?"reserved":"denied",usage:[],reason:refusal,
          leaseExpiresAt:refusal===null?req.leaseExpiresAt:null,deadlineAt:refusal===null?req.deadlineAt:null,version:1,createdAt:req.now,updatedAt:req.now});
        // The real storage boundary validates the owning execution/config before
        // any aggregate is changed. The surrounding transaction rolls back both.
        s.writeRequest(request,null);
        if(refusal===null)for(const change of changes)s.writeUsage(change.usage,change.previous);
        return {state:refusal===null?"reserved":"denied",request};
      });
    },
    finish,
    read(){return storage.listUsage().filter((u):u is GenericUsage=>u.kind==="generic").map(u=>{
      const checked=checkedUsage(u);return {...checked,windows:checked.windows.map(w=>({...w,remaining:providerWindowRemaining(w)}))};
    });},
  });
}

/** Separate generic consistency proof; legacy counters never stand in for it. */
export function inspectGenericProviderAccounting(database:DatabaseSync):void {
  const usages=database.prepare("SELECT record_json FROM provider_usage WHERE json_extract(record_json,'$.kind')='generic'").all()
    .map(row=>checkedUsage(ProviderUsageStorageSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json))));
  const expected=new Map<string,number>();
  for(const row of database.prepare("SELECT record_json FROM provider_requests WHERE json_extract(record_json,'$.kind')='generic'").all()){
    const r=GenericProviderRequestSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json));
    for(const a of r.allocations){
      const u=usages.find(v=>v.scope.id===a.scopeId&&v.meter===a.meter);
      const w=u?.windows.find(v=>v.id===a.windowId);
      if(w===undefined||w.startsAt!==a.windowStartedAt||w.endsAt!==a.windowEndsAt){
        // A finalized expired period may have been compacted even when its
        // label now names a later period. Active/original periods still match
        // the complete immutable allocation, including both boundaries.
        if(u!==undefined&&r.state!=="reserved"&&a.windowEndsAt!==null&&Date.parse(a.windowEndsAt)<=Date.parse(u.updatedAt))continue;
        throw new Error("provider-generic-allocation-mismatch");
      }
      if(r.state==="reserved"){
        const key=canonicalJsonStringify([a.scopeId,a.meter,a.windowId]);expected.set(key,addAmount(expected.get(key)??0,a.upperBound));
      }
    }
  }
  for(const u of usages)for(const w of u.windows){
    const key=canonicalJsonStringify([u.scope.id,u.meter,w.id]);
    if(w.reserved!==(expected.get(key)??0))throw new Error("provider-generic-reservation-mismatch");
  }
}
