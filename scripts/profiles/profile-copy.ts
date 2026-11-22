import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { applicationDataWorkspace } from "../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAlreadyRunningError, acquireRuntimeLifetimeLock } from "../../src/backend/storage/admission/lifetime-lock.js";
import { parseBackupManifestFile } from "../../src/backend/storage/sqlite/backup-service.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";

export const COPY_PROFILES = ["staging", "development"] as const;
export type CopyProfile = (typeof COPY_PROFILES)[number];

export class ProfileCopyRefusedError extends Error {
  constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); }
}

export interface HeldLock { close(): Promise<void> }
export type AcquireLock = (port: number) => Promise<HeldLock>;

/** Holds the profile's lifetime lock for the whole update: a running dashboard (or another update) owns it, so this refuses instead of touching its files. */
export async function withProfileLock<T>(profile: CopyProfile, work: () => Promise<T>, acquire: AcquireLock = acquireRuntimeLifetimeLock): Promise<T> {
  let lock: HeldLock;
  try { lock = await acquire(runtimeProfiles[profile].lockPort); }
  catch (error) {
    if (error instanceof RuntimeAlreadyRunningError) throw new ProfileCopyRefusedError("profile-running", `the ${profile} dashboard (or another update) holds its lifetime lock; stop it first`);
    throw error;
  }
  try { return await work(); }
  finally { await lock.close(); }
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const STATE_SUFFIX = join(".tracker", "data", "profiles");
const PRUNE_RETRIES = 3;

export interface CopiedBackup { readonly profileId: string; readonly backupFileName: string; readonly authorityGeneration: number; readonly createdAt: string }

/** Drops what an interrupted earlier copy left behind: staged files and databases whose manifest never landed. */
function clearIncompleteCopy(targetProfiles: string): void {
  if (!existsSync(targetProfiles)) return;
  for (const profileId of readdirSync(targetProfiles)) {
    const directory = join(targetProfiles, profileId, "backups", "authority");
    if (!existsSync(directory)) continue;
    const names = readdirSync(directory);
    for (const name of names) {
      if (name.startsWith(".") && name.endsWith(".tmp") || name.endsWith(".sqlite") && !names.includes(`${name}.manifest.json`)) rmSync(join(directory, name), { force: true });
    }
  }
}

function copyNewestBackup(profilesRoot: string, targetProfiles: string, profileId: string): CopiedBackup {
  const directory = join(profilesRoot, profileId, "backups", "authority");
  const manifests = existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith(".manifest.json"))
    .map(name => ({ name, manifest: parseBackupManifestFile(join(directory, name)) }))
    .sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt)) : [];
  const newest = manifests[0];
  if (newest === undefined) throw new ProfileCopyRefusedError("source-backup-missing", `person ${profileId} has no verified backup; let production take one first`);
  const { manifest } = newest, database = join(directory, manifest.backupFileName);
  if (manifest.profileId !== profileId || newest.name !== `${manifest.backupFileName}.manifest.json`) throw new ProfileCopyRefusedError("backup-manifest-mismatch", `${newest.name} does not describe ${profileId}`);
  if (statSync(database).size !== manifest.byteSize || sha256(database) !== manifest.sha256) throw new ProfileCopyRefusedError("backup-unverified", `${manifest.backupFileName} does not match its manifest`);
  const targetDirectory = join(targetProfiles, profileId, "backups", "authority");
  mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
  const staged = [[database, manifest.backupFileName], [join(directory, newest.name), newest.name]] as const;
  for (const [source, name] of staged) copyFileSync(source, join(targetDirectory, `.${name}.tmp`));
  if (sha256(join(targetDirectory, `.${manifest.backupFileName}.tmp`)) !== manifest.sha256) throw new ProfileCopyRefusedError("copy-unverified", `${manifest.backupFileName} changed while copying`);
  for (const [, name] of staged) renameSync(join(targetDirectory, `.${name}.tmp`), join(targetDirectory, name));
  return { profileId, backupFileName: manifest.backupFileName, authorityGeneration: manifest.authorityGeneration, createdAt: manifest.createdAt };
}

const isVanished = (error: unknown) => z.object({ code: z.literal("ENOENT") }).safeParse(error).success;

/** Copies each person's newest verified authority backup (database only: backups hold no credentials or tokens). Production may prune while this runs, so a vanished file re-lists the person's backups. */
export function copyVerifiedBackups(sourceWorkspace: string, targetWorkspace: string): CopiedBackup[] {
  const profilesRoot = join(sourceWorkspace, STATE_SUFFIX), targetProfiles = join(targetWorkspace, STATE_SUFFIX);
  if (!existsSync(profilesRoot)) throw new ProfileCopyRefusedError("source-store-missing", "the production store has no profile folders");
  const people = readdirSync(profilesRoot).sort();
  if (people.length === 0) throw new ProfileCopyRefusedError("source-store-missing", "the production store has no people");
  clearIncompleteCopy(targetProfiles);
  return people.map(profileId => {
    for (let attempt = 1; ; attempt += 1) {
      try { return copyNewestBackup(profilesRoot, targetProfiles, profileId); }
      catch (error) {
        if (!isVanished(error)) throw error;
        if (attempt === PRUNE_RETRIES) throw new ProfileCopyRefusedError("source-backup-pruned", `production kept pruning ${profileId}'s backups while copying; try again`);
      }
    }
  });
}

export type Git = (args: readonly string[]) => string;
const gitIn = (directory: string): Git => args => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();

/** Development follows `origin/development`. Staging follows the one `origin/cut/*` branch, or the one named by `requested`; several cuts without a choice are refused. */
export function resolveSourceRef(profile: CopyProfile, git: Git, requested?: string): string {
  git(["fetch", "--prune", "origin"]);
  if (profile === "development") {
    if (requested !== undefined && requested !== "origin/development") throw new ProfileCopyRefusedError("ref-refused", "development follows origin/development only");
    return "origin/development";
  }
  const cuts = git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/cut/"]).split("\n").filter(name => name !== "");
  if (requested !== undefined) {
    if (!cuts.includes(requested)) throw new ProfileCopyRefusedError("ref-refused", `${requested} is not a current origin/cut/* branch`);
    return requested;
  }
  if (cuts.length === 0) throw new ProfileCopyRefusedError("cut-branch-missing", "no origin/cut/* branch exists to stage");
  if (cuts.length > 1) throw new ProfileCopyRefusedError("cut-branch-ambiguous", `pick one with --ref: ${cuts.join(", ")}`);
  return cuts[0] as string;
}

/** Creates or moves the copy's detached worktree; a dirty copy is refused. */
export function syncWorktree(path: string, ref: string, mainGit: Git, gitFor: (directory: string) => Git = gitIn): string {
  if (existsSync(join(path, ".git"))) {
    const copy = gitFor(path);
    if (copy(["status", "--porcelain"]) !== "") throw new ProfileCopyRefusedError("worktree-dirty", `${path} has local changes`);
    copy(["checkout", "--detach", ref]);
  } else mainGit(["worktree", "add", "--detach", path, ref]);
  return gitFor(path)(["rev-parse", "HEAD"]);
}

export interface ProfileCopyOptions {
  readonly profile: CopyProfile;
  readonly repository: string;
  readonly copyPath: string;
  readonly sourceWorkspace: string;
  readonly targetWorkspace: string;
  readonly ref?: string;
  readonly git?: Git;
  readonly gitFor?: (directory: string) => Git;
  readonly acquire?: AcquireLock;
}

export function runProfileCopy(options: ProfileCopyOptions): Promise<string> {
  const { profile } = options, ports = runtimeProfiles[profile];
  return withProfileLock(profile, async () => {
    const git = options.git ?? gitIn(options.repository);
    const ref = resolveSourceRef(profile, git, options.ref);
    const sha = syncWorktree(options.copyPath, ref, git, options.gitFor);
    const backups = copyVerifiedBackups(options.sourceWorkspace, options.targetWorkspace);
    return [
      `profile: ${profile}`,
      `source: ${ref} @ ${sha} in ${options.copyPath}`,
      `ports: backend ${String(ports.backendPort)}, frontend ${String(ports.frontendPort)}`,
      `data: ${options.targetWorkspace}`,
      ...backups.map(backup => `backup: ${backup.profileId} ${backup.backupFileName} (generation ${String(backup.authorityGeneration)}, taken ${backup.createdAt})`),
      `start: npm ci && npm run dashboard:${profile}   (in ${options.copyPath})`,
    ].join("\n");
  }, options.acquire);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { ref: { type: "string" } } });
  const profile = z.enum(COPY_PROFILES).parse(positionals[0]);
  const copyPath = join(homedir(), "Projects", profile === "staging" ? "hr-relay-staging" : "hr-relay-dev");
  process.stdout.write(`${await runProfileCopy({
    profile, copyPath, ref: values.ref, repository: fileURLToPath(new URL("../..", import.meta.url)),
    sourceWorkspace: applicationDataWorkspace(undefined, "production"),
    targetWorkspace: applicationDataWorkspace(undefined, profile),
  })}\n`);
}
