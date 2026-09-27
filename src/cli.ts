import { join } from "node:path";
import { AuthorityDatabase } from "./infra/sqlite/authority-database.js";
import { createTransactionHistory } from "./infra/sqlite/transaction-history.js";
import { exportTransactions, parseTransactionExportArgs, TRANSACTION_EXPORT_HELP } from "./server/storage/transaction-export.js";
import { fileURLToPath } from "node:url";
import { rebuildRuntimeIsolation } from "./config/runtime-isolation.js";
import {
  registerDashboardComposer,
  registerDryRunScenarioComposer,
  registerExplainComposer,
  registerOcrComposer,
  registerStorageComposer,
  registerTestDataComposer,
  registerWorkerComposer,
  startRebuildRuntime,
} from "./core/runtime-composition.js";
import { composeDashboardRuntime } from "./server/dashboard/compose.js";
import { composeDryRunScenarioCommand } from "./server/dry-run-scenario/compose.js";
import { listDryRunScenarioWorkflows, loadDryRunScenarioManifest } from "./server/dry-run-scenario/manifests.js";
import { parseDryRunScenarioManifest } from "./domain/trust/dry-run-scenario.js";
import { composeTestDataCommand } from "./server/test-data/compose.js";
import { createProductionDryRunScenarioRuntime } from "./server/dry-run-scenario/runtime.js";
import { composeExplainRuntime } from "./server/explain/compose.js";
import { composeOcrCommand } from "./server/ocr/compose.js";
import { composeStorageCommand } from "./server/storage/compose.js";
import { composeWorkerRuntime } from "./server/worker/compose.js";
import type { RuntimeAdmission } from "./infra/runtime-control/admission.js";

/**
 * Compose and start one admitted CLI invocation. Secure bootstrap is the sole
 * caller, and it AWAITS this promise: for `dashboard` the promise is the
 * runtime's whole lifetime (it settles only after the composed runtime stopped),
 * so a shutdown failure reaches the entrypoint instead of vanishing.
 */
/** The checkout that owns THIS cli module; never the caller's CWD (D341). */
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function runCli(admission: RuntimeAdmission): Promise<void> {
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
  registerDryRunScenarioComposer((runtimeIsolation, args) => composeDryRunScenarioCommand({
    admission,
    isolation: runtimeIsolation,
    args,
    // The manifest registration itself lives in ./server/dry-run-scenario/manifests.js
    // (ref guards-and-tests §10.9) — `test-target-registry` (architecture) reads
    // that file's own source and walks the layout, failing in both directions,
    // so a manifest that lands without a registration there, or a registration
    // that outlives its manifest, is red.
    loadManifest: loadDryRunScenarioManifest,
    createRuntime: createProductionDryRunScenarioRuntime,
    repoRoot: REPOSITORY_ROOT,
  }));
  registerTestDataComposer((runtimeIsolation, args) => composeTestDataCommand(admission,runtimeIsolation, args, REPOSITORY_ROOT, {
    loadManifests: async () => Promise.all(listDryRunScenarioWorkflows().map(async (workflow) =>
      parseDryRunScenarioManifest(await loadDryRunScenarioManifest(workflow)))),
  }));
  registerWorkerComposer((runtimeIsolation, args) => composeWorkerRuntime({ admission, isolation: runtimeIsolation, repoRoot: REPOSITORY_ROOT, args }));
  registerExplainComposer((runtimeIsolation, args) => composeExplainRuntime({ admission, isolation: runtimeIsolation, args }));
  registerOcrComposer((args) => composeOcrCommand({ args }));
  registerStorageComposer((runtimeIsolation, args) => composeStorageCommand(runtimeIsolation, args, undefined, REPOSITORY_ROOT, admission));
  await startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
}
