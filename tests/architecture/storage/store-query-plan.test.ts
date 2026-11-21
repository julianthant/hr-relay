import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { QUERY_INDEXES } from "../../../src/backend/storage/sqlite/migrations.js";
import { auditPlans, auditStoreQueryPlans, WHOLE_TABLE_READS, type PlanAudit } from "./helpers/query-plan-audit.js";

const probe = (statements: readonly string[]) => new Map(statements.map(sql => [sql, new Set(["probe"])]));

describe("store query plans", () => {
  let audit: PlanAudit;
  beforeAll(async () => { audit = await auditStoreQueryPlans(); }, 120_000);

  it("plans the store's literal statements and the statements traced from the dashboard and a worker", () => {
    expect(audit.planned.length).toBeGreaterThan(150);
    const traced = new Set(audit.planned.flatMap(statement => statement.sources.filter(source => source.startsWith("traced: "))));
    expect([...traced].some(source => source.startsWith("traced: dashboard"))).toBe(true);
    expect([...traced].some(source => source.startsWith("traced: worker"))).toBe(true);
  });

  it("plans every collected statement that names a listed table", () => {
    expect(audit.unexplained.map(entry => `${entry.sources.join(", ")}: ${entry.error}`)).toEqual([]);
  });

  it("reads no listed table by a scan that no index or limit bounds", () => {
    expect(audit.scans.map(scan => `${scan.table}: ${scan.plan} <- ${scan.sql.slice(0, 160)} (${scan.sources.join(", ")})`)).toEqual([]);
  });

  it("keeps a reason only for whole-table reads that are still collected", () => {
    const planned = new Set(audit.planned.map(statement => statement.sql));
    expect(Object.keys(WHOLE_TABLE_READS).filter(sql => !planned.has(sql))).toEqual([]);
  });

  it("uses every index the query index migration adds", () => {
    const unused = Object.keys(QUERY_INDEXES).filter(name =>
      !audit.planned.some(statement => statement.plan.some(line => new RegExp(` USING (?:COVERING )?INDEX ${name}\\b`, "u").test(line))));
    expect(unused).toEqual([]);
  });

  it("replays checkpoints through the table's unique key", () => {
    const replays = audit.planned.filter(statement => /FROM run_checkpoints WHERE workflow ?= ?\? AND item_id ?= ?\?/u.test(statement.sql));
    expect(replays.length).toBeGreaterThan(0);
    for (const replay of replays) expect(replay.plan.join("\n")).toMatch(/SEARCH run_checkpoints USING (?:COVERING )?INDEX sqlite_autoindex_run_checkpoints_\d/u);
  });
});

describe("the plan audit", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE runs(id TEXT PRIMARY KEY, batch_id TEXT, created_at TEXT);
    CREATE TABLE run_batches(id TEXT PRIMARY KEY);
    CREATE TRIGGER run_batches_guard BEFORE INSERT ON run_batches WHEN EXISTS(SELECT 1 FROM runs WHERE batch_id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'guard'); END`);

  it("fails on an unbounded scan of a listed table", () => {
    expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=?"])).scans.map(scan => scan.plan)).toEqual(["SCAN runs"]);
  });

  it("fails when a sort runs before the limit", () => {
    expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=? ORDER BY created_at LIMIT 1"])).scans).toHaveLength(1);
  });

  it("fails when an aggregate, grouping or DISTINCT reads every row before the limit", () => {
    for (const sql of ["SELECT sum(created_at) FROM runs LIMIT 1", "SELECT count(*) FROM runs WHERE batch_id=? LIMIT 1",
      "SELECT batch_id FROM runs GROUP BY batch_id LIMIT 1", "SELECT DISTINCT batch_id FROM runs LIMIT 1"]) {
      expect(auditPlans(database, probe([sql])).scans.map(scan => scan.sql)).toEqual([sql]);
    }
  });

  it("fails an outer scan when only a subquery or one arm of a compound has the limit", () => {
    for (const sql of ["SELECT * FROM runs WHERE batch_id IN (SELECT id FROM run_batches LIMIT 1)",
      "SELECT * FROM runs WHERE created_at > (SELECT created_at FROM runs LIMIT 1)",
      "SELECT id FROM run_batches UNION ALL SELECT id FROM runs WHERE batch_id=? LIMIT 1"]) {
      expect(auditPlans(database, probe([sql])).scans.map(scan => scan.table)).toContain("runs");
    }
  });

  it("fails when the statement has no finite limit clause", () => {
    for (const sql of ["SELECT * FROM runs LIMIT -1", "SELECT * FROM runs WHERE batch_id='LIMIT 1'", "SELECT * FROM runs WHERE batch_id=? LIMIT -1 OFFSET 2",
      "SELECT * FROM runs WHERE batch_id=') LIMIT 1 --' AND created_at IN ('a', 'b')"]) {
      expect(auditPlans(database, probe([sql])).scans.map(scan => scan.sql)).toEqual([sql]);
    }
  });

  it("passes a scan a bound parameter limits", () => {
    expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=? LIMIT ?", "SELECT * FROM runs WHERE batch_id='x' LIMIT 500 OFFSET ?"])).scans).toEqual([]);
  });

  it("passes a scan the limit stops and a scan inside a trigger body", () => {
    expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=? LIMIT 1", "INSERT INTO run_batches(id) VALUES(?)"])).scans).toEqual([]);
  });

  it("passes a walk of a partial index, which holds only its working set", () => {
    database.exec("CREATE INDEX runs_open_batch_idx ON runs(created_at) WHERE batch_id IS NULL");
    try {
      expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id IS NULL ORDER BY created_at"])).scans).toEqual([]);
    } finally {
      database.exec("DROP INDEX runs_open_batch_idx");
    }
  });

  it("passes a search through an index", () => {
    database.exec("CREATE INDEX runs_batch_idx ON runs(batch_id)");
    try {
      expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=?"])).scans).toEqual([]);
    } finally {
      database.exec("DROP INDEX runs_batch_idx");
    }
  });
});
