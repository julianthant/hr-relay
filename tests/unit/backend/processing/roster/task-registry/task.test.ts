import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "vitest";
import type { ContentAddressedArtifactWriter } from "../../../../../../src/workflow-kit/artifacts.js";
import { ArtifactRefSchema } from "../../../../../../src/models/artifacts/artifacts.js";
import {
  MatchSpreadsheetInputSchema,
  MatchSpreadsheetOutputSchema,
  type MatchSpreadsheetOutput,
} from "../../../../../../src/models/processing/roster/match-spreadsheet.js";
import { FingerprintSchema, IsoInstantSchema } from "../../../../../../src/rules/identity/ids.js";
import { ColumnMappingSchema, detectColumns, headerFingerprint } from "../../../../../../src/models/intake/mapping.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import { matchSpreadsheetTask } from "../../../../../../src/backend/processing/roster/task-registry.js";

const READ_AT = IsoInstantSchema.parse("2026-08-08T12:00:00.000Z");
const SUBJECT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const HEADERS = ["Employee ID#", "Employee Name"];
type TaskResult<Metadata extends object> =
  | (Readonly<{ outcome: "success"; output: MatchSpreadsheetOutput }> & Metadata)
  | (Readonly<{ outcome: "failure"; failure: Readonly<{ code: string; message: string }> }> & Metadata);

function mapping(headers: readonly string[], bindings: readonly string[] = ["eid", "fullName"]) {
  const detected = detectColumns(headers);
  return ColumnMappingSchema.parse({
    workflow: "person-lookup",
    intakeProjectionFingerprint: FingerprintSchema.parse("ab".repeat(32)),
    fingerprint: headerFingerprint(detected),
    savedAt: READ_AT,
    headerRowIndex: 0,
    columns: detected.map(({ samples: _samples, ...column }) => column),
    bindings: bindings.map((field) => {
      const canonicalFieldId = field === "eid" ? "eid" : "fullName";
      const targetFieldId = canonicalFieldId;
      const column = detected[canonicalFieldId === "eid" ? 0 : 1];
      if (column === undefined) throw new Error("fixture binding column missing");
      return {
        targetFieldId,
        canonicalFieldId,
        sourceColumnId: column.sourceColumnId,
        confirmedAt: READ_AT,
      };
    }),
  });
}

function artifactFor(bytes: Buffer) {
  return ArtifactRefSchema.parse({
    id: "11111111-2222-4333-8444-666666666666",
    sha256: sha256Hex(bytes.toString("base64")),
    bytes: bytes.byteLength,
    mediaType: "text/csv",
  });
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

async function runMatch(
  csv: string,
  subjects: readonly Record<string, unknown>[],
  rosterMapping: ReturnType<typeof mapping> = mapping(HEADERS),
): Promise<TaskResult<Readonly<{
  facts: unknown[];
  opened: unknown[];
  rosterFileRef: ReturnType<typeof ArtifactRefSchema.parse>;
}>>> {
  const bytes = Buffer.from(csv, "utf8");
  const rosterFileRef = artifactFor(bytes);
  const opened: unknown[] = [];
  const facts: unknown[] = [];
  const ctx = {
    artifacts: {
      open: (reference: unknown) => {
        opened.push(reference);
        return Promise.resolve(Readable.from([bytes]));
      },
      put: () => { throw new Error("roster matching must not write artifacts"); },
    } satisfies ContentAddressedArtifactWriter,
    fail,
    recordData: (point: unknown) => { facts.push(point); },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
  };
  try {
    const output = MatchSpreadsheetOutputSchema.parse(await matchSpreadsheetTask.impl.run({
      input: MatchSpreadsheetInputSchema.parse({
        subjects,
        rosterFileRef,
        mapping: rosterMapping,
        readAt: READ_AT,
      }),
      ctx: ctx as never,
    }));
    return { outcome: "success" as const, output, facts, opened, rosterFileRef };
  } catch (error) {
    const caught = error as Error & { code?: string };
    if (caught.code === undefined) throw error;
    return { outcome: "failure" as const, failure: { code: caught.code, message: caught.message }, facts, opened, rosterFileRef };
  }
}

describe("roster task wrapper", () => {
  it("returns the independently observable exact match and records its result fact", async () => {
    const result = await runMatch(
      "Employee ID#,Employee Name\n10800000,Avery Example\n",
      [{ subjectId: SUBJECT, eid: "10800000", name: "Avery Example" }],
    );
    if (result.outcome !== "success") throw new Error(`expected match result, received ${result.failure.code}`);
    assert.deepEqual(result.output.matches, [{
      subjectId: SUBJECT,
      matchedEid: "10800000",
      matchConfidence: 1,
      tier: "high",
      mismatch: "none",
    }]);
    assert.deepEqual(result.opened, [result.rosterFileRef]);
    assert.deepEqual(result.facts, [[
      { direction: "read", field: "matches", value: result.output.matches },
    ]]);
  });

  it("refuses a changed header mapping without recording a match", async () => {
    const changed = await runMatch(
      "Employee ID#,Employee Name\n10800000,Avery Example\n",
      [{ subjectId: SUBJECT, name: "Avery Example" }],
      mapping(["Employee Number", "Employee Name"]),
    );
    if (changed.outcome !== "failure") throw new Error("expected mapping-mismatch refusal");
    assert.equal(changed.failure.code, "mapping-mismatch");
    assert.deepEqual(changed.facts, []);
  });

  it("refuses a mapping without an EID binding and records no match", async () => {
    const noEid = await runMatch(
      "Employee ID#,Employee Name\n10800000,Avery Example\n",
      [{ subjectId: SUBJECT, name: "Avery Example" }],
      mapping(HEADERS, ["fullName"]),
    );
    if (noEid.outcome !== "failure") throw new Error("expected no-eid-column refusal");
    assert.equal(noEid.failure.code, "no-eid-column");
    assert.deepEqual(noEid.facts, []);
  });

  it("never emits an invalid roster EID after canonical cell coercion refuses it", async () => {
    const result = await runMatch(
      "Employee ID#,Employee Name\nnot-an-eid,Avery Example\n",
      [{ subjectId: SUBJECT, name: "Avery Example" }],
    );
    if (result.outcome !== "success") throw new Error(`expected no-match result, received ${result.failure.code}`);
    assert.deepEqual(result.output.matches, [{
      subjectId: SUBJECT,
      matchedEid: null,
      matchConfidence: 0,
      tier: "low",
      mismatch: "no-match",
    }]);
    assert.deepEqual(result.facts, [[
      { direction: "read", field: "matches", value: result.output.matches },
    ]]);
  });
});
