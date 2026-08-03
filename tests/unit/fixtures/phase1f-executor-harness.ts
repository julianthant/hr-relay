/**
 * Shared Phase-1f interpreter harness: a real temp-file AuthorityDatabase, a
 * deterministic browser-session factory that serves the checked-in fake
 * drivers, a recording span emitter/logger, and a manual monotonic scheduler.
 *
 * Everything here drives the REAL landed pieces — descriptor, stores, claim
 * store, session manager — with only the process edges (browser, clock, ids,
 * timers, span sink) replaced by recording fakes, so a test that passes here
 * pins production composition, not a parallel reimplementation.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserDriver, TaskLogger } from "../../../src/base/task.js";
import { manualClock } from "../../../src/domain/clock.js";
import type { TestClock } from "../../../src/domain/clock.js";
import {
  BrowserSessionIdSchema,
  EidSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../src/domain/ids.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import type {
  MonotonicDeadlineHandle,
  MonotonicDeadlineScheduler,
} from "../../../src/core/deadline-scheduler.js";
import type {
  ExecutorSpanEvent,
  SpanEmitter,
} from "../../../src/core/span-emitter.js";
import {
  WorkerSessionManager,
  type BrowserSessionCloseProof,
  type BrowserSessionCloseReason,
  type WorkerBrowserSessionFactory,
} from "../../../src/core/worker-sessions.js";
import { ReadOnboardingDatesOutputSchema } from "../../../src/domain/contracts/crm/read-onboarding-dates.js";
import { ReadOnboardingRecordOutputSchema } from "../../../src/domain/contracts/crm/read-onboarding-record.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { createDeterministicCrmOnboardingDriver } from "../../../src/stores/crm/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/stores/ucpath/driver/fake.js";
import { taskStoreRegistry } from "../../../src/stores/index.js";
import {
  PersonLookupCanonicalInput,
  personLookupDescriptor,
} from "../../../src/workflows/person-lookup/descriptor.js";
import { QUEUED_RUN } from "./phase1f-run-fixtures.js";

export const EXECUTOR_EID = EidSchema.parse("10873698");
export const EXECUTOR_WORKER_ID = WorkerIdSchema.parse("person-lookup-worker-1");
export const EXECUTOR_WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");
export const EXECUTOR_NOW = "2026-08-03T09:00:00.000Z";

/* ── authority ───────────────────────────────────────────────────────────── */

export interface AuthorityHarness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly dispose: () => void;
}

export function openAuthorityHarness(): AuthorityHarness {
  const clock = manualClock(new Date(EXECUTOR_NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-1f-executor-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  return {
    database,
    clock,
    dispose: (): void => {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** A queued person-lookup run whose fingerprints match the REAL descriptor. */
export function personLookupQueuedRun(options: Readonly<{
  runId?: string;
  itemId?: string;
  includeCrmDates?: boolean;
  startAt?: string;
  dryRun?: boolean;
}> = {}): Record<string, unknown> {
  const parsedValue = {
    emplId: EXECUTOR_EID,
    keepNonHdh: false,
    includeCrmDates: options.includeCrmDates ?? false,
  };
  return {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      ...(options.runId === undefined ? {} : { runId: options.runId }),
      ...(options.itemId === undefined ? {} : { itemId: options.itemId }),
      ...(options.startAt === undefined ? {} : { startAt: options.startAt }),
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: parsedValue,
      },
    },
    createdAt: QUEUED_RUN.createdAt,
    updatedAt: QUEUED_RUN.updatedAt,
  };
}

/* ── recording fakes ─────────────────────────────────────────────────────── */

export interface RecordingEmitter {
  readonly emitter: SpanEmitter;
  readonly events: () => readonly ExecutorSpanEvent[];
}

export function recordingEmitter(): RecordingEmitter {
  const events: ExecutorSpanEvent[] = [];
  return {
    emitter: { emit: (event): void => { events.push(event); } },
    events: () => Object.freeze([...events]),
  };
}

export interface RecordingLogger {
  readonly log: TaskLogger;
  readonly entries: () => readonly string[];
}

export function recordingLogger(): RecordingLogger {
  const entries: string[] = [];
  const push = (level: string) => (message: string): void => {
    entries.push(`${level}:${message}`);
  };
  return {
    log: { debug: push("debug"), info: push("info"), warn: push("warn") },
    entries: () => Object.freeze([...entries]),
  };
}

/* ── manual scheduler ────────────────────────────────────────────────────── */

export interface ScheduledEntry {
  readonly deadlineMonotonicMs: number;
  readonly fire: () => void;
  readonly cancelled: () => boolean;
}

/**
 * Deterministic `MonotonicDeadlineScheduler`. Entries whose delay from the
 * current monotonic clock is at or below `autoFireAtOrBelowMs` fire on a
 * microtask (retry backoffs in tests); everything else waits for an explicit
 * `fire`. The default (0) never auto-fires anything.
 */
export class ManualScheduler implements MonotonicDeadlineScheduler {
  readonly #clock: TestClock;
  readonly #autoFireAtOrBelowMs: number;
  readonly #entries: { deadline: number; onDeadline: () => void; cancelled: boolean; fired: boolean }[] = [];

  constructor(clock: TestClock, autoFireAtOrBelowMs = 0) {
    this.#clock = clock;
    this.#autoFireAtOrBelowMs = autoFireAtOrBelowMs;
  }

  schedule(deadlineMonotonicMs: number, onDeadline: () => void): MonotonicDeadlineHandle {
    const entry = { deadline: deadlineMonotonicMs, onDeadline, cancelled: false, fired: false };
    this.#entries.push(entry);
    const delay = deadlineMonotonicMs - this.#clock.monotonicMs();
    if (delay <= this.#autoFireAtOrBelowMs) {
      queueMicrotask(() => {
        if (!entry.cancelled && !entry.fired) {
          entry.fired = true;
          entry.onDeadline();
        }
      });
    }
    return {
      cancel: (): void => {
        entry.cancelled = true;
      },
    };
  }

  pending(): readonly ScheduledEntry[] {
    return this.#entries
      .filter((entry) => !entry.cancelled && !entry.fired)
      .map((entry) => ({
        deadlineMonotonicMs: entry.deadline,
        fire: (): void => {
          if (entry.cancelled || entry.fired) throw new Error("entry is no longer pending");
          entry.fired = true;
          entry.onDeadline();
        },
        cancelled: () => entry.cancelled,
      }));
  }
}

/* ── deterministic browser-session factory ───────────────────────────────── */

export interface SessionFactoryHarness {
  readonly factory: WorkerBrowserSessionFactory;
  readonly opens: (system?: string) => number;
  readonly logins: () => number;
  readonly closeReasons: () => readonly BrowserSessionCloseReason[];
}

/**
 * Serves one driver instance per system per open. `drivers` maps a system to a
 * factory so a test can serve a failing driver on the first open and a healthy
 * one on the second (poison-close → fresh session).
 */
export function sessionFactoryHarness(
  drivers: Readonly<Record<string, (openIndex: number) => BrowserDriver>>,
): SessionFactoryHarness {
  let opens = 0;
  let logins = 0;
  const opensBySystem = new Map<string, number>();
  const closeReasons: BrowserSessionCloseReason[] = [];
  return {
    factory: {
      async open(input) {
        opens += 1;
        const systemOpens = (opensBySystem.get(input.system) ?? 0) + 1;
        opensBySystem.set(input.system, systemOpens);
        const driverFactory = drivers[input.system];
        if (driverFactory === undefined) {
          throw new Error(`session factory has no driver for ${input.system}`);
        }
        const driver = driverFactory(systemOpens);
        const sessionId = BrowserSessionIdSchema.parse(
          `00000000-0000-4000-8000-${String(opens).padStart(12, "0")}`,
        );
        return {
          sessionId,
          system: input.system,
          ...(input.instance === undefined ? {} : { instance: input.instance }),
          configFingerprint: input.configFingerprint,
          acceptDownloads: input.acceptDownloads,
          exclusive: input.exclusive,
          driver,
          authentication: {
            authenticate: async (): Promise<"logged-in"> => {
              logins += 1;
              return "logged-in";
            },
          },
          async reset(): Promise<void> {
            // neutral reset succeeds by default
          },
          async close(closeInput: Readonly<{ reason: BrowserSessionCloseReason }>): Promise<BrowserSessionCloseProof> {
            closeReasons.push(closeInput.reason);
            return { sessionId, system: input.system, pagesClosed: true, contextClosed: true };
          },
        };
      },
    },
    opens: (system?: string) => (system === undefined ? opens : opensBySystem.get(system) ?? 0),
    logins: () => logins,
    closeReasons: () => Object.freeze([...closeReasons]),
  };
}

/** The happy-path CRM driver whose record matches the fixture EID. */
export function healthyCrmDriver() {
  return createDeterministicCrmOnboardingDriver({
    record: ReadOnboardingRecordOutputSchema.parse({
      state: "found",
      record: {
        recordId: "ONB-40213",
        emplId: EXECUTOR_EID,
        fullName: "Deterministic, Person",
        rawStage: "Completed",
      },
    }),
    dates: ReadOnboardingDatesOutputSchema.parse({
      emplId: EXECUTOR_EID,
      invitedOn: { state: "present", value: "2026-06-01" },
      startsOn: { state: "present", value: "2026-07-15" },
      completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
    }),
  });
}

export function healthyUcpathDriver() {
  return createDeterministicUcpathPersonOrgDriver();
}

export function happySessionHarness(): SessionFactoryHarness {
  return sessionFactoryHarness({
    ucpath: () => healthyUcpathDriver(),
    crm: () => healthyCrmDriver(),
  });
}

export function sessionManagerFor(
  harness: SessionFactoryHarness,
  clock: TestClock,
): WorkerSessionManager {
  const manager = new WorkerSessionManager({
    workerId: EXECUTOR_WORKER_ID,
    workflowId: EXECUTOR_WORKFLOW_ID,
    stores: taskStoreRegistry,
    factory: harness.factory,
    clock,
  });
  // D116: production binds the claimed run's fingerprint in the worker loop;
  // this harness stands in for that loop, so it binds the fixture envelope's
  // exact fingerprint (`QUEUED_RUN.envelope.configFingerprint`).
  manager.bindRunConfigFingerprint(FingerprintSchema.parse(QUEUED_RUN.envelope.configFingerprint));
  return manager;
}
