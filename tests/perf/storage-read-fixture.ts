import { manualClock, systemClock, type TestClock } from "../../src/rules/time/clock.js";
import { createNoteTimelineWriter } from "../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../support/helpers/synthetic-storage-admission.js";
import { createBoundProfileFixture } from "../support/helpers/admission-fixture.js";
import { CONFIG_SNAPSHOT } from "../support/fixtures/phase1c-contract-fixtures.js";
import { enqueueRun, type SeedContext } from "./dashboard-fixture.js";
import { assertFakeKeychain } from "./fake-keychain-entry.js";

export const STORAGE_READ_FIXTURE_DAYS = Object.freeze(["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"] as const);
/** Notes per run, so the timeline grows with the run count the way a real store's does. */
export const STORAGE_READ_NOTES_PER_RUN = 1;

export interface StorageReadFixture {
  readonly path: string;
  readonly clock: TestClock;
  /** The dashboard's connection: every timed read runs here. */
  readonly reader: AuthorityDatabase;
  /** A second connection whose commits move the reader's `PRAGMA data_version`. */
  readonly writer: AuthorityDatabase;
  /** Seeds through the second connection, so its runs, heartbeats and completions are peer commits to the reader. */
  readonly writerContext: SeedContext;
  readonly runCount: number;
  readonly seedMs: number;
  close(): Promise<void>;
}

/** `runCount` queued runs (one in five a Separations run) spread over five days, each with a short note trail. */
export async function seedStorageReadFixture(runCount: number): Promise<StorageReadFixture> {
  await assertFakeKeychain();
  const started = systemClock.monotonicMs();
  const profile = await createBoundProfileFixture();
  const path = profile.path;
  const clock = manualClock(new Date(`${STORAGE_READ_FIXTURE_DAYS[0]}T09:00:00.000-07:00`));
  const reader = AuthorityDatabase.open({ path, busyTimeoutMs: 1000, migrationOwner: "storage-read-perf-reader" }, clock);
  const opened: AuthorityDatabase[] = [reader];
  try {
    // Opened on the empty store: opening after the seed would validate every seeded row once more.
    const writer = AuthorityDatabase.open({ path, busyTimeoutMs: 1000, migrationOwner: "storage-read-perf-writer" }, clock);
    opened.push(writer);
    const spans = createTimelineEmitter({ repository: reader.authority.timelineEvents, clock, pid: 4242 });
    const notes = createNoteTimelineWriter({ repository: reader.authority.timelineEvents, clock, pid: 4242 });
    const context: SeedContext = { workers: new Map(), path, database: reader, clock, spans, notes };
    reader.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    reader.withAuthorityTransaction(() => {
      for (let seed = 1; seed <= runCount; seed += 1) {
        const day = STORAGE_READ_FIXTURE_DAYS[seed % STORAGE_READ_FIXTURE_DAYS.length];
        const separations = seed % 5 === 0;
        const run = enqueueRun(context, { seed, day, title: `EID 10${String(800_000 + seed)}`, separations });
        for (let index = 0; index < STORAGE_READ_NOTES_PER_RUN; index += 1) {
          notes.emitNote({
            workflow: run.envelope.workflow,
            address: { runId: run.envelope.runId, attempt: 1, traceId: run.envelope.traceId, spanPath: run.envelope.traceId },
            level: "step",
            message: `step ${String(index + 1)} of the lookup`,
          });
        }
      }
    });
    const seedMs = systemClock.monotonicMs() - started;
    const writerContext: SeedContext = { workers: new Map(), path, database: writer, clock,
      spans: createTimelineEmitter({ repository: writer.authority.timelineEvents, clock, pid: 4343 }),
      notes: createNoteTimelineWriter({ repository: writer.authority.timelineEvents, clock, pid: 4343 }) };
    return Object.freeze({
      path, clock, reader, writer, writerContext, runCount, seedMs,
      close: async (): Promise<void> => {
        for (const database of opened) database.close();
        await profile.close();
      },
    });
  } catch (error) {
    for (const database of opened) database.close();
    await profile.close();
    throw error;
  }
}
