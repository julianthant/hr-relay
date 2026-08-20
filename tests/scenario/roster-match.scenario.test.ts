/**
 * Executable scenarios for `roster/match-spreadsheet` (ref data-intake-and-edit-data §4).
 *
 * These run the REAL task implementation against real CSV bytes through the
 * recording artifact seam, with a real operator mapping built by the same
 * `detectColumns`/`headerFingerprint` pair the task itself applies. They are
 * the matcher's behaviour contract:
 *
 * - `exact-eid` — the subject's EID is in the roster and the names agree.
 * - `name-only` — no EID claimed; an exact name resolves one.
 * - `ambiguous` — two roster people tie at the top score; nobody guesses.
 * - `name-eid-conflict` — the EID is found but the roster says a different
 *   person; the match is REFUSED, never partially trusted.
 * - `no-match` — nothing reaches the accept floor; `matchedEid` stays null
 *   and the caller falls through to person-lookup, never a fabricated EID.
 */
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ContentAddressedArtifactWriter } from "../../src/base/artifacts.js";
import { ArtifactRefSchema } from "../../src/domain/artifacts.js";
import { FingerprintSchema, IsoInstantSchema, ItemIdSchema } from "../../src/domain/ids.js";
import { ColumnMappingSchema, detectColumns, headerFingerprint } from "../../src/domain/intake/mapping.js";
import { MatchSpreadsheetInputSchema } from "../../src/domain/contracts/roster/match-spreadsheet.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { matchSpreadsheetTask } from "../../src/stores/roster/index.js";

const CSV_MEDIA_TYPE = "text/csv";
const READ_AT = IsoInstantSchema.parse("2026-08-08T12:00:00.000Z");
const SUBJECT_A = ItemIdSchema.parse("7c9e6679-7425-40de-944b-e07fc1f90ae7");
const SUBJECT_B = ItemIdSchema.parse("9b2f1c34-6c1d-4f8e-8a3b-2d5e7f901234");

const ROSTER_CSV = [
  "Employee ID#,Employee Name",
  '10456712,"Battistessa, Johnnie"',
  '10998801,"Blirea, Glaundi"',
  '10777771,"Doe, John"',
  '10777772,"Doe, John"',
].join("\n");

function rosterMapping() {
  const detected = detectColumns(["Employee ID#", "Employee Name"]);
  const [eidColumn, nameColumn] = detected;
  if (eidColumn === undefined || nameColumn === undefined) throw new Error("fixture columns missing");
  return ColumnMappingSchema.parse({
    workflow: "person-lookup",
    intakeProjectionFingerprint: FingerprintSchema.parse("ab".repeat(32)),
    fingerprint: headerFingerprint(detected),
    savedAt: READ_AT,
    headerRowIndex: 0,
    // The stored mapping snapshot omits the preview `samples` field.
    columns: detected.map(({ samples: _samples, ...column }) => column),
    bindings: [
      {
        targetFieldId: "eid",
        canonicalFieldId: "eid",
        sourceColumnId: eidColumn.sourceColumnId,
        confirmedAt: READ_AT,
      },
      {
        targetFieldId: "fullName",
        canonicalFieldId: "fullName",
        sourceColumnId: nameColumn.sourceColumnId,
        confirmedAt: READ_AT,
      },
    ],
  });
}

function artifactFor(bytes: Buffer, mediaType: string) {
  return ArtifactRefSchema.parse({
    id: "11111111-2222-4333-8444-666666666666",
    sha256: sha256Hex(bytes.toString("base64")),
    bytes: bytes.byteLength,
    mediaType,
  });
}

/** A reading seam over exactly these bytes; `put` is never reached by a read. */
function artifactReader(bytes: Buffer): ContentAddressedArtifactWriter {
  return {
    put: () => { throw new Error("a match task must not write an artifact"); },
    open: () => Promise.resolve(Readable.from([bytes])),
  };
}

interface RecordedFact {
  readonly direction: string;
  readonly field: string;
  readonly value: unknown;
}

async function runMatch(subjects: readonly Record<string, unknown>[]) {
  const bytes = Buffer.from(ROSTER_CSV, "utf8");
  const recorded: RecordedFact[] = [];
  const ctx = {
    artifacts: artifactReader(bytes),
    recordData: (facts: readonly RecordedFact[]) => { recorded.push(...facts); },
    fail: (code: string, message: string) => { throw new Error(`[roster/match-spreadsheet] ${code}: ${message}`); },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
  };
  const output = await matchSpreadsheetTask.impl.run({
    input: MatchSpreadsheetInputSchema.parse({
      subjects,
      rosterFileRef: artifactFor(bytes, CSV_MEDIA_TYPE),
      mapping: rosterMapping(),
      readAt: READ_AT,
    }),
    // The scenario drives the real impl through the real contract; only the
    // ambient seams (artifact bytes, provenance sink, logger) are supplied.
    ctx: ctx as never,
  });
  return { output, recorded };
}

describe("roster/match-spreadsheet scenarios", () => {
  it("roster/match/exact-eid — a claimed EID the roster confirms, names agreeing", async () => {
    const { output, recorded } = await runMatch([
      { subjectId: SUBJECT_A, eid: "10456712", name: "Johnnie Battistessa" },
    ]);
    assert.deepEqual(output.matches, [{
      subjectId: SUBJECT_A,
      matchedEid: "10456712",
      matchConfidence: 1,
      tier: "high",
      mismatch: "none",
    }]);
    assert.equal(recorded.some((fact) => fact.field === "matches"), true);
  });

  it("roster/match/name-only — no EID claimed, an exact name resolves one", async () => {
    const { output } = await runMatch([{ subjectId: SUBJECT_A, name: "Glaundi Blirea" }]);
    assert.deepEqual(output.matches, [{
      subjectId: SUBJECT_A,
      matchedEid: "10998801",
      matchConfidence: 1,
      tier: "high",
      mismatch: "none",
    }]);
  });

  it("roster/match/ambiguous — two people tie at the top score, nobody guesses", async () => {
    const { output } = await runMatch([{ subjectId: SUBJECT_A, name: "John Doe" }]);
    const [match] = output.matches;
    assert.ok(match !== undefined);
    assert.equal(match.matchedEid, null);
    assert.equal(match.mismatch, "ambiguous");
    assert.equal(match.matchConfidence, 1);
  });

  it("roster/match/name-eid-conflict — a found EID with a different person's name is refused", async () => {
    const { output } = await runMatch([
      { subjectId: SUBJECT_A, eid: "10456712", name: "Rick Roe" },
    ]);
    assert.deepEqual(output.matches, [{
      subjectId: SUBJECT_A,
      matchedEid: null,
      matchConfidence: 0,
      tier: "low",
      mismatch: "name-eid-conflict",
    }]);
  });

  it("roster/match/no-match — nothing reaches the floor; null EID, never a fabricated one", async () => {
    const { output } = await runMatch([
      { subjectId: SUBJECT_A, name: "Zebulon Highwater" },
      { subjectId: SUBJECT_B, name: "Nguyen, Thhi" },
    ]);
    const [nothing, nearMiss] = output.matches;
    assert.deepEqual(nothing, {
      subjectId: SUBJECT_A,
      matchedEid: null,
      matchConfidence: 0,
      tier: "low",
      mismatch: "no-match",
    });
    // The near miss reports its honest 0.7 fuzzy score below the 0.85 floor.
    assert.ok(nearMiss !== undefined);
    assert.equal(nearMiss.matchedEid, null);
    assert.equal(nearMiss.mismatch, "no-match");
    assert.equal(nearMiss.matchConfidence, 0.7);
  });
});
