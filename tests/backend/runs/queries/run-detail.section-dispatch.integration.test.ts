import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { SectionUnavailableError } from "../../../../src/backend/runs/commands/refusals.js";
import { buildRunSection, readRunSection, type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { queuedEventOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const {world, cleanup } = createRunDetailTestWorld();

afterEach(cleanup);

function depsOf(current: DashboardWorld): RunDetailQueryDeps {
  return {
    runReader: current.runReader, timeline: current.timeline,
    stateRoot: current.stateRoot,
    projection: current.projection,
    authority: current.authority,
    descriptors: { resolve: () => undefined },
  };
}

describe("run-detail section registration", () => {
  it("routes the served logs and Context/Data arms through the live dispatcher", async () => {
    const current = await world();
    queuedEventOf(current, { seed: 1 });
    const deps = depsOf(current);

    const logs = buildRunSection(deps, uuidOf(1), "logs");
    const data = buildRunSection(deps, uuidOf(1), "context-data");
    const attempts = buildRunSection(deps, uuidOf(1), "context-attempts");
    const receipt = buildRunSection(deps, uuidOf(1), "receipt");
    const failure = buildRunSection(deps, uuidOf(1), "failure");

    assert.equal(logs.section, "logs");
    assert.equal(data.section, "context-data");
    assert.equal(attempts.section, "context-attempts");
    assert.equal(receipt.section, "receipt");
    assert.equal(receipt.payload.state, "missing");
    assert.equal(failure.section, "failure");
    assert.equal(failure.payload.state, "missing");
  });

  it("refuses a reader that returns authority for a different run", async () => {
    const current = await world();
    queuedEventOf(current, { seed: 1 });
    const deps = depsOf(current);
    const runReader = {
      ...current.runReader,
      read(runId: string) {
        const result = current.runReader.read(runId);
        if (result.state !== "present") return result;
        return {
          ...result,
          run: { ...result.run, envelope: { ...result.run.envelope, runId: RunIdSchema.parse(uuidOf(2)) } },
        };
      },
    };

    await assert.rejects(
      readRunSection({ ...deps, runReader }, uuidOf(1), "logs"),
      /TRUST_RUN_IDENTITY_MISMATCH/u,
    );
  });

  it("pages bounded Logs responses through readRunSection", async () => {
    const current = await world();
    queuedEventOf(current, { seed: 1 });
    const notes = createNoteTimelineWriter({ repository: current.timeline, clock: current.clock, pid: 4242 });
    for (let index = 0; index < 201; index += 1) {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(1), attempt: 1, traceId: "pl-100001-0001", spanPath: "pl-100001-0001" },
        level: "step",
        message: `note ${String(index)}`,
      });
    }

    const deps = depsOf(current);
    const first = await readRunSection(deps, uuidOf(1), "logs");
    assert.equal(first.section, "logs");
    if (first.section !== "logs") throw new Error("expected Logs page");
    const firstRows = first.payload.rows;
    assert.ok(firstRows, "expected bounded Logs rows");
    assert.equal(firstRows.length, 200);
    assert.equal(first.payload.nextCursor.state, "present");
    if (first.payload.nextCursor.state !== "present") throw new Error("expected a continuation cursor");

    const second = await readRunSection(deps, uuidOf(1), "logs", first.payload.nextCursor.value);
    assert.equal(second.section, "logs");
    if (second.section !== "logs") throw new Error("expected Logs page");
    const secondRows = second.payload.rows;
    assert.ok(secondRows, "expected continuation Logs rows");
    assert.equal(secondRows.length, 1);
    assert.equal(second.payload.notes[0]?.message, "note 200");
    assert.deepEqual(second.payload.nextCursor, { state: "absent", reason: "end-of-page" });
  });

  it("admits run identity before refusing a declared but unserved arm", async () => {
    const current = await world();
    queuedEventOf(current, { seed: 1 });
    const deps = depsOf(current);

    assert.throws(
      () => buildRunSection(deps, uuidOf(1), "context-evidence"),
      SectionUnavailableError,
    );
    assert.throws(
      () => buildRunSection(deps, uuidOf(2), "context-evidence"),
      /absent from canonical authority/u,
    );
    assert.throws(
      () => buildRunSection(deps, uuidOf(1), "unknown"),
      /Invalid option/u,
    );
  });

  it("keeps capture sections on the verified asynchronous read path", async () => {
    const current = await world();
    queuedEventOf(current, { seed: 1 });
    await assert.rejects(
      readRunSection(depsOf(current), uuidOf(1), "captures"),
      SectionUnavailableError,
    );
  });
});
