import assert from "node:assert/strict";
import { dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthoritySourceClosureUnprovedError, hasUnprovedSourceClosure } from "../../../src/backend/storage/source-closure.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { withActiveAuthorityObservation, withAuthorityDatabaseReadOnly } from "../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { systemClock } from "../../../src/rules/time/clock.js";

function isDatabaseClose(value: unknown): value is DatabaseSync["close"] {
  return typeof value === "function";
}

const entry = process.argv[1];

if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const port = z.coerce.number().int().positive().parse(process.argv[2]);
  const workspace = z.string().min(1).parse(process.argv[3]);
  const profileId = z.string().min(1).parse(process.argv[4]);
  const path = z.string().min(1).parse(process.argv[5]);
  if (process.send === undefined) throw new Error("owner-image close retention requires ipc");
  const send = process.send.bind(process);
  try {
    const lifetime = await WorkerRuntimeLifetimeLock.receive(port, () => { process.exit(91); });
    const machine = acquireSharedRuntimeAdmission(workspace, lifetime);
    const admission = machine.admitProfile(profileId);
    const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "owner-image-close-retention" },
      systemClock, undefined, undefined, undefined, credentials);
    const cleanup = new Error("owner-image-reader-close-refused");
    const closeValue: unknown = Object.getOwnPropertyDescriptors(DatabaseSync.prototype).close?.value;
    if (!isDatabaseClose(closeValue)) throw new Error("database-close-missing");
    const close = closeValue;
    const owner: { database?: DatabaseSync } = {};
    let directory: string | undefined;
    DatabaseSync.prototype.close = function closePinnedReader(this: DatabaseSync) {
      const location = this.location();
      if (location?.endsWith(`${sep}authority.sqlite`) === true) {
        directory = dirname(location);
        owner.database = this;
        throw cleanup;
      }
      close.call(this);
    };
    let failure: unknown;
    try {
      await withActiveAuthorityObservation(path, database, async () => {
        withAuthorityDatabaseReadOnly(admission, path, () => 1);
      });
    } catch (error) { failure = error; }
    finally { DatabaseSync.prototype.close = close; }
    assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
    assert.equal(hasUnprovedSourceClosure(failure), true);
    const reader = owner.database;
    assert.ok(reader);
    assert.equal(reader.prepare("SELECT 1 AS live").get()?.live, 1);
    assert.ok(directory);
    let releaseFailure: unknown;
    try { admission.release(); } catch (error) { releaseFailure = error; }
    assert.equal(hasUnprovedSourceClosure(releaseFailure), true);
    send({ type: "proved", directory }, () => { setInterval(() => {}, 1000); });
  } catch (error) {
    const message = error instanceof Error ? error.message : "owner-image-close-retention-failed";
    send({ type: "failed", message }, () => { process.exit(1); });
  }
}
