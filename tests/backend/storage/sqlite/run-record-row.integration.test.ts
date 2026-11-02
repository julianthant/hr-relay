import { DatabaseSync } from "node:sqlite";
import { expect,it } from "vitest";
import { runRecordColumns,runRecordFromRow,transitionRunRecord,updateRunRecord } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { LATER } from "../../../support/fixtures/phase1c-contract-fixtures.js";

it("updates a serializable transitioned row through the existing version fence", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const current = RunRecordSchema.parse(QUEUED_RUN), columns = runRecordColumns(current), entries = Object.entries(columns);
    database.exec(`CREATE TABLE runs (${entries.map(([key]) => `${key}`).join(",")})`);
    database.prepare(`INSERT INTO runs (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
      .run(...entries.map(([, value]) => value));
    const updated = transitionRunRecord(current, RunRecordSchema.parse({ ...current, displayName: "Renamed run" }), LATER);
    expect(updateRunRecord(database, updated)).toBe(1);
    expect(runRecordFromRow(database.prepare("SELECT * FROM runs").get())).toEqual(updated);
    expect(() => updateRunRecord(database, updated)).toThrow("run-version-fence-lost");
  } finally { database.close(); }
});
