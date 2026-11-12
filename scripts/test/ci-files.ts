import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { isDirectExecution } from "./scope-files.js";

// Storage closure, backup and restore proofs require native platform runners.
export const NATIVE_FILES: readonly string[] = [
  "tests/workflows/emergency-contact/workflow.member-retry.crash.integration.test.ts",
  "tests/backend/app/composition/dashboard/profile-session-routes.restart.integration.test.ts",
  "tests/backend/app/composition/storage-compose.predecessor-logout.integration.test.ts",
  "tests/backend/storage/maintenance/evidence-schema-upgrade.integration.test.ts",
  "tests/backend/storage/maintenance/protected-settings-upgrade.integration.test.ts",
  "tests/scripts/dev/relay.windows-native.integration.test.ts",
  "tests/backend/storage/maintenance/custody-availability.windows-native.integration.test.ts",
  "tests/backend/storage/private-path.windows-native.integration.test.ts",
  "tests/backend/storage/private-path.macos-native.integration.test.ts",
  "tests/backend/storage/windows-private-path.windows-native.integration.test.ts",
  "tests/backend/storage/sqlite/profile-local-databases.windows-native.integration.test.ts",
  "tests/backend/storage/maintenance/account-deletion.integration.test.ts",
  "tests/backend/app/composition/storage-compose.clean-shutdown.integration.test.ts",
  "tests/backend/app/composition/storage-compose.startup-repair.integration.test.ts",
  "tests/backend/app/composition/worker/artifact-output.integration.test.ts",
  "tests/backend/app/composition/dashboard/compose.startup-upgrade.integration.test.ts",
  "tests/backend/app/composition/profile-credential-inventory.integration.test.ts",
  "tests/backend/app/composition/storage-compose.integration.test.ts",
  "tests/backend/profiles/profile-session.incomplete-publication.integration.test.ts",
  "tests/backend/profiles/profile-session.credential-migration.integration.test.ts",
  "tests/backend/profiles/profile-session.onboarding-native-recovery.integration.test.ts",
  "tests/backend/runs/lifecycle/run-record-service.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/admission/admission.assistant-populated-schema7.integration.test.ts",
  "tests/backend/storage/admission/admission.profile-upgrade.integration.test.ts",
  "tests/backend/storage/admission/bootstrap-admission.flat-start-clean.integration.test.ts",
  "tests/backend/storage/admission/bootstrap-admission.integration.test.ts",
  "tests/backend/storage/admission/installation.logical-publication.integration.test.ts",
  "tests/backend/storage/admission/lifetime-lock.handle-proof.integration.test.ts",
  "tests/backend/storage/configuration/chatgpt-credential-repository.maintenance.integration.test.ts",
  "tests/backend/storage/configuration/credential-key-custody.integration.test.ts",
  "tests/backend/storage/configuration/credential-store.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/admission/process-identity.integration.test.ts",
  "tests/backend/storage/maintenance/existing-data-backup.flat-storage.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.machine-control-disposition.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.custody.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.schema-matrix.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.workbook-schema-18.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.workbook-schema-24.integration.test.ts",
  "tests/backend/storage/sqlite/authority-database.incomplete-inventory.integration.test.ts",
  "tests/backend/storage/sqlite/authority-database.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/sqlite/backup-inspection.integration.test.ts",
  "tests/backend/storage/sqlite/backup-service.test.ts",
  "tests/backend/storage/sqlite/migrations.native-baseline.integration.test.ts",
  "tests/backend/storage/sqlite/offline-restore.browser-inventory.integration.test.ts",
  "tests/backend/storage/sqlite/offline-restore.browser-root-predecessor.integration.test.ts",
  "tests/backend/storage/sqlite/offline-restore.invalidation-replay.integration.test.ts",
  "tests/backend/storage/sqlite/offline-restore.profile-continuity.integration.test.ts",
  "tests/backend/storage/sqlite/profile-local-databases.readonly-binding.integration.test.ts",
  "tests/backend/storage/sqlite/readonly-authority-snapshot.integration.test.ts",
  "tests/backend/app/composition/storage-compose.fixed-layout.integration.test.ts",
  "tests/backend/storage/maintenance/fixed-layout.test.ts",
];

// Native browser process proofs run one at a time, without competing files.
export const SERIAL_FILES: readonly string[] = [
  "tests/backend/storage/maintenance/cancel-queued-runs.integration.test.ts",
  "tests/backend/storage/browser-roots.native.integration.test.ts",
  "tests/backend/runtime/browser/onboarding-duo-provider.integration.test.ts",
  "tests/backend/transports/http/native-path-picker.windows-native.integration.test.ts",
];

// Upgrade backup and native-closure proofs run without competing storage files.
export const SERIAL_STORAGE_FILES: readonly string[] = [
  "tests/backend/app/composition/dashboard/compose.startup-upgrade.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.machine-control-disposition.integration.test.ts",
];

// Native files that passed on Linux (ci-pipeline-07 report): Ubuntu shards run them too; the macOS native shards still run them.
export const LINUX_NATIVE_FILES: readonly string[] = [
  "tests/backend/app/composition/storage-compose.predecessor-logout.integration.test.ts",
  "tests/backend/storage/maintenance/evidence-schema-upgrade.integration.test.ts",
  "tests/backend/storage/maintenance/protected-settings-upgrade.integration.test.ts",
  "tests/backend/app/composition/storage-compose.clean-shutdown.integration.test.ts",
  "tests/backend/app/composition/storage-compose.startup-repair.integration.test.ts",
  "tests/backend/app/composition/storage-compose.integration.test.ts",
  "tests/backend/profiles/profile-session.incomplete-publication.integration.test.ts",
  "tests/backend/profiles/profile-session.credential-migration.integration.test.ts",
  "tests/backend/runs/lifecycle/run-record-service.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/admission/admission.assistant-populated-schema7.integration.test.ts",
  "tests/backend/storage/admission/admission.profile-upgrade.integration.test.ts",
  "tests/backend/storage/admission/installation.logical-publication.integration.test.ts",
  "tests/backend/storage/admission/lifetime-lock.handle-proof.integration.test.ts",
  "tests/backend/storage/configuration/chatgpt-credential-repository.maintenance.integration.test.ts",
  "tests/backend/storage/configuration/credential-key-custody.integration.test.ts",
  "tests/backend/storage/configuration/credential-store.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/admission/process-identity.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.custody.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.schema-matrix.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.workbook-schema-18.integration.test.ts",
  "tests/backend/storage/maintenance/upgrade.ready-bound.workbook-schema-24.integration.test.ts",
  "tests/backend/storage/sqlite/authority-database.incomplete-inventory.integration.test.ts",
  "tests/backend/storage/sqlite/authority-database.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/sqlite/backup-inspection.integration.test.ts",
  "tests/backend/storage/sqlite/migrations.native-baseline.integration.test.ts",
  "tests/backend/storage/sqlite/profile-local-databases.readonly-binding.integration.test.ts",
  "tests/backend/storage/sqlite/readonly-authority-snapshot.integration.test.ts",
  "tests/backend/storage/maintenance/fixed-layout.test.ts",
];

export type CiProject = "unit" | "integration" | "architecture";
export type CiRunner = "ubuntu" | "native" | "serial" | "storage";
export type CiDurations = Readonly<Record<string, number>>;

const DURATIONS_PATH = "scripts/test/ci-durations.json";
const ciDurationsSchema = z.record(z.string().startsWith("tests/"), z.number().nonnegative());
const projectOf = (file: string): CiProject => file.endsWith(".integration.test.ts") ? "integration" : "unit";
const isSingleWorker = (file: string) => SERIAL_FILES.includes(file) || SERIAL_STORAGE_FILES.includes(file);

// Greedy longest-first packing: each file goes to the job with the least measured work so far.
export function balance(files: readonly string[], jobs: number, weight: (file: string) => number): string[][] {
  const bins = Array.from({ length: jobs }, () => ({ load: 0, files: [] as string[] }));
  const ordered = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  for (const file of ordered) {
    const bin = bins.reduce((least, next) => next.load < least.load ? next : least);
    bin.files.push(file);
    bin.load += weight(file);
  }
  return bins.map(bin => bin.files.sort());
}

export function selectCiFiles(listing: readonly string[], project: CiProject, runner: CiRunner, job: number, jobs: number, durations: CiDurations): string[] {
  const listed = listing.map(file => file.replaceAll("\\", "/"));
  const native = [...NATIVE_FILES, ...SERIAL_FILES];
  const missing = native.filter(file => projectOf(file) === project && !listed.includes(file));
  if (missing.length > 0) throw new Error(`CI file lists name files Vitest does not list: ${missing.join(", ")}`);
  const known = Object.values(durations).filter(seconds => seconds > 0).sort((a, b) => a - b);
  const seconds = (file: string) => Math.max(0.1, durations[file] ?? known[Math.floor(known.length / 2)] ?? 1);
  if (runner === "ubuntu") return balance(listed.filter(file => !native.includes(file) || LINUX_NATIVE_FILES.includes(file)), jobs, seconds)[job - 1] ?? [];
  // Serial proofs run alone; other files share two workers, so they count half their time.
  const bin = balance(native, jobs, file => isSingleWorker(file) ? seconds(file) : seconds(file) / 2)[job - 1] ?? [];
  const selected = runner === "serial" ? SERIAL_FILES : runner === "storage" ? SERIAL_STORAGE_FILES
    : NATIVE_FILES.filter(file => !SERIAL_STORAGE_FILES.includes(file));
  return bin.filter(file => projectOf(file) === project && selected.includes(file));
}

const vitestReportSchema = z.object({ testResults: z.array(z.object({
  name: z.string(), startTime: z.number().nonnegative(), endTime: z.number().nonnegative(),
})) });

// Vitest JSON reports (`--reporter=json`) record each file's absolute path, start and end time.
export function durationsFromReports(reports: readonly unknown[]): Record<string, number> {
  const entries = reports.flatMap(report => vitestReportSchema.parse(report).testResults.map(({ name, startTime, endTime }) => {
    const normalized = name.replaceAll("\\", "/");
    const root = normalized.lastIndexOf("/tests/");
    if (root < 0 || endTime < startTime) throw new Error(`Invalid CI timing for ${normalized}`);
    return [normalized.slice(root + 1), Math.round((endTime - startTime) / 100) / 10] as const;
  }));
  const slowest = new Map<string, number>();
  for (const [file, seconds] of entries) slowest.set(file, Math.max(slowest.get(file) ?? 0, seconds));
  return Object.fromEntries([...slowest].sort(([a], [b]) => a.localeCompare(b)));
}

if (isDirectExecution(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "durations") {
    const dir = args[0] ?? ".";
    const reports = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(file => file.endsWith(".json"))
      .map(file => JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown);
    const merged = { ...ciDurationsSchema.parse(JSON.parse(readFileSync(DURATIONS_PATH, "utf8"))), ...durationsFromReports(reports) };
    writeFileSync(DURATIONS_PATH, JSON.stringify(Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
  } else {
    const [project, runner, listing, slice] = args as [CiProject, CiRunner, string, string];
    const [job, jobs] = slice.split("/").map(Number) as [number, number];
    const listed = (JSON.parse(readFileSync(listing, "utf8")) as { file: string }[]).map(({ file }) => relative(process.cwd(), file));
    const durations = ciDurationsSchema.parse(JSON.parse(readFileSync(DURATIONS_PATH, "utf8")));
    const files = selectCiFiles(listed, project, runner, job, jobs, durations);
    process.stdout.write(files.map(file => file + "\0").join(""));
  }
}
