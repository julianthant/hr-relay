import { retainAuthoritySourceClosure } from '../../../src/backend/storage/source-closure.js';
import { releaseSeededWriteOwners } from "./timeline-write-fixture.js";
import { createBoundProfileFixture } from "./admission-fixture.js";
import assert from "node:assert/strict";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { readTimelineRecords } from "../../../src/backend/storage/events/timeline-reader.js";
import { ExecutorSpanEventSchema } from "../../../src/backend/logs/span-emitter.js";
import type { ProtectedInputBinding } from "../../../src/models/write-safety/protected-input.js";

import { fixtureDuoCeremonyGates } from "./duo-ceremony-fixtures.js";
import type { BrowserDriver, TaskLogger } from "../../../src/workflow-kit/task.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import type { TestClock } from "../../../src/rules/time/clock.js";
import {
  BrowserSessionIdSchema,
  EidSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../src/rules/identity/ids.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import type {
  MonotonicDeadlineHandle,
  MonotonicDeadlineScheduler,
} from "../../../src/backend/runtime/scheduling/deadline-scheduler.js";
import type {
  ExecutorSpanEvent,
  SpanEmitter,
} from "../../../src/backend/logs/span-emitter.js";
import {
  WorkerSessionManager,
  type BrowserSessionCloseProof,
  type BrowserSessionCloseReason,
  type WorkerBrowserSessionFactory,
  type WorkerSessionEvent,
} from "../../../src/backend/runtime/workers/worker-sessions.js";
import { ReadOnboardingDatesOutputSchema } from "../../../src/models/systems/crm/read-onboarding-dates.js";
import { ReadOnboardingRecordOutputSchema } from "../../../src/models/systems/crm/read-onboarding-record.js";
import { AuthorityDatabase } from "./synthetic-database-admission.js";
import { createDeterministicCrmOnboardingDriver } from "../../../src/backend/systems/crm/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";
import { CONFIG_SNAPSHOT } from "../fixtures/phase1c-contract-fixtures.js";
import { personLookupDescriptor } from "./registered-workflows.js";

export const EXECUTOR_EID = EidSchema.parse("10873698");
export const EXECUTOR_WORKER_ID = WorkerIdSchema.parse("person-lookup-worker-1");
export const EXECUTOR_WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");
export const EXECUTOR_NOW = "2026-08-03T09:00:00.000Z";

/* ── authority ───────────────────────────────────────────────────────────── */

export interface AuthorityHarness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly profile: Awaited<ReturnType<typeof createBoundProfileFixture>>;

  readonly path: string;
  readonly stateRoot: string;
  readonly closeDatabase: () => void;
  readonly dispose: () => void | Promise<void>;
}

const retainedAuthorityHarnessOwners = new Set<object>();

export async function openAuthorityHarness(): Promise<AuthorityHarness> {
  const held: { fixture?: Awaited<ReturnType<typeof createBoundProfileFixture>>; database?: AuthorityDatabase; primary?: { error: unknown } } = {};
  retainedAuthorityHarnessOwners.add(held);
  try {
  const clock = manualClock(new Date(EXECUTOR_NOW));
  const fixture = await createBoundProfileFixture(); held.fixture = fixture;
  const root = fixture.stateRoot, path = fixture.path;
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  ); held.database = database;
  const config = database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  assert.equal(config.configSnapshotId, QUEUED_RUN.envelope.configSnapshotId);
  assert.equal(config.configFingerprint, QUEUED_RUN.envelope.configFingerprint);
  let closeAttempted = false, closeFailure: Error | undefined;
  const closeDatabase = (): void => {
    if (closeAttempted) { if (closeFailure !== undefined) throw closeFailure; return; }
    closeAttempted = true;
    try {
      releaseSeededWriteOwners(database, clock.now().toISOString());
      database.close();
    } catch (error) {
      held.primary = { error }; closeFailure = retainAuthoritySourceClosure([error], { admission: held }); throw closeFailure;
    }
  };
  let disposed = false;
  return {
    database,
    clock,
    profile: fixture,
    path,
    stateRoot: root,
    closeDatabase,
    dispose: async (): Promise<void> => {
      if (disposed) return;
      try {
        closeDatabase(); await fixture.close(); retainedAuthorityHarnessOwners.delete(held); disposed = true;
      }
      catch (error) { held.primary = { error }; closeFailure = retainAuthoritySourceClosure([error], { admission: held }); throw closeFailure; }
    },
  };
} catch (error) { held.primary = { error }; throw retainAuthoritySourceClosure([error], { admission: held }); }
}

/** A queued person-lookup run whose fingerprints match the REAL descriptor. */
export function personLookupQueuedRun(options: Readonly<{
  protectedBindings?: readonly ProtectedInputBinding[];
  runId?: string;
  itemId?: string;
  includeCrmDates?: boolean;
  startAt?: string;
  dryRun?: boolean;

  attempt?: number;
}> = {}): Record<string, unknown> {
  const parsedValue = {
    mode: "search", crmCheck: true,
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
      ...(options.attempt === undefined ? {} : { attempt: options.attempt }),
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      descriptorVersion: personLookupDescriptor.version,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: parsedValue,
        protectedBindings: options.protectedBindings ?? [],
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

/** Capture this execution's durable events, including service-owned lifecycle facts. */
export function recordingTimelineEmitter(database: AuthorityDatabase, clock: TestClock): RecordingEmitter {
  const repository = database.authority.timelineEvents;
  const after = repository.highWaterMark();
  return {
    emitter: createTimelineEmitter({ repository, clock }),
    events: () => Object.freeze(readTimelineRecords(repository, after).records.flatMap((record) => {
      if (record.payload.kind !== "span") return [];
      const { pid: _pid, ...event } = record.payload.event;
      return [ExecutorSpanEventSchema.parse(event)];
    })),
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

/** One ordered factory event, so a test can prove close-before-open ordering. */
export type SessionFactoryTraceEntry =
  | Readonly<{ kind: "open"; system: string; sessionId: string }>
  | Readonly<{ kind: "close"; system: string; sessionId: string; reason: BrowserSessionCloseReason }>;

export interface SessionFactoryHarness {
  readonly factory: WorkerBrowserSessionFactory;
  readonly opens: (system?: string) => number;
  readonly logins: () => number;
  readonly closeReasons: () => readonly BrowserSessionCloseReason[];
  readonly trace: () => readonly SessionFactoryTraceEntry[];
}


export function sessionFactoryHarness(
  drivers: Readonly<Record<string, (openIndex: number) => BrowserDriver>>,
): SessionFactoryHarness {
  let opens = 0;
  let logins = 0;
  const opensBySystem = new Map<string, number>();
  const admittedSyntheticProfiles = new Map<string, number>();
  const closeReasons: BrowserSessionCloseReason[] = [];
  const trace: SessionFactoryTraceEntry[] = [];
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
        if(!admittedSyntheticProfiles.has(input.system))admittedSyntheticProfiles.set(input.system,1);
        const profileRevision=admittedSyntheticProfiles.get(input.system);
        assert.ok(profileRevision!==undefined);
        const sessionId = BrowserSessionIdSchema.parse(
          `00000000-0000-4000-8000-${String(opens).padStart(12, "0")}`,
        );
        trace.push({ kind: "open", system: input.system, sessionId });
        return {
          sessionId,
          profileRevision,
          system: input.system,
          ...(input.instance === undefined ? {} : { instance: input.instance }),
          configFingerprint: input.configFingerprint,
          signInFingerprint: input.configFingerprint,
          ...(input.browserMode === undefined ? {} : { browserMode: input.browserMode }),
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
            trace.push({ kind: "close", system: input.system, sessionId, reason: closeInput.reason });
            return { sessionId, system: input.system, pagesClosed: true, contextClosed: true };
          },
        };
      },
    },
    opens: (system?: string) => (system === undefined ? opens : opensBySystem.get(system) ?? 0),
    logins: () => logins,
    closeReasons: () => Object.freeze([...closeReasons]),
    trace: () => Object.freeze([...trace]),
  };
}

/** The happy-path CRM driver whose record matches the fixture EID. */
export function healthyCrmDriver() {
  return createDeterministicCrmOnboardingDriver({
    discovery: [{ recordId: "ONB-40213", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-40213", emplId: EXECUTOR_EID, name: "Deterministic, Person", department: "Housing Dining Hospitality", firstDayOfService: "07/15/2026", dateSigned: "07/01/2026" }],
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
      state: "read", employmentDate: "2026-07-15", oathDate: "2026-07-01", reason: "",
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


export const FIXTURE_SESSION_ACQUIRE_MS = 60_000;

export async function sessionManagerFor(
  harness: SessionFactoryHarness,
  clock: TestClock,
  onEvent?: (event: WorkerSessionEvent) => void,
  scheduler: MonotonicDeadlineScheduler = new ManualScheduler(clock),
): Promise<WorkerSessionManager> {
  const manager = new WorkerSessionManager({
    workerId: EXECUTOR_WORKER_ID,
    workflowId: EXECUTOR_WORKFLOW_ID,
    stores: taskStoreRegistry,
    factory: harness.factory,
    clock,
    scheduler,
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony: await fixtureDuoCeremonyGates(clock),
    ...(onEvent === undefined ? {} : { onEvent }),
  });

  manager.bindRunConfigFingerprint(FingerprintSchema.parse(QUEUED_RUN.envelope.configFingerprint));
  return manager;
}
