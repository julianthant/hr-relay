import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { captureSelectedProfileStorage } from "../../../src/backend/app/composition/storage-compose.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { reconcileStartupCrash } from "../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const [workspace, port, now] = z.tuple([z.string().min(1), z.coerce.number().int().positive(), z.iso.datetime()]).parse(process.argv.slice(2));
const lock = await RuntimeLifetimeLock.acquire(port), machine = acquireEntrypointAdmission(workspace, "shared");
const selected = captureSelectedProfileStorage(machine), admission = machine.admitProfile(machine.issueRegisteredProfileClaim(selected.profileId));
const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
  erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${selected.profileId}.json`) });
const clock = manualClock(new Date(now));
const database = AuthorityDatabase.open(admission, { path: selected.authorityPath, busyTimeoutMs: 5000, migrationOwner: "verification-crash-test" },
  clock, undefined, undefined, undefined, credentials);
const lifecycle = new RunRecordService({ database, clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("unrequested-enqueue"); } });
reconcileStartupCrash({ machine, admission, database, lifecycle, clock, lock });
const slot = database.admitVerificationWorker({ ...admission.profileBinding, lockPort: lock.port, commandId: randomUUID(),
  workflow: "person-lookup", expectedPoolVersion: database.authority.workerPools.get("person-lookup")?.version ?? 0,
  profileRunId: randomUUID(), system: "ucpath", credentialKey: "ab".repeat(32), leaseGeneration: 1, now }, lock);
lock.assertHeld();
if (database.authority.workerLeases.get(slot.workerId) !== undefined) throw new Error("unexpected-worker-lease");
process.send?.({ workerId: slot.workerId, revision: slot.membershipRevision });
