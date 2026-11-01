import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { isDirectExecution } from "./scope-files.js";

// Storage closure, backup and restore proofs refuse off macOS, so these files run on macOS runners.
export const MACOS_FILES = [
  "tests/backend/app/composition/dashboard/compose.authenticated-upgrade.integration.test.ts",
  "tests/backend/app/composition/profile-credential-inventory.integration.test.ts",
  "tests/backend/app/composition/storage-compose.integration.test.ts",
  "tests/backend/profiles/profile-session.incomplete-publication.integration.test.ts",
  "tests/backend/profiles/profile-session.onboarding-native-recovery.integration.test.ts",
  "tests/backend/runs/lifecycle/run-record-service.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/admission/admission.assistant-populated-schema7.integration.test.ts",
  "tests/backend/storage/admission/admission.profile-upgrade.integration.test.ts",
  "tests/backend/storage/admission/bootstrap-admission.flat-start-clean.integration.test.ts",
  "tests/backend/storage/admission/bootstrap-admission.integration.test.ts",
  "tests/backend/storage/admission/installation.device-recertification.integration.test.ts",
  "tests/backend/storage/admission/installation.historical-relocation-upgrade.integration.test.ts",
  "tests/backend/storage/configuration/chatgpt-credential-repository.maintenance.integration.test.ts",
  "tests/backend/storage/configuration/credential-key-custody.integration.test.ts",
  "tests/backend/storage/configuration/credential-store.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/configuration/duo-credential-store.draft-recovery.integration.test.ts",
  "tests/backend/storage/configuration/duo-credential-store.integration.test.ts",
  "tests/backend/storage/maintenance/cancel-queued-runs.integration.test.ts",
  "tests/backend/storage/maintenance/existing-data-backup.flat-storage.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.machine-control-disposition.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.integration.test.ts",
  "tests/backend/storage/sqlite/authority-database.incomplete-inventory.integration.test.ts",
  "tests/backend/storage/sqlite/authority-database.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/sqlite/backup-inspection.integration.test.ts",
  "tests/backend/storage/sqlite/backup-service.test.ts",
  "tests/backend/storage/sqlite/migrations.native-baseline.integration.test.ts",
  "tests/backend/storage/sqlite/offline-restore.browser-inventory.integration.test.ts",
  "tests/backend/storage/sqlite/offline-restore.profile-continuity.integration.test.ts",
  "tests/backend/storage/sqlite/profile-local-databases.readonly-binding.integration.test.ts",
  "tests/backend/storage/sqlite/readonly-authority-snapshot.integration.test.ts",
  "tests/backend/storage/sqlite/runtime-process-locks.storage-restore-drill.integration.test.ts",
  "tests/scripts/dev/secure-env-bootstrap.backup.integration.test.ts",
] as const;

// Native browser process proofs run on macOS one at a time, without competing files.
export const SERIAL_FILES = [
  "tests/backend/app/composition/dashboard/compose.worker-browser-control-process.integration.test.ts",
  "tests/backend/runtime/browser/onboarding-duo-provider.integration.test.ts",
  "tests/backend/runtime/workers/worker-supervisor.integration.test.ts",
] as const;

export type CiProject = "unit" | "integration";
export type CiRunner = "ubuntu" | "macos" | "serial";

const projectOf = (file: string): CiProject => file.endsWith(".integration.test.ts") ? "integration" : "unit";

export function selectCiFiles(listed: readonly string[], project: CiProject, runner: CiRunner): string[] {
  const pinned = (runner === "serial" ? SERIAL_FILES : runner === "macos" ? MACOS_FILES : [...MACOS_FILES, ...SERIAL_FILES])
    .filter(file => projectOf(file) === project);
  const missing = pinned.filter(file => !listed.includes(file));
  if (missing.length > 0) throw new Error(`CI file lists name files Vitest does not list: ${missing.join(", ")}`);
  const selected = runner === "ubuntu" ? listed.filter(file => !(pinned as readonly string[]).includes(file)) : pinned;
  if (selected.length === 0) throw new Error(`No ${project} files selected for ${runner}.`);
  return selected;
}

if (isDirectExecution(import.meta.url)) {
  const [project, runner, listing] = process.argv.slice(2) as [CiProject, CiRunner, string];
  const listed = (JSON.parse(readFileSync(listing, "utf8")) as { file: string }[]).map(({ file }) => relative(process.cwd(), file));
  process.stdout.write(selectCiFiles(listed, project, runner).join("\0") + "\0");
}
