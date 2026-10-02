/**
 * D341 — move the two retired test-target canary entries out of the pre-D341
 * credential document (`.tracker/credentials/protected.json`, schemaVersion 1)
 * into the ignored private test-data file (`config/test-data.local.json`).
 *
 * Order under the credential writer lock: read and strictly replay the legacy
 * document; plan the destination merge; stage, rename and read back the
 * destination; only then rewrite the source as the schemaVersion-2 document
 * whose baseline retires the old identities value-free. A failure before the
 * source rewrite leaves the source untouched; a re-run after a destination
 * write finds equal entries and proceeds idempotently. Neither `plan` nor
 * `apply` touches `.env`, a browser, or the authority database.
 */
import { randomUUID } from "node:crypto";
import {
  planTestDataLocalMerge,
  readTestDataLocalConfig,
  testDataLocalPresence,
  writeTestDataLocalConfig,
  type TestDataLocalMergePlan,
  type TestDataLocalReadOutcome,
} from "./test-data-local.js";
import { systemClock } from "../../../domain/clock.js";
import { privateEqual } from "../../../domain/private-equal.js";
import { TEST_DATA_LOCAL_CONFIG_PATH, TestDataLocalConfigError } from "../../../domain/test-data.js";
import {
  createCredentialStore,
  type CredentialTestDataMigrationInspection,
  type CredentialUpgradeStore,
  type RetiredTestTargetEntry,
} from "./credential-store.js";

export interface CredentialTestDataMigrationInput {
  readonly admission: import("../admission/admission.js").RuntimeAdmission;
  readonly stateRoot: string;
  readonly localPath: string;
  readonly mode: "plan" | "apply";
  readonly now?: () => Date;
  readonly store?: CredentialUpgradeStore;
  readonly ids?: Readonly<{ randomUUID: () => string }>;
}

export interface CredentialTestDataMigrationReport {
  readonly mode: "plan" | "apply";
  readonly status: "planned" | "converted" | "already-converted" | "nothing-to-migrate" | "refused" | "defect";
  readonly source: Readonly<{
    path: "credentials/protected.json";
    state: "absent" | "current" | "legacy";
    revision?: number;
    historyLength?: number;
    retiredEntries: readonly string[];
  }>;
  readonly destination: Readonly<{
    path: typeof TEST_DATA_LOCAL_CONFIG_PATH;
    state: "absent" | "valid" | "invalid";
    action: TestDataLocalMergePlan["action"];
    inputs: readonly Readonly<{ name: string; disposition: string }>[];
  }>;
  readonly reason?: string;
}

function sourceReport(inspection: CredentialTestDataMigrationInspection): CredentialTestDataMigrationReport["source"] {
  if (inspection.state === "absent") return { path: "credentials/protected.json", state: "absent", retiredEntries: [] };
  if (inspection.state === "current") {
    return { path: "credentials/protected.json", state: "current", revision: inspection.revision,
      retiredEntries: inspection.retiredEntries.map(({ name }) => name) };
  }
  return { path: "credentials/protected.json", state: "legacy", revision: inspection.revision,
    historyLength: inspection.historyLength, retiredEntries: inspection.retiredEntries.map(({ name }) => name) };
}

function readDestination(localPath: string): Readonly<{ outcome?: TestDataLocalReadOutcome; state: "absent" | "valid" | "invalid"; reason?: string }> {
  try {
    const outcome = readTestDataLocalConfig(localPath);
    return { outcome, state: testDataLocalPresence(outcome).state };
  } catch (error) {
    if (!(error instanceof TestDataLocalConfigError)) throw error;
    return { state: "invalid", reason: error.message };
  }
}

export async function migrateTestDataFromCredentials(
  input: CredentialTestDataMigrationInput,
): Promise<CredentialTestDataMigrationReport> {
  const store = input.store ?? createCredentialStore({ admission: input.admission, stateRoot: input.stateRoot, ...(input.ids === undefined ? {} : { ids: input.ids }) });
  const ids = input.ids ?? { randomUUID };
  const now = input.now ?? (() => systemClock.now());
  const destinationPath = { path: TEST_DATA_LOCAL_CONFIG_PATH } as const;

  let inspection: CredentialTestDataMigrationInspection;
  try {
    inspection = store.inspectTestDataMigration();
  } catch (error) {
    return { mode: input.mode, status: "defect",
      source: { path: "credentials/protected.json", state: "absent", retiredEntries: [] },
      destination: { ...destinationPath, state: "absent", action: "none", inputs: [] },
      reason: `credential document could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  const source = sourceReport(inspection);
  const destination = readDestination(input.localPath);

  if (inspection.state === "absent") {
    return { mode: input.mode, status: "nothing-to-migrate", source,
      destination: { ...destinationPath, state: destination.state, action: "none", inputs: [] } };
  }
  if (inspection.state === "current") {
    // Value-free check that the destination still carries what the baseline retired.
    const missing = destination.outcome?.state === "valid"
      ? inspection.retiredEntries.filter(({ name, valueId }) => destination.outcome?.state === "valid"
        && destination.outcome.config.inputs[name]?.valueId !== valueId).map(({ name }) => name)
      : inspection.retiredEntries.map(({ name }) => name);
    if (missing.length > 0) {
      return { mode: input.mode, status: "refused", source,
        destination: { ...destinationPath, state: destination.state, action: "none",
          inputs: missing.map((name) => ({ name, disposition: "missing" })) },
        reason: `already converted, but ${TEST_DATA_LOCAL_CONFIG_PATH} no longer carries ${missing.join(", ")}` };
    }
    return { mode: input.mode, status: "already-converted", source,
      destination: { ...destinationPath, state: destination.state, action: "unchanged",
        inputs: inspection.retiredEntries.map(({ name }) => ({ name, disposition: "equal" })) } };
  }

  if (inspection.pendingUpgradeRetiredNames.length > 0) {
    return { mode: input.mode, status: "refused", source,
      destination: { ...destinationPath, state: destination.state, action: "none", inputs: [] },
      reason: `pending upgrade binding names retired test-target entries ${inspection.pendingUpgradeRetiredNames.join(", ")}; complete or discard that upgrade first` };
  }
  if (destination.outcome === undefined) {
    return { mode: input.mode, status: "refused", source,
      destination: { ...destinationPath, state: "invalid", action: "none", inputs: [] },
      reason: `${TEST_DATA_LOCAL_CONFIG_PATH} is not a valid private file and will not be overwritten: ${destination.reason ?? "invalid"}` };
  }
  const plannedEntries = inspection.retiredEntries;
  const plan = planTestDataLocalMerge(destination.outcome, plannedEntries);
  const destinationReport = { ...destinationPath, state: destination.state, action: plan.action, inputs: plan.dispositions };
  if (plan.dispositions.some(({ disposition }) => disposition === "conflict")) {
    return { mode: input.mode, status: "refused", source, destination: destinationReport,
      reason: `${TEST_DATA_LOCAL_CONFIG_PATH} already carries a different entry for ${plan.dispositions
        .filter(({ disposition }) => disposition === "conflict").map(({ name }) => name).join(", ")}; reconcile by name, then re-run` };
  }
  if (input.mode === "plan") {
    return { mode: "plan", status: "planned", source, destination: destinationReport };
  }

  const priorDestination = destination.outcome;
  let outcome: Awaited<ReturnType<CredentialUpgradeStore["convertTestDataMigration"]>>;
  try {
    outcome = store.convertTestDataMigration({
    migrationId: ids.randomUUID(),
    migratedAt: now().toISOString(),
    stageDestination: (entries: readonly RetiredTestTargetEntry[]) => {
      // Re-plan against the exact entries observed under the lock; a changed source stops here.
      const sameEntries = entries.length === plannedEntries.length && entries.every((entry, index) =>
        entry.name === plannedEntries[index]?.name && entry.valueId === plannedEntries[index]?.valueId
        && entry.updatedAt === plannedEntries[index]?.updatedAt && privateEqual(entry.value, plannedEntries[index]?.value ?? ""));
      // Re-read the destination under the lock as well: an equal ("unchanged") plan writes nothing,
      // so the writer's own prior-state fence would never run; the source is retired only against
      // a destination re-verified here.
      const liveDestination = readTestDataLocalConfig(input.localPath);
      const sameDestination = liveDestination.state === priorDestination.state
        && (liveDestination.state !== "valid" || priorDestination.state !== "valid"
          || privateEqual(liveDestination.config, priorDestination.config));
      const locked = planTestDataLocalMerge(liveDestination, entries);
      if (!sameEntries || !sameDestination || locked.action !== plan.action
        || locked.dispositions.some(({ disposition }) => disposition === "conflict")) {
        throw new TestDataLocalConfigError("credential source or destination changed while the migration was planned; re-run");
      }
      if (locked.next !== undefined) writeTestDataLocalConfig(input.localPath, locked.next, liveDestination);
    },
    });
  } catch (error) {
    // A destination refusal under the lock leaves the source untouched; report it, never partially convert.
    if (!(error instanceof TestDataLocalConfigError)) throw error;
    return { mode: "apply", status: "refused", source, destination: destinationReport, reason: error.message };
  }
  if (outcome.state === "refused") {
    return { mode: "apply", status: "refused", source, destination: destinationReport, reason: outcome.reason };
  }
  if (outcome.state === "nothing-to-migrate") {
    return { mode: "apply", status: "nothing-to-migrate", source, destination: { ...destinationReport, action: "none" } };
  }
  if (outcome.state === "already-converted") {
    return { mode: "apply", status: "already-converted", source: { ...source, state: "current", revision: outcome.revision }, destination: destinationReport };
  }
  return { mode: "apply", status: "converted",
    source: { ...source, state: "current", revision: outcome.revision },
    destination: destinationReport };
}
