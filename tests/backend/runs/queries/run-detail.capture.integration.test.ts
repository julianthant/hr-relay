import assert from "node:assert/strict";
import { it } from "vitest";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { RunInputStorageSchema } from "../../../../src/models/run/record.js";
import { valueFreeProtectedInput } from "../../../../src/models/write-safety/protected-input.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { RUN_INPUT } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";
import { foundationFixture,id,NOW } from "../../../support/helpers/database-foundation/fixtures.js";

async function publicDetail(secret: string, protectedValue = true) {
  const binding = { kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: id(9302) } as const;
  const input = RunInputStorageSchema.parse({ ...RUN_INPUT, raw: { emplId: secret },
    parsed: { ...RUN_INPUT.parsed, value: { ...RUN_INPUT.parsed.value, emplId: secret }, protectedBindings: protectedValue ? [binding] : [] } });
  const f = await foundationFixture({ input });
  const world = await makeWorld();
  try {
    const renamed = f.db.authority.runs.updatePresentation({ runId: f.run.envelope.runId,
      expectedVersion: f.run.version, displayName: `Result ${secret}`, now: NOW });
    assert.equal(renamed.state, "applied");
    const stored = f.db.authority.runs.get(f.run.envelope.runId);
    assert.ok(stored);
    assert.deepEqual(stored.input, input);
    assert.equal(stored.displayName, `Result ${secret}`);
    const wire = buildRunDetail({ runReader: sqliteRunReader(f.db, f.clock), stateRoot: f.root,
      timeline: f.db.authority.timelineEvents, projection: world.projection,
      authority: { ...world.authority, getRun: runId => f.db.authority.runs.get(runId) },
      descriptors: { resolve: () => undefined } }, f.run.envelope.runId);
    return { wire, privateInput: canonicalJsonStringify(stored.input),
      publicInput: valueFreeProtectedInput(stored.input.parsed.value, stored.input.parsed.protectedBindings) };
  } finally { await world.dispose(); await f.dispose(); }
}

it("withholds protected values and repeated display text while retaining exact private originals", async () => {
  const first = await publicDetail("10873698");
  assert.ok(first.privateInput.includes("10873698"));
  assert.equal(JSON.stringify(first.wire).includes("10873698"), false);
  assert.equal(JSON.stringify(first.publicInput).includes("10873698"), false);
  assert.deepEqual(first.publicInput, { mode: "search", crmCheck: true, emplId: { kind: "test-data-local", inputPath: "emplId",
    name: "personLookupCanaryEid", sourceId: id(9302) }, keepNonHdh: false, includeCrmDates: false });
});

it("public display identity and value-free fingerprint do not encode a changed protected value", async () => {
  const first = await publicDetail("10873698"), second = await publicDetail("10999999");
  assert.notEqual(first.privateInput, second.privateInput);
  assert.notEqual(sha256Hex(first.privateInput), sha256Hex(second.privateInput));
  assert.deepEqual(first.wire, second.wire);
  assert.deepEqual(first.publicInput, second.publicInput);
  assert.equal(sha256Hex(canonicalJsonStringify(first.publicInput)), sha256Hex(canonicalJsonStringify(second.publicInput)));
});

it("retains an ordinary public run display title", async () => {
  assert.equal((await publicDetail("10873698", false)).wire.header.title, "Result 10873698");
});
