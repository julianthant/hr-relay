import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync,readFileSync,unlinkSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { queryActivitySummaries } from "../../../../src/backend/runs/queries/run-summaries.js";
import { deriveDiagnosticContentDigest } from "../../../../src/models/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema } from "../../../../src/models/trust/diagnostic.js";
import { fixtureUuid } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { HISTORY_NOW,historyWorld } from "../../../support/helpers/storage/transaction-history-fixture.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
it("keeps authenticated transaction and Activity facts available when unrelated diagnostic bytes are missing", async () => {
  const w = await historyWorld({ terminalize: true });
  try {
    const fixture = w.commit(79, { confirmedAt: HISTORY_NOW });
    const runId = fixture.commit.transaction.runId;
    const run = w.database.authority.runs.get(runId); assert.ok(run);
    const bytes = Buffer.from("[]");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const artifactId = fixtureUuid("unrelated-diagnostic-artifact");
    const content = { runId, origin: { kind: "operator-request" as const, requestedBy: "local-operator" },
      capturedAt: HISTORY_NOW, configFingerprint: run.envelope.configFingerprint,
      descriptorFingerprint: run.envelope.contractFingerprint, redaction: { fields: [], warnings: [] },
      attachments: [{ kind: "console-summary" as const, artifactId, mediaType: "application/json" as const,
        byteLength: bytes.byteLength, digest, sensitivity: "redacted" as const }] };
    const { capturedAt, ...stored } = content;
    const bundle = DiagnosticBundleSchema.parse({ ...stored, bundleId: fixtureUuid("unrelated-diagnostic-bundle"),
      createdAt: capturedAt, contentDigest: deriveDiagnosticContentDigest(content),
      retention: { kind: "ordinary", purgeAfter: "2026-09-10T12:00:00.000Z" } });
    w.database.authority.diagnosticBundles.insert(bundle);
    const artifactRoot = join(w.root, "artifacts"); mkdirSync(artifactRoot, { recursive: true });
    const path = join(artifactRoot, `${digest}.artifact`);
    writeFileSync(path, JSON.stringify({ ref: { id: artifactId, sha256: digest, bytes: bytes.byteLength,
      mediaType: "application/json" }, payloadBase64: bytes.toString("base64") }));
    w.reopen();
    const stable = () => ({ run: w.database.authority.runs.get(runId),
      result: w.database.authority.runResults.get(runId), bundle: w.database.authority.diagnosticBundles.get(bundle.bundleId),
      intent: w.database.authority.writeIntents.get(fixture.commit.transaction.writeIntentId),
      generation: w.database.getMeta().authorityGeneration });
    const observe = () => [{ from: "2026-09-09", to: "2026-09-09" },
      { from: "2026-09-10", to: "2026-09-10" }].map(selection => ({
        transactionHistory: w.history.query(selection),
        activity: queryActivitySummaries(w.database, { ...selection, generatedAt: HISTORY_NOW },
          { ledger: w.history, descriptors: { resolve: () => undefined } }),
      }));
    const identity = stable(), before = observe();
    assert.equal(before[0]?.transactionHistory.rows.length, 1);
    assert.equal(before[1]?.transactionHistory.rows.length, 0);
    const original = readFileSync(path); assert.ok(original.includes(bytes.toString("base64")));
    unlinkSync(path);
    assert.deepEqual(stable(), identity);
    assert.deepEqual(observe(), before);
    assert.equal(hash(observe()), hash(before));
    writeFileSync(path, original);
    assert.deepEqual(readFileSync(path), original);
    assert.deepEqual(observe(), before);
    assert.deepEqual(stable(), identity);
  } finally { await w.dispose(); }
});
