import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { foundationFixture, admission, id } from "./fixtures.js";
import { createGenericProviderAccounting, inspectGenericProviderAccounting } from "../../../src/infra/sqlite/provider-accounting.js";
import { AuthorityDatabase, AuthorityDatabaseOpenModeSchema, inspectHistoricalAuthorityInvariants } from "../../../src/infra/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../src/infra/compat/backup-inspection.js";
import { SQLITE_MIGRATIONS } from "../../../src/infra/sqlite/migrations.js";

const boundaries = [...AuthorityDatabaseOpenModeSchema.options, "backup-inspection", "historical-invariants"] as const;
for (const boundary of boundaries) for (const corruption of ["none", "reserved-counter", "allocation-window"] as const) {
  it(`validates generic ${corruption} at ${boundary}`, () => {
    const f = foundationFixture();
    try {
      const input = admission(f, 800);
      const request = { ...input, budgets: input.budgets.map(b => ({ ...b,
        windows: b.windows.map(w => ({ ...w, limit: { ...w.limit, value: 1 } })),
      })) };
      assert.equal(createGenericProviderAccounting(f.db.authority.providerAccounting).reserve(request).state, "reserved");
      const generation = f.db.getMeta().authorityGeneration;
      f.db.close();
      const raw = new DatabaseSync(f.path);
      try {
        inspectGenericProviderAccounting(raw);
        if (corruption === "reserved-counter") raw.exec("UPDATE provider_usage SET record_json=json_set(record_json,'$.windows[0].reserved',0) WHERE json_extract(record_json,'$.kind')='generic'");
        if (corruption === "allocation-window") raw.exec("UPDATE provider_usage SET record_json=json_set(record_json,'$.windows[0].id','different-window') WHERE json_extract(record_json,'$.kind')='generic'");
        assert.equal(raw.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
        assert.equal(raw.prepare("PRAGMA foreign_key_check").all().length, 0);
        if (corruption !== "none") assert.throws(() => inspectGenericProviderAccounting(raw), /provider-generic-(?:reservation|allocation)-mismatch/u);
      } finally { raw.close(); }
      const before = readFileSync(f.path);
      const inspect = () => {
        if (boundary === "backup-inspection") { inspectAuthorityBackupReadOnly(f.path); return; }
        if (boundary === "historical-invariants") {
          const source = new DatabaseSync(f.path, { readOnly: true });
          try { for (const version of [46, 47, 48, 49]) {
            const historical = new DatabaseSync(":memory:");
            try {
              for (const migration of SQLITE_MIGRATIONS.filter(m => m.version <= version)) for (const sql of migration.statements) historical.exec(sql);
              for (const table of ["settings_snapshots", "workflow_runs", "workflow_workers", "provider_usage", "provider_requests"]) {
                for (const row of source.prepare(`SELECT * FROM ${table}`).all()) {
                  const columns = historical.prepare(`PRAGMA table_info(${table})`).all().map(c => String(c.name)).filter(c => Object.hasOwn(row, c));
                  historical.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map(c => row[c]));
                }
              }
              inspectHistoricalAuthorityInvariants(historical, version);
            } finally { historical.close(); }
          } } finally { source.close(); }
          return;
        }
        const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "provider-integrity-test", openMode: boundary }, f.clock);
        try {
          assert.equal(db.getMeta().authorityGeneration, generation);
          if (boundary === "read-write") assert.equal(createGenericProviderAccounting(db.authority.providerAccounting).reserve({ ...request, requestId: id(801) }).state, "denied");
        } finally { db.close(); }
      };
      if (corruption === "none") inspect();
      else { assert.throws(inspect, /provider-generic-(?:reservation|allocation)-mismatch/u); assert.deepEqual(readFileSync(f.path), before); }
    } finally { f.dispose(); }
  });
}
