import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ArchivedRunSectionsSchema } from "../../../../../src/domain/archive/sections.js";
import { archivedSectionsForOperator } from "../../../../../src/backend/runs/dashboard/queries/archive.js";

describe("older frozen observed logs", () => {
  it("projects recorded fields into archived Run data and leaves action notes in Logs", () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    const note = { noteId: "e1b8ae3e-0000-4000-8000-000000000001", runId, sequence: 0,
      at: "2026-09-22T17:00:00.000Z", level: "info", message: "Opened Kuali action list" };
    const observed = { kind: "observed", logId: "e1b8ae3e-0000-4000-8000-000000000002", sequence: 1,
      at: note.at, attempt: 1, traceId: "pl-100000-e1b8", spanPath: "pl-100000-e1b8/read#1.1",
      producer: { nodeId: "read", step: "Read document", taskId: "kuali/read-document", system: "kuali" },
      points: [{ direction: "read", field: "documentNumber", values: [{ key: "documentNumber",
        state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "4684" }] }],
    };
    const sections = ArchivedRunSectionsSchema.parse({
      logs: { state: "present", value: { runId, rows: [
        { kind: "note", logId: note.noteId, sequence: note.sequence, note }, observed,
      ], notes: [note], nextCursor: { state: "absent", reason: "end-of-page" } } },
      data: { state: "present", value: { runId, state: "archived", entries: [] } },
      people: { state: "absent", reason: "no group" },
      attempts: { state: "absent", reason: "no history" },
      captures: { state: "absent", reason: "none" },
    });
    const projected = archivedSectionsForOperator(sections, 6);
    assert.equal(projected.logs.state, "present");
    assert.deepEqual(projected.logs.value.rows?.map((row) => row.kind), ["note"]);
    assert.equal(projected.data.state, "present");
    assert.deepEqual(projected.data.value.observations?.map((row) => row.logId), [observed.logId]);
  });
});
