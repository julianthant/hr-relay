import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { z } from "zod";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { insertMeasuredSearchRun } from "../../support/helpers/backend/cross-date-search-harness.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

function corruptRunSource(raw: DatabaseSync, sql: string, ...values: (string | number | null)[]) {
  const trigger = z.object({ sql: z.string() }).parse(raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='runs_identity'").get());
  raw.exec("DROP TRIGGER runs_identity");
  try { raw.prepare(sql).run(...values); }
  finally { raw.exec(trigger.sql); }
}

describe("cross-date search authority read", () => {

  it("refuses a strict run record whose authority order instant is foreign", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-malformed-"));
    const databasePath = join(root, "authority.db");
    const database = AuthorityDatabase.open(
      { path: databasePath, busyTimeoutMs: 1_000, migrationOwner: "search-malformed-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    const raw = new DatabaseSync(databasePath);
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 90, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const malformed = RunRecordSchema.parse({
        ...run,
        createdAt: "2026-08-28T15:01:00.000Z",
        updatedAt: "2026-08-28T15:01:00.000Z",
      });
      const { envelope, ...lifecycle } = malformed;
      corruptRunSource(raw, "UPDATE runs SET envelope_json = ?, lifecycle_json = ? WHERE id = ?",
        canonicalJsonStringify(envelope), canonicalJsonStringify(lifecycle), run.envelope.runId);

      assert.throws(
        () => database.authority.runs.search({
          q: "separations",
          scope: "workflow",
          facets: {},
          limit: 1,
        }),
        /run-search-index-rebuild-required/,
      );
    } finally {
      raw.close();
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
