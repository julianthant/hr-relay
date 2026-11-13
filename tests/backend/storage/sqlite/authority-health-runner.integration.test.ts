import { join } from "node:path";
import { createCredentialDoctorWriter } from "../../../support/helpers/credential-doctor-fixtures.js";
import { createCredentialDoctorFixtures } from "../../../support/helpers/credential-doctor-fixtures.js";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";


import { isDeepStrictEqual } from "node:util";
import { afterEach,describe,it } from "vitest";



import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { ProtectedSettingsNameSchema } from "../../../../src/models/config/protected-settings.js";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
});

const { fixture, snapshot } = createCredentialDoctorFixtures(cleanups);

const writeCredentials = createCredentialDoctorWriter(COMMAND_ID, WRITE_ID);
const CONTEXT = { signal: new AbortController().signal, timeoutMs: 10_000, deadlineMonotonicMs: 10_000, redaction: "presence-only" as const };



describe("credential presence doctor", () => {

  it("reports the same presence facts through authority.health and fails unreadable closed", async () => {
    const f = await fixture();
    writeCredentials(f, { ucpathUserId: { set: "Protected Doctor Canary" } });
    const runner = new AuthorityHealthPreflightRunner(f.admission,f.options, undefined, f.credentialStore);
    const context = {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      deadlineMonotonicMs: 10_000,
      redaction: "presence-only" as const,
    };
    const before = snapshot(f.machineRoot), controlBefore = snapshot(join(f.workspace, ".tracker", "control"));
    const observation = await runner.run(context);
    assert.ok(isDeepStrictEqual(snapshot(f.machineRoot), before), "preflight changed source inventory or bytes");
    assert.ok(isDeepStrictEqual(snapshot(join(f.workspace, ".tracker", "control")), controlBefore), "preflight changed control bytes");
    for (const name of ProtectedSettingsNameSchema.options) {
      assert.ok(observation.summary.includes(
        `${name}=${name === "ucpathUserId" ? "present" : "absent"}`,
      ));
    }
    assert.equal(observation.summary.includes("Protected Doctor Canary"), false);

    chmodSync(f.credentialPath, 0o644);
    const unavailable = await runner.run(context);
    assert.equal(unavailable.state, "unhealthy");
    assert.ok(unavailable.summary.includes("could not be verified read-only"));
    assert.equal(unavailable.summary.includes(f.root), false);
  });
});

describe("authority.health readiness pass", () => {
  it("does not verify retained backups", async () => {
    const f = await fixture();
    const backups = await new AuthorityBackupService(f.admission, f.database, { directory: f.options.backupDirectory })
      .request({ trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration });
    const manifest = backups.manifests[0];
    assert.ok(manifest !== undefined);
    appendFileSync(join(f.options.backupDirectory, manifest.backupFileName), "tampered");

    const observation = await new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore).run(CONTEXT);

    assert.equal(observation.state, "healthy");
    assert.doesNotMatch(observation.summary, /backup/i);
  });

  it("does not decode workbook payloads that the full doctor still rejects", async () => {
    const f = await fixture();
    const created = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: f.database.authority.workbooks, clock: systemClock })
      .create({ name: "Roster.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "People", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: "EID" }] }] }] });
    const raw = new DatabaseSync(f.options.authorityPath, { timeout: 1_000 });
    try { raw.prepare("UPDATE workbook_library SET payload_json='{}' WHERE id=?").run(created.libraryId); } finally { raw.close(); }

    const observation = await new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore).run(CONTEXT);
    const full = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore);

    assert.equal(observation.state, "healthy", observation.summary);
    assert.equal(full.authority.state, "degraded");
  });
});
