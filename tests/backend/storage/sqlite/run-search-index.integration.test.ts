import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { z } from "zod";
import { TimelineEventRecordSchema } from "../../../../src/models/events/timeline.js";
import { CommandAuditRecordSchema } from "../../../../src/rules/commands/commands.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

it("refuses a missing genuine permanent successful start audit before nonmatching reads or unrelated mutation", () => {
  const h = sourceBoundHarness();
  const raw = new DatabaseSync(h.authorityPath);
  try {
    const plan = h.proposal();
    const request = h.command(plan);
    const result = h.kernel.execute(request);
    assert.equal(result.state, "applied");
    const run = h.database.authority.runs.listByWorkflow(h.descriptor.id)[0];
    assert.ok(run);
    const unrelated = h.start(h.proposal(undefined, undefined, false, "10001573"));
    const audit = raw.prepare("SELECT * FROM command_audits WHERE command_id=?").get(request.commandId);
    assert.ok(audit);
    assert.equal(typeof audit.id, "string");
    const index = raw.prepare("SELECT * FROM run_search WHERE run_id=?").get(run.envelope.runId);
    assert.ok(index);
    assert.equal(typeof index.actor_source_json, "string");
    if (typeof index.actor_source_json !== "string") throw new Error("missing frozen actor proof");
    const sources = z.array(z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("queued"), event: TimelineEventRecordSchema }),
      z.strictObject({ kind: z.literal("start-audit"), audit: CommandAuditRecordSchema }),
    ])).parse(JSON.parse(index.actor_source_json));
    assert.equal(sources.length, 2);
    assert.ok(sources.some(source => source.kind === "queued"));
    assert.ok(sources.some(source => source.kind === "start-audit" && source.audit.auditId === audit.id));
    if (typeof audit.payload_json !== "string") throw new Error("missing actual audit body");
    const actualAudit = CommandAuditRecordSchema.parse(JSON.parse(audit.payload_json));
    assert.deepEqual(actualAudit.request, request);
    assert.deepEqual(actualAudit.result, result);
    assert.deepEqual(sources.find(source => source.kind === "start-audit"), { kind: "start-audit", audit: actualAudit });
    const queuedCopy = sources.find(source => source.kind === "queued");
    if (queuedCopy?.kind !== "queued") throw new Error("missing actual queued source");
    const queued = h.database.authority.timelineEvents.get(queuedCopy.event.eventId);
    assert.ok(queued);
    assert.deepEqual(sources.find(source => source.kind === "queued"), { kind: "queued", event: queued });
    assert.equal(h.database.authority.runs.search({ q: run.envelope.runId, scope: "run", facets: {}, limit: 1 }).totalMatches, 1);
    assert.throws(() => raw.prepare("DELETE FROM command_audits WHERE id=?").run(audit.id), /retained/u);
    const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='command_audits_retained'").get();
    assert.equal(typeof trigger?.sql, "string");
    if (typeof trigger?.sql !== "string") throw new Error("missing audit retention trigger");
    raw.exec("DROP TRIGGER command_audits_retained");
    try { assert.equal(raw.prepare("DELETE FROM command_audits WHERE id=?").run(audit.id).changes, 1);
      assert.equal(raw.prepare("SELECT * FROM command_audits WHERE id=?").get(audit.id), undefined); }
    finally { raw.exec(trigger.sql); }
    const generation = h.database.getMeta().authorityGeneration;
    const bytes = [readFileSync(h.authorityPath), readFileSync(`${h.authorityPath}-wal`)];
    const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const inventory = () => tables.map(({ name }) => {
      if (typeof name !== "string" || !/^[a-z_]+$/u.test(name)) throw new Error("invalid native table name");
      return { name, rows: raw.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() };
    });
    const before = inventory();
    assert.throws(() => h.database.authority.runs.search({ q: "NONMATCH", scope: "run", facets: { actor: "nonmatching-actor" }, limit: 1 }), /run-search-index-rebuild-required/u);
    assert.throws(() => h.database.authority.runs.updatePresentation({ runId: unrelated.envelope.runId,
      expectedVersion: unrelated.version, displayName: "Must not mutate", now: h.clock.now().toISOString() }), /run-search-retained-actor-source-missing/u);
    assert.deepEqual(h.database.authority.runs.get(unrelated.envelope.runId), unrelated);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.throws(() => AuthorityDatabase.inspectExistingReadOnly(h.authorityPath), /run-search-retained-actor-source-missing/u);
    for (const openMode of ["current-runtime", "storage-doctor-read-only-no-migrate"] as const) {
      assert.throws(() => {
        const unexpected = AuthorityDatabase.open({ path: h.authorityPath, busyTimeoutMs: 250,
          migrationOwner: "permanent-start-proof", ...(openMode === "current-runtime" ? {} : { openMode }) }, h.clock);
        unexpected.close();
      }, /run-search-retained-actor-source-missing/u);
    }
    assert.deepEqual(inventory(), before);
    assert.deepEqual([readFileSync(h.authorityPath), readFileSync(`${h.authorityPath}-wal`)], bytes);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(h.world.events, []);
  } finally { raw.close(); h.dispose(); }
});
