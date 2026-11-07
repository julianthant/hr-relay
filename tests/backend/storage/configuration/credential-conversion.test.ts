import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { stoppedDuoConversionRecord } from "../../../../src/backend/storage/configuration/credential-conversion.js";

const binding = { installationId: randomUUID(), profileId: randomUUID() };
const witness = { device: 1, inode: 2, digest: "a".repeat(64) };
const document = { schemaVersion: 1, ...binding, revision: 3, credentials: [], retired: [], reservations: [] };

it("preserves an explicit never-initialized predecessor and refuses an unexplained record", () => {
  const row = { state: "never-initialized" as const, profileId: binding.profileId, revision: 0 as const };
  assert.deepEqual(stoppedDuoConversionRecord(binding, row, undefined), { record: { revision: 0, value: null }, retired: [] });
  assert.throws(() => stoppedDuoConversionRecord(binding, row, document), { code: "CREDENTIAL_CONVERSION_UNSUPPORTED" });
});

it("preserves nonzero empty predecessor revision and retired membership without reviving its key", () => {
  const source = { ...document, retired: [{ credentialId: "cmV0aXJlZA", highWater: 1 }], reservations: [
    { attemptId: randomUUID(), credentialId: "cmV0aXJlZA", count: 1, reservedAt: "2026-11-01T12:00:00.000Z" }] };
  assert.deepEqual(stoppedDuoConversionRecord(binding, { state: "erased", profileId: binding.profileId, revision: 3, document: witness }, source),
    { record: { revision: 3, value: { credentials: [] } }, retired: ["cmV0aXJlZA"] });
});

for (const highWater of [0, 1]) it(`holds retained signer material even when its recorded floor is ${highWater}`, () => {
  const credentialId = "cmV0YWluZWQ", scope = { armId: randomUUID(), contextId: "a".repeat(32), tabId: 1, accountId: randomUUID(),
    origin: "https://api-fixture.duosecurity.com", rpId: "duosecurity.com", armedAt: "2026-11-01T12:00:00.000Z", expiresAt: "2026-11-01T12:10:00.000Z" };
  const source = { ...document, credentials: [{ state: "ready", credentialId, scope, privateKeyPkcs8: "AAAA", publicKeySpki: "AAAA", highWater,
    createdAt: "2026-11-01T12:00:01.000Z", confirmedAt: "2026-11-01T12:00:02.000Z" }],
    reservations: highWater === 0 ? [] : [{ attemptId: randomUUID(), credentialId, count: 1, reservedAt: "2026-11-01T12:00:03.000Z" }] };
  const before = JSON.stringify(source);
  assert.throws(() => stoppedDuoConversionRecord(binding, { state: "registered", profileId: binding.profileId, revision: 3, document: witness }, source),
    { code: "CREDENTIAL_CONVERSION_COUNTER_UNPROVED" });
  assert.equal(JSON.stringify(source), before);
});

it("refuses a source from another person before producing a converted record", () => {
  assert.throws(() => stoppedDuoConversionRecord(binding, { state: "registered", profileId: binding.profileId, revision: 3, document: witness },
    { ...document, profileId: randomUUID() }), { code: "CREDENTIAL_CONVERSION_UNSUPPORTED" });
});
