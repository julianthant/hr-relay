import { join } from "node:path";
import { AuthorityDatabase } from "./backend/storage/sqlite/authority-database.js";
import { createTransactionHistory } from "./backend/storage/sqlite/transaction-history.js";
import { exportTransactions, parseTransactionExportArgs, TRANSACTION_EXPORT_HELP } from "./backend/storage/maintenance/transaction-export.js";
import { fileURLToPath } from "node:url";
import { rebuildRuntimeIsolation } from "./backend/app/config/runtime-isolation.js";
import {
  registerDashboardComposer,
  registerExplainComposer,
  registerOcrComposer,
  registerStorageComposer,
  registerTestDataComposer,
  registerWorkerComposer,
  startRebuildRuntime,
} from "./backend/app/composition/runtime-composition.js";
import { composeDashboardRuntime } from "./backend/app/composition/dashboard/compose.js";
import { listDryRunScenarioWorkflows, loadDryRunScenarioManifest } from "./backend/app/dry-run/manifests.js";
import { parseDryRunScenarioManifest } from "./models/trust/dry-run-scenario.js";
import { composeTestDataCommand } from "./backend/app/test-data/compose.js";
import { composeExplainRuntime } from "./backend/app/composition/explain-compose.js";
import { composeOcrCommand } from "./backend/transports/cli/ocr.js";
import { composeStorageCommand } from "./backend/app/composition/storage-compose.js";
import { composeWorkerRuntime } from "./backend/app/composition/worker-compose.js";
import type { RuntimeProcessLockHandle } from "./backend/storage/sqlite/runtime-process-locks.js";
import type { RuntimeAdmission } from "./backend/storage/admission/admission.js";

/** Compose and start one admitted CLI invocation; secure bootstrap awaits it, so a shutdown failure reaches the entrypoint. */
/** The checkout that owns this cli module, never the caller's CWD. */
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function runCli(admission: RuntimeAdmission, takeInitialCustody?: () => RuntimeProcessLockHandle | undefined): Promise<void> {
  admission.assertLive();
  if (process.argv[2] === "storage" && process.argv[3] === "transactions") {
    const command = parseTransactionExportArgs(process.argv.slice(4));
    if (command.kind === "help") { process.stdout.write(TRANSACTION_EXPORT_HELP); return; }
    const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"),
      busyTimeoutMs: 5000, migrationOwner: "transaction-export", openMode: "storage-doctor-read-only-no-migrate" });
    try { process.stdout.write(`${JSON.stringify(exportTransactions(createTransactionHistory(database.authority), command.request))}\n`); }
    finally { database.close(); }
    return;
  }
  registerDashboardComposer((runtimeIsolation, options) =>
    composeDashboardRuntime({ admission, isolation: runtimeIsolation, repoRoot: REPOSITORY_ROOT, frontend: options.frontend }));
  registerTestDataComposer((runtimeIsolation, args) => composeTestDataCommand(admission,runtimeIsolation, args, REPOSITORY_ROOT, {
    loadManifests: async () => Promise.all(listDryRunScenarioWorkflows().map(async (workflow) =>
      parseDryRunScenarioManifest(await loadDryRunScenarioManifest(workflow)))),
  }));
  registerWorkerComposer(async (runtimeIsolation, args) => {
    const report = await composeWorkerRuntime({ admission, isolation: runtimeIsolation, repoRoot: REPOSITORY_ROOT, args, ...(takeInitialCustody === undefined ? {} : { takeInitialCustody }) });
    if (report.closure === "unproved") process.exitCode = 1;
    return report;
  });
  registerExplainComposer((runtimeIsolation, args) => composeExplainRuntime({ admission, isolation: runtimeIsolation, args }));
  registerOcrComposer((args) => composeOcrCommand({ args }));
  registerStorageComposer((runtimeIsolation, args) => composeStorageCommand(runtimeIsolation, args, undefined, REPOSITORY_ROOT, admission));
  await startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
}
