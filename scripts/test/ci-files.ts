import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isDirectExecution } from "./scope-files.js";

// Storage closure, backup and restore proofs refuse off macOS, so these files run on macOS runners.
export const MACOS_FILES: readonly string[] = [
  "tests/backend/app/composition/dashboard/compose.authenticated-upgrade.integration.test.ts",
  "tests/backend/app/composition/profile-credential-inventory.integration.test.ts",
  "tests/backend/app/composition/storage-compose.integration.test.ts",
  "tests/backend/app/composition/storage/relocate.integration.test.ts",
  "tests/backend/profiles/profile-session.incomplete-publication.integration.test.ts",
  "tests/backend/profiles/profile-session.credential-migration.integration.test.ts",
  "tests/backend/profiles/profile-session.onboarding-native-recovery.integration.test.ts",
  "tests/backend/runs/lifecycle/run-record-service.storage-restore-drill.integration.test.ts",
  "tests/backend/storage/admission/admission.assistant-populated-schema7.integration.test.ts",
  "tests/backend/storage/admission/admission.profile-upgrade.integration.test.ts",
  "tests/backend/storage/admission/bootstrap-admission.flat-start-clean.integration.test.ts",
  "tests/backend/storage/admission/bootstrap-admission.integration.test.ts",
  "tests/backend/storage/admission/installation.historical-relocation-upgrade.integration.test.ts",
  "tests/backend/storage/admission/installation.logical-publication.integration.test.ts",
  "tests/backend/storage/configuration/chatgpt-credential-repository.maintenance.integration.test.ts",
  "tests/backend/storage/configuration/credential-key-custody.integration.test.ts",
  "tests/backend/storage/configuration/credential-store.storage-restore-drill.integration.test.ts",
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
  "tests/backend/storage/sqlite/offline-restore.invalidation-replay.integration.test.ts",
  "tests/backend/storage/sqlite/offline-restore.profile-continuity.integration.test.ts",
  "tests/backend/storage/sqlite/profile-local-databases.readonly-binding.integration.test.ts",
  "tests/backend/storage/sqlite/readonly-authority-snapshot.integration.test.ts",
  "tests/backend/storage/sqlite/runtime-process-locks.storage-restore-drill.integration.test.ts",
  "tests/scripts/dev/secure-env-bootstrap.backup.integration.test.ts",
];

// Native browser process proofs run on macOS one at a time, without competing files.
export const SERIAL_FILES: readonly string[] = [
  "tests/backend/app/composition/dashboard/compose.worker-browser-control-process.integration.test.ts",
  "tests/backend/runtime/browser/onboarding-duo-provider.integration.test.ts",
  "tests/backend/runtime/workers/worker-supervisor.integration.test.ts",
];

export type CiProject = "unit" | "integration" | "architecture";
export type CiRunner = "ubuntu" | "macos" | "serial";
export type CiDurations = Readonly<Record<string, number>>;

const DURATIONS_PATH = "scripts/test/ci-durations.json";
const projectOf = (file: string): CiProject => file.endsWith(".integration.test.ts") ? "integration" : "unit";
const isSerial = (file: string) => SERIAL_FILES.includes(file);

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

export function selectCiFiles(listed: readonly string[], project: CiProject, runner: CiRunner, job: number, jobs: number, durations: CiDurations): string[] {
  const macos = [...MACOS_FILES, ...SERIAL_FILES];
  const missing = macos.filter(file => projectOf(file) === project && !listed.includes(file));
  if (missing.length > 0) throw new Error(`CI file lists name files Vitest does not list: ${missing.join(", ")}`);
  const known = Object.values(durations).sort((a, b) => a - b);
  const seconds = (file: string) => durations[file] ?? known[Math.floor(known.length / 2)] ?? 1;
  if (runner === "ubuntu") return balance(listed.filter(file => !macos.includes(file)), jobs, seconds)[job - 1] ?? [];
  // Serial proofs run alone; other files share two workers, so they count half their time.
  const bin = balance(macos, jobs, file => isSerial(file) ? seconds(file) : seconds(file) / 2)[job - 1] ?? [];
  return bin.filter(file => projectOf(file) === project && isSerial(file) === (runner === "serial"));
}

type VitestReport = { testResults: { name: string; startTime: number; endTime: number }[] };

// Vitest JSON reports (`--reporter=json`) record each file's absolute path, start and end time.
export function durationsFromReports(reports: readonly VitestReport[]): Record<string, number> {
  const entries = reports.flatMap(report => report.testResults.map(({ name, startTime, endTime }) =>
    [name.slice(name.lastIndexOf("/tests/") + 1), Math.round((endTime - startTime) / 100) / 10] as const));
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

if (isDirectExecution(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "durations") {
    const dir = args[0] ?? ".";
    const reports = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(file => file.endsWith(".json"))
      .map(file => JSON.parse(readFileSync(join(dir, file), "utf8")) as VitestReport);
    const merged: Record<string, number> = { ...(JSON.parse(readFileSync(DURATIONS_PATH, "utf8")) as CiDurations), ...durationsFromReports(reports) };
    writeFileSync(DURATIONS_PATH, JSON.stringify(Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
  } else {
    const [project, runner, listing, slice] = args as [CiProject, CiRunner, string, string];
    const [job, jobs] = slice.split("/").map(Number) as [number, number];
    const listed = (JSON.parse(readFileSync(listing, "utf8")) as { file: string }[]).map(({ file }) => relative(process.cwd(), file));
    const durations = JSON.parse(readFileSync(DURATIONS_PATH, "utf8")) as CiDurations;
    const files = selectCiFiles(listed, project, runner, job, jobs, durations);
    process.stdout.write(files.map(file => file + "\0").join(""));
  }
}
