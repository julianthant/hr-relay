import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualClock } from "../../../src/domain/clock.js";
import { admitLocalEnvironmentFile } from "../../../src/domain/secrets.js";
import { createProviderKeyStore } from "../../../src/infra/config/provider-key-store.js";
import { RuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { createProviderKeyJournal } from "../../../src/server/dashboard/commands/provider-key-journal.js";
import { providerMarkedFingerprint } from "../../../src/server/dashboard/commands/provider-key-projection.js";
import { fixtureSettingsDocument } from "./fixture-settings.js";

/** Known empty provider store, projected by the production Settings fold. */
export function fixtureProviderSettings() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "skeleton-settings-"));
  const admission = RuntimeAdmission.syntheticRoots(root, join(root, "artifacts"));
  const database = AuthorityDatabase.open(admission, { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "skeleton-ui" }, manualClock(new Date("2026-08-03T09:00:00Z")));
  const envPath = join(root, ".env.providers");
  writeFileSync(envPath, "", { mode: 0o600 });
  const environment: NodeJS.ProcessEnv = {};
  const providerBoot = admitLocalEnvironmentFile(envPath, environment);
  const providerKeys = createProviderKeyStore({ admission, envPath, journal: createProviderKeyJournal(database), markedFingerprint: providerMarkedFingerprint });
  const document = fixtureSettingsDocument({}, 1, undefined, { providerKeys, providerBoot, activeProviderSlots: {} });
  return { document, close() { database.close(); admission.release(); rmSync(root, { recursive: true, force: true }); } };
}
