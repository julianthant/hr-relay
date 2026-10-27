import { traceOf } from "../../../../fixtures/dashboard/fixture-identity.js";
import { sectionResponse } from "../../../../fixtures/dashboard/run-detail/section-wire.js";
import { NotePageSchema } from "../../../../../../src/models/dashboard/run-detail.js";
import type * as FixtureIdentityTypes from "../../../../fixtures/dashboard/fixture-identity.js";
import type * as FixtureQueueTypes from "../../../../fixtures/dashboard/fixture-queue.js";


type NoteSeed = Readonly<{
  level: "info" | "warning" | "error";
  minute: number;
  message: string;
}>;

export function createLogsCapturesSetup({ at, uuidOf, FIXTURE_IDS }: {
at: typeof FixtureIdentityTypes.at;
uuidOf: typeof FixtureIdentityTypes.uuidOf;
FIXTURE_IDS: typeof FixtureQueueTypes.FIXTURE_IDS;
}) {
  function notePageOf(seed: number, notes: readonly NoteSeed[]) {
    const rows = notes.map((note, index) => ({
      kind: "note" as const,
      native: { eventId: uuidOf(seed * 1000 + index + 1), order: index * 2 + 1,
        runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed) },
      logId: uuidOf(seed * 1000 + index + 1),
      sequence: index,
      note: {
        native: { eventId: uuidOf(seed * 1000 + index + 1), order: index * 2 + 1,
          runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed) },
        noteId: uuidOf(seed * 1000 + index + 1),
        runId: uuidOf(seed),
        sequence: index,
        at: at(note.minute, index),
        level: note.level,
        message: note.message,
      },
    }));
    const page = NotePageSchema.parse({
      runId: uuidOf(seed),
      rows,
      notes: rows.map((row) => row.note),
      nextCursor: { state: "absent", reason: "end-of-page" },
    });
    if (page.rows === undefined) {
      throw new Error(`fixture log page for run ${String(page.runId)} omits live rows`);
    }
    return page;
  }

  const logSeeds = [
    [FIXTURE_IDS.queuedRun, 1, [
      { level: "info", minute: 55, message: "Run queued at interactive priority" },
    ]],
    [FIXTURE_IDS.runningRun, 2, [
      { level: "info", minute: 52, message: "Searching UCPath directory for Battistessa, Johnnie" },
      { level: "info", minute: 53, message: "2 candidates returned from person search" },
      { level: "info", minute: 54, message: "Selecting the exact name match" },
    ]],
    [FIXTURE_IDS.doneRun, 3, [
      { level: "info", minute: 35, message: "Searching UCPath directory for EID 10101010" },
      { level: "info", minute: 36, message: "Cross-verified against the CRM onboarding record" },
      { level: "info", minute: 37, message: "Active status resolved: active" },
      { level: "info", minute: 38, message: "CRM onboarding dates recorded" },
    ]],
    [FIXTURE_IDS.failedRun, 4, [
      { level: "info", minute: 33, message: "Searching UCPath directory for EID 10555001" },
      { level: "warning", minute: 34, message: "CRM record name disagrees with the UCPath name" },
      { level: "error", minute: 35, message: "cross-verify failed: subject mismatch between CRM and UCPath" },
      { level: "error", minute: 36, message: "Run failed at cross-verify; nothing was written" },
    ]],
    [FIXTURE_IDS.openGateRun, 5, [
      { level: "info", minute: 47, message: "Searching UCPath directory for Morrow, Bea" },
      { level: "warning", minute: 48, message: "Two candidates share the name Morrow, Bea" },
      { level: "info", minute: 49, message: "identity-review gate opened for candidate selection" },
    ]],
    [FIXTURE_IDS.gateNameMismatchRun, 44, [
      { level: "info", minute: 22, message: "Searching UCPath directory for Morrow, Bea" },
      { level: "warning", minute: 23, message: "The UCPath detail displays a different name for this EID" },
      { level: "info", minute: 24, message: "identity-review gate opened; the EID must be typed" },
    ]],
    [FIXTURE_IDS.parkedRun, 6, [
      { level: "info", minute: 44, message: "Searching UCPath directory for EID 10777012" },
      { level: "info", minute: 44, message: "Subject bound: the termination page names the expected EID" },
      { level: "warning", minute: 45, message: "Save submitted; the confirmation page did not render" },
      { level: "warning", minute: 45, message: "Write fenced at generation 1; the run is parked pending proof" },
    ]],
    [FIXTURE_IDS.memberRun, 31, [
      { level: "info", minute: 29, message: "Searching UCPath directory for Alvarez, Maria" },
      { level: "info", minute: 31, message: "Active status resolved: active" },
    ]],
    [FIXTURE_IDS.groupOf13, 70, [
      { level: "info", minute: 10, message: "Fan-out planned 13 member lookups" },
      { level: "warning", minute: 13, message: "2 members failed cross-verification" },
    ]],
  ] as const satisfies readonly (readonly [string, number, readonly NoteSeed[]])[];

  const FIXTURE_LOG_SECTIONS = Object.freeze(Object.fromEntries(logSeeds.map(([runId, seed, notes]) => [
    runId,
    Object.freeze({ logs: sectionResponse({ section: "logs", payload: notePageOf(seed, notes) }) }),
  ])));

  return { FIXTURE_LOG_SECTIONS };
}
