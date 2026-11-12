import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { growth, measureStorageRead, STORAGE_READS, wholeStoreCheck, type StorageReadId } from "./storage-read-benchmark.js";
import { seedStorageReadFixture, type StorageReadFixture } from "./storage-read-fixture.js";
import { traceSqliteStatements } from "./sqlite-statement-counter.js";

const RUNS = 10_000;
let fixture: StorageReadFixture;

beforeAll(async () => {
  fixture = await seedStorageReadFixture(RUNS);
});

afterAll(async () => {
  await fixture.close();
});

describe("the storage read benchmark at 10,000 runs", () => {
  for (const read of Object.keys(STORAGE_READS) as StorageReadId[]) {
    it(`times ${read} with the whole-store check inside the timed read`, () => {
      const appendMs: number[] = [];
      const measured = measureStorageRead(fixture, read, 1, appendMs);
      assert.equal(appendMs.length, 1);
      assert.equal(measured.checkStatements.length, 1);
      assert.ok(measured.checkStatements[0] > RUNS, `the check prepared ${String(measured.checkStatements[0])} statements over ${String(RUNS)} runs`);
      assert.ok(measured.check.medianMs > 0 && measured.check.medianMs <= measured.total.medianMs);
    });
  }

  it("finds no check in a read that follows no commit, so a found check is the commit's", () => {
    fixture.reader.summaryWorkflows();
    const warm = traceSqliteStatements(() => fixture.reader.summaryWorkflows());
    assert.throws(() => wholeStoreCheck(warm.statements), /ran the whole-store check 0 times/u);
  });
});

describe("the growth verdict", () => {
  it("names flat, linear and worse from the log-log slope", () => {
    assert.equal(growth([{ runCount: 100, medianMs: 5 }, { runCount: 10_000, medianMs: 6 }]).verdict, "flat");
    assert.equal(growth([{ runCount: 100, medianMs: 5 }, { runCount: 10_000, medianMs: 500 }]).verdict, "linear");
    assert.equal(growth([{ runCount: 100, medianMs: 5 }, { runCount: 10_000, medianMs: 50_000 }]).verdict, "worse than linear");
  });
});
