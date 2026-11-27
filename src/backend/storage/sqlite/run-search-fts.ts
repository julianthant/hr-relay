import { deepFreeze } from "../../../rules/validation/immutability.js";

export const RUN_SEARCH_FTS_SCHEMA_VERSION = 46;

const columns = ["run_id", "trace", "workflow", "subject", "actor", "ocr_subject_terms"];
const values = (row: string) => columns.map(column => column === "actor" ? `lower(${row}.actor_id)` : `${row}.${column}`);
const differences = (indexed: readonly string[], source: readonly string[]) =>
  indexed.map((value, index) => `${value} IS NOT ${source[index]}`).join(" OR ");
const insert = (source: string) => `INSERT INTO run_search_fts(${columns.join(",")}) ${source}`;
// Match the immutable run UUID so compaction can renumber the projection's rowids independently.
const remove = `DELETE FROM run_search_fts WHERE run_search_fts MATCH ('run_id:' || json_quote(OLD.run_id))
  AND run_id=OLD.run_id`;
const insertNew = insert(`VALUES(${values("NEW").join(",")})`);

export const RUN_SEARCH_FTS_MIGRATION = deepFreeze({
  version: RUN_SEARCH_FTS_SCHEMA_VERSION,
  statements: [
    `CREATE VIRTUAL TABLE run_search_fts USING fts5(${columns.join(",")}, tokenize='trigram case_sensitive 1')`,
    "INSERT INTO run_search_fts(run_search_fts, rank) VALUES('secure-delete', 1)",
    insert(`SELECT ${values("s").join(",")} FROM run_search s`),
    `CREATE TRIGGER run_search_fts_insert AFTER INSERT ON run_search BEGIN ${insertNew}; END`,
    `CREATE TRIGGER run_search_fts_delete AFTER DELETE ON run_search BEGIN ${remove}; END`,
    `CREATE TRIGGER run_search_fts_update AFTER UPDATE ON run_search
      WHEN ${differences(values("OLD"), values("NEW"))}
      BEGIN ${remove}; ${insertNew}; END`,
  ],
});

export const RUN_SEARCH_FTS_MISMATCH_SQL = `SELECT 1 FROM run_search_fts AS f LEFT JOIN run_search AS s USING(run_id)
  WHERE ${differences(columns.map(column => `f.${column}`), values("s"))}
  UNION ALL SELECT 1 FROM run_search_fts GROUP BY run_id HAVING count(*)<>1
  UNION ALL SELECT 1 WHERE (SELECT count(*) FROM run_search_fts)<>(SELECT count(*) FROM run_search) LIMIT 1`;
