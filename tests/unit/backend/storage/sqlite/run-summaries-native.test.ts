import { FailureRecordSchema } from "../../../../../src/models/trust/failure.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../../src/backend/storage/sqlite/migrations.js";
import { createRunSummaries } from "../../../../../src/backend/storage/sqlite/run-summaries.js";
import { runRecordColumns } from "../../../../../src/backend/storage/sqlite/run-record-row.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../../support/fixtures/phase1f-run-fixtures.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  databases.push(db);
  for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
  const add = (index: number, at: string, options: { cancelRequested?: true } = {}) => {
    const row = runRecordColumns(RunRecordSchema.parse({ ...QUEUED_RUN, ...options,
      envelope: { ...QUEUED_RUN.envelope, runId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, itemId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`, enqueuedAt: at },
      createdAt: at, updatedAt: at,
    }));
    db.prepare(`INSERT INTO runs (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    return row.id;
  };
  return { db, add, summaries: createRunSummaries(db) };
}

describe("native summary snapshots", () => {
  it("derives every row without summary authority or cache tables", () => {
    const f = fixture();
    f.add(1, "2026-10-01T12:00:00.000Z");
    f.add(2, "2026-10-02T12:00:00.000Z");
    const rows = f.summaries.read(7);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.sourceGeneration === 7)).toBe(true);
    expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE '%summar%'").all()).toEqual([]);
    expect(f.summaries.workflows(7)).toEqual([QUEUED_RUN.envelope.workflow]);
  });

  it("retains filtering, stable cursors and calendar navigation across the full population", () => {
    const f = fixture();
    const first = f.add(1, "2026-10-01T12:00:00.000Z");
    const second = f.add(2, "2026-10-02T12:00:00.000Z");
    f.add(3, "2026-11-01T12:00:00.000Z");
    const query = { workflow: QUEUED_RUN.envelope.workflow, limit: 1 };
    const page = f.summaries.query(3, query);
    expect(page.items.map(row => row.runId)).toEqual([first]);
    expect(page.next).toEqual({ localDay: "2026-10-01", runId: first });
    expect(f.summaries.query(3, { ...query, after: page.next ?? undefined }).items.map(row => row.runId)).toEqual([second]);
    expect(f.summaries.query(3, { ...query, status: "failed" }).items).toEqual([]);
    const calendar = f.summaries.calendar(3, { month: "2026-10", day: "2026-10-02", today: "2026-11-02" });
    expect(calendar.monthCounts).toEqual([{ day: "2026-10-01", count: 1 }, { day: "2026-10-02", count: 1 }]);
    expect(calendar.firstDay).toBe("2026-10-01");
    expect(calendar.lastDay).toBe("2026-11-01");
    expect(calendar.previousDay).toBe("2026-10-01");
    expect(calendar.nextDay).toBe("2026-11-01");
  });

  it("selects bounded indexed runs before decoding sources and keeps calendar independent of summary materialization", () => {
    const f = fixture();
    for (let index = 1; index <= 40; index++) f.add(index, `2026-10-${String((index % 20) + 1).padStart(2, "0")}T12:00:00.000Z`);
    const expected = f.summaries.read(9);
    const prepare = f.db.prepare.bind(f.db);
    const queries: string[] = [];
    const spy = vi.spyOn(f.db, "prepare").mockImplementation(sql => {
      queries.push(sql);
      if (/SELECT \* FROM runs ORDER BY id/u.test(sql)) throw new Error("whole-population-materialization-forbidden");
      return prepare(sql);
    });
    try {
      const first = f.summaries.query(9, { workflow: QUEUED_RUN.envelope.workflow, limit: 2 });
      expect(first.items).toEqual(expected.slice(0, 2).map(row => ({ ...row, cancelRequested: false })));
      const second = f.summaries.query(9, { workflow: QUEUED_RUN.envelope.workflow, limit: 2, after: first.next ?? undefined });
      expect(second.items).toEqual(expected.slice(2, 4).map(row => ({ ...row, cancelRequested: false })));
      expect(queries.some(sql => /FROM runs INDEXED BY runs_day_idx/u.test(sql) && /LIMIT \?/u.test(sql))).toBe(true);
      queries.splice(0);
      expect(f.summaries.calendar(9, { month: "2026-10", day: "2026-10-05", today: "2026-10-21" }).monthCounts.reduce((total, row) => total + row.count, 0)).toBe(40);
      expect(queries.every(sql => !/SELECT \*/u.test(sql))).toBe(true);
      expect(queries.every(sql => !/run_search/u.test(sql))).toBe(true);
      expect(() => f.summaries.read(9)).toThrow("whole-population-materialization-forbidden");
    } finally { spy.mockRestore(); }
  });

  it("refuses ambiguous current failure sources and scalar corruption instead of selecting a last row",()=>{
    const f=fixture();const runId=f.add(1,"2026-10-01T12:00:00.000Z");
    const addFailure=(index:number,physicalCode?:string)=>{
      const failure=FailureRecordSchema.parse({failureId:`30000000-0000-4000-8000-${String(index).padStart(12,"0")}`,
        fingerprint:"a".repeat(64),runId,traceId:QUEUED_RUN.envelope.traceId,attempt:1,workflowId:QUEUED_RUN.envelope.workflow,
        code:"SUBJECT_MISMATCH",summary:"Offline identity mismatch",transient:false,writeState:"not-attempted",
        causeChain:[{code:"SUBJECT_MISMATCH",summary:"Offline identity mismatch",role:"primary",transient:false}],
        remediation:[{kind:"operator-action",message:"Review the offline evidence"}],occurredAt:"2026-10-01T12:00:00.000Z"});
      f.db.prepare("INSERT INTO run_failures(id,run_id,fingerprint,code,payload_json,resolution_json,resolution_version,created_at) VALUES(?,?,?,?,?,?,1,?)")
        .run(failure.failureId,runId,failure.fingerprint,physicalCode ?? failure.code,canonicalJsonStringify(failure),'{"status":"unresolved","version":1}',failure.occurredAt);
    };
    addFailure(1);addFailure(2);expect(()=>f.summaries.read(1)).toThrow("summary-source-ambiguous");
    const other=fixture();const otherRun=other.add(2,"2026-10-01T12:00:00.000Z");
    const failure=FailureRecordSchema.parse({failureId:"30000000-0000-4000-8000-000000000003",fingerprint:"b".repeat(64),runId:otherRun,
      traceId:QUEUED_RUN.envelope.traceId,attempt:1,workflowId:QUEUED_RUN.envelope.workflow,code:"SUBJECT_MISMATCH",summary:"Offline mismatch",transient:false,
      writeState:"not-attempted",causeChain:[{code:"SUBJECT_MISMATCH",summary:"Offline mismatch",role:"primary",transient:false}],
      remediation:[{kind:"operator-action",message:"Review offline evidence"}],occurredAt:"2026-10-01T12:00:00.000Z"});
    other.db.prepare("INSERT INTO run_failures(id,run_id,fingerprint,code,payload_json,resolution_json,resolution_version,created_at) VALUES(?,?,?,?,?,?,1,?)")
      .run(failure.failureId,otherRun,failure.fingerprint,"corrupt",canonicalJsonStringify(failure),'{"status":"unresolved","version":1}',failure.occurredAt);
    expect(()=>other.summaries.read(1)).toThrow(/row-code-mismatch/u);
  });

  it("rejects a source whose physical run scalar disagrees with its JSON", () => {
    const f = fixture();
    const row = { ...runRecordColumns(RunRecordSchema.parse(QUEUED_RUN)), trace_id: "corrupt" };
    f.db.prepare(`INSERT INTO runs (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    expect(() => f.summaries.read(1)).toThrow(/trace_id/u);
  });
});
