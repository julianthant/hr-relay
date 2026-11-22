import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { applicationDataWorkspace } from "../../src/backend/app/config/runtime-isolation.js";
import { parseBackupManifestFile } from "../../src/backend/storage/sqlite/backup-service.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";

export const COPY_PROFILES = ["staging", "development"] as const;
export type CopyProfile = (typeof COPY_PROFILES)[number];

const ACTIVE_RUN_STATUSES = new Set(["running", "cancelling", "awaiting-approval"]);
const ACTIVE_WORKER_STATES = new Set(["running", "starting", "waiting", "paused"]);
const DashboardSnapshotSchema = z.looseObject({
  statusCounts: z.array(z.looseObject({ status: z.string(), count: z.number() })),
  workerCards: z.array(z.looseObject({ state: z.string() })),
});

export class ProfileCopyRefusedError extends Error {
  constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); }
}

export type FetchJson = (url: string) => Promise<unknown>;
const fetchJson: FetchJson = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new ProfileCopyRefusedError("dashboard-status-unreadable", `${url} answered ${String(response.status)}`);
  return response.json();
};

/** Throws while the profile's own dashboard reports a run or worker in flight; a refused connection means it is stopped. shortcut: counts today's runs only, upgrade when a run-spanning endpoint exists. */
export async function assertNoActiveRun(profile: CopyProfile, today: string, get: FetchJson = fetchJson): Promise<void> {
  const url = `http://127.0.0.1:${String(runtimeProfiles[profile].backendPort)}/api/v1/dashboard?day=${today}`;
  let body: unknown;
  try { body = await get(url); }
  catch (error) {
    if (error instanceof ProfileCopyRefusedError) throw error;
    if (error instanceof TypeError && z.object({ code: z.literal("ECONNREFUSED") }).safeParse(error.cause).success) return;
    throw new ProfileCopyRefusedError("dashboard-status-unreadable", `${profile} dashboard did not answer: ${String(error)}`);
  }
  const snapshot = DashboardSnapshotSchema.parse(body);
  const active = snapshot.statusCounts.filter(row => ACTIVE_RUN_STATUSES.has(row.status) && row.count > 0).length
    + snapshot.workerCards.filter(card => ACTIVE_WORKER_STATES.has(card.state)).length;
  if (active > 0) throw new ProfileCopyRefusedError("active-run", `the ${profile} dashboard has an active run; wait for it or stop it from the dashboard`);
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export interface CopiedBackup { readonly profileId: string; readonly backupFileName: string; readonly authorityGeneration: number; readonly createdAt: string }

/** Copies each person's newest verified authority backup (database only: backups hold no credentials or tokens) from the source workspace into the target workspace. */
export function copyVerifiedBackups(sourceWorkspace: string, targetWorkspace: string): CopiedBackup[] {
  const stateSuffix = join(".tracker", "data", "profiles");
  const profilesRoot = join(sourceWorkspace, stateSuffix);
  if (!existsSync(profilesRoot)) throw new ProfileCopyRefusedError("source-store-missing", "the production store has no profile folders");
  const copied: CopiedBackup[] = [];
  for (const profileId of readdirSync(profilesRoot).sort()) {
    const directory = join(profilesRoot, profileId, "backups", "authority");
    if (!existsSync(directory)) continue;
    const manifests = readdirSync(directory).filter(name => name.endsWith(".manifest.json"))
      .map(name => ({ name, manifest: parseBackupManifestFile(join(directory, name)) }))
      .sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
    const newest = manifests[0];
    if (newest === undefined) continue;
    const { manifest } = newest, database = join(directory, manifest.backupFileName);
    if (manifest.profileId !== profileId || newest.name !== `${manifest.backupFileName}.manifest.json`) throw new ProfileCopyRefusedError("backup-manifest-mismatch", `${newest.name} does not describe ${profileId}`);
    if (statSync(database).size !== manifest.byteSize || sha256(database) !== manifest.sha256) throw new ProfileCopyRefusedError("backup-unverified", `${manifest.backupFileName} does not match its manifest`);
    const targetDirectory = join(targetWorkspace, stateSuffix, profileId, "backups", "authority");
    mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
    for (const [source, name] of [[database, manifest.backupFileName], [join(directory, newest.name), newest.name]] as const) {
      const stage = join(targetDirectory, `.${name}.tmp`);
      copyFileSync(source, stage);
      renameSync(stage, join(targetDirectory, name));
    }
    if (sha256(join(targetDirectory, manifest.backupFileName)) !== manifest.sha256) throw new ProfileCopyRefusedError("copy-unverified", `${manifest.backupFileName} changed while copying`);
    copied.push({ profileId, backupFileName: manifest.backupFileName, authorityGeneration: manifest.authorityGeneration, createdAt: manifest.createdAt });
  }
  if (copied.length === 0) throw new ProfileCopyRefusedError("source-backup-missing", "the production store has no verified backup to copy; let production take one first");
  return copied;
}

export type Git = (args: readonly string[]) => string;
const gitIn = (directory: string): Git => args => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();

/** Staging follows the newest `origin/cut/*` branch, development follows `origin/development`. */
export function resolveSourceRef(profile: CopyProfile, git: Git): string {
  git(["fetch", "--prune", "origin"]);
  if (profile === "development") return "origin/development";
  const cut = git(["for-each-ref", "--sort=-committerdate", "--count=1", "--format=%(refname:short)", "refs/remotes/origin/cut/"]);
  if (cut === "") throw new ProfileCopyRefusedError("cut-branch-missing", "no origin/cut/* branch exists to stage");
  return cut;
}

/** Creates or moves the copy's detached worktree; a dirty copy is refused. */
export function syncWorktree(path: string, ref: string, mainGit: Git): string {
  if (existsSync(join(path, ".git"))) {
    const copy = gitIn(path);
    if (copy(["status", "--porcelain"]) !== "") throw new ProfileCopyRefusedError("worktree-dirty", `${path} has local changes`);
    copy(["checkout", "--detach", ref]);
  } else mainGit(["worktree", "add", "--detach", path, ref]);
  return gitIn(path)(["rev-parse", "HEAD"]);
}

export interface ProfileCopyOptions {
  readonly profile: CopyProfile;
  readonly repository: string;
  readonly copyPath: string;
  readonly sourceWorkspace: string;
  readonly targetWorkspace: string;
  readonly today: string;
  readonly git?: Git;
  readonly get?: FetchJson;
}

export async function runProfileCopy(options: ProfileCopyOptions): Promise<string> {
  const { profile } = options, ports = runtimeProfiles[profile];
  await assertNoActiveRun(profile, options.today, options.get);
  const git = options.git ?? gitIn(options.repository);
  const ref = resolveSourceRef(profile, git);
  const sha = syncWorktree(options.copyPath, ref, git);
  const backups = copyVerifiedBackups(options.sourceWorkspace, options.targetWorkspace);
  return [
    `profile: ${profile}`,
    `source: ${ref} @ ${sha} in ${options.copyPath}`,
    `ports: backend ${String(ports.backendPort)}, frontend ${String(ports.frontendPort)}`,
    `data: ${options.targetWorkspace}`,
    ...backups.map(backup => `backup: ${backup.profileId} ${backup.backupFileName} (generation ${String(backup.authorityGeneration)}, taken ${backup.createdAt})`),
    `start: npm ci && npm run dashboard:${profile}   (in ${options.copyPath})`,
  ].join("\n");
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals } = parseArgs({ allowPositionals: true });
  const profile = z.enum(COPY_PROFILES).parse(positionals[0]);
  const copyPath = join(homedir(), "Projects", profile === "staging" ? "hr-relay-staging" : "hr-relay-dev");
  process.stdout.write(`${await runProfileCopy({
    profile, copyPath, repository: fileURLToPath(new URL("../..", import.meta.url)),
    sourceWorkspace: applicationDataWorkspace(undefined, "production"),
    targetWorkspace: applicationDataWorkspace(undefined, profile),
    today: systemClock.todayLocal(),
  })}\n`);
}
