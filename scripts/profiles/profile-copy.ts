import { execFileSync, execSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { RuntimeAlreadyRunningError, acquireRuntimeLifetimeLock, type RuntimeLifetimeLock } from "../../src/backend/storage/admission/lifetime-lock.js";
import { hasUnprovedSourceClosure } from "../../src/backend/storage/source-closure.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { systemClock } from "../../src/rules/time/clock.js";

const CopyProfileSchema = z.enum(["staging", "development"]);
type CopyProfile = z.infer<typeof CopyProfileSchema>;

class ProfileCopyRefusedError extends Error {
  constructor(code: string, detail: string) { super(`${code}: ${detail}`); this.name = "ProfileCopyRefusedError"; }
}

interface ImportOptions {
  readonly sourceWorkspace: string;
  readonly targetWorkspace: string;
  readonly sourceProfile: string;
}

export async function importProfileLibrary(options: ImportOptions, lock: RuntimeLifetimeLock) {
  const { targetWorkspace, sourceWorkspace } = options;
  const sourceProfile = z.uuid().parse(options.sourceProfile);
  const { applicationDataWorkspace, rebuildRuntimeIsolation } = await import("../../src/backend/app/config/runtime-isolation.js");
  const production = applicationDataWorkspace(undefined, "production");
  const offset = relative(production, targetWorkspace);
  if (lock.port === runtimeProfiles.production.lockPort || targetWorkspace === sourceWorkspace
    || !isAbsolute(offset) && offset.split(sep)[0] !== ".."
    || existsSync(targetWorkspace) && realpathSync(targetWorkspace) !== targetWorkspace) {
    throw new ProfileCopyRefusedError("destination-not-isolated", "Use the copy's dedicated data folder and lifetime lock.");
  }
  if (!existsSync(join(targetWorkspace, ".tracker", "control", "installation.json"))) {
    throw new ProfileCopyRefusedError("destination-signup-required", "Start the copy, finish its own Duo signup, stop it, then rerun.");
  }
  const { importIsolatedProfileData, parseIsolatedImportBackupManifest } = await import("../../src/backend/storage/maintenance/isolated-library-import.js");
  const directory = join(sourceWorkspace, rebuildRuntimeIsolation.stateRoot, "profiles", sourceProfile, "backups", "authority");
  const backups = (existsSync(directory) ? readdirSync(directory) : []).filter(name => name.endsWith(".sqlite.manifest.json"))
    .map(name => ({ name, manifest: parseIsolatedImportBackupManifest(join(directory, name)) }))
    .sort((a, b) => Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt)
      || b.manifest.authorityGeneration - a.manifest.authorityGeneration || b.name.localeCompare(a.name));
  const newest = backups[0];
  if (newest === undefined) throw new ProfileCopyRefusedError("source-backup-missing", "Let the chosen production profile take an in-session backup, then rerun.");
  const binding = { installationId: newest.manifest.installationId, profileId: sourceProfile };
  if (newest.manifest.profileId !== sourceProfile || newest.name !== `${newest.manifest.backupFileName}.manifest.json`) {
    throw new ProfileCopyRefusedError("source-backup-mismatch", "The newest backup does not match the chosen production profile.");
  }

  const [{ acquireEntrypointAdmission }, { createCredentialStore }, { AuthorityDatabase }, { openLogDatabases }] = await Promise.all([
    import("../../src/backend/storage/admission/bootstrap-admission.js"),
    import("../../src/backend/storage/configuration/credential-store.js"),
    import("../../src/backend/storage/sqlite/authority-database.js"),
    import("../../src/backend/storage/sqlite/profile-local-databases.js"),
  ]);
  const machine = acquireEntrypointAdmission(targetWorkspace, "exclusive", lock);
  try {
    const { activeProfileId } = machine.readProfileRegistry();
    if (activeProfileId === null) throw new ProfileCopyRefusedError("destination-sign-in-required", "Sign in to the isolated profile and quit the dashboard without signing out.");
    const admission = machine.admitProfile(activeProfileId);
    try {
      const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
      const database = AuthorityDatabase.open(admission, {
        path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "isolated-library-import",
      }, systemClock, undefined, undefined, undefined, credentials);
      try {
        const report = await importIsolatedProfileData(admission, database, {
          source: { manifestPath: join(directory, newest.name), binding }, destination: admission.profileBinding,
        });
        const logs = openLogDatabases(join(admission.stateRoot, "state.db"), admission.stateRoot);
        try { logs.reconcile(); } finally { logs.close(); }
        return report;
      } finally { database.close(); }
    } finally { admission.release(); }
  } finally { machine.release(); }
}

export type Git = (args: readonly string[]) => string;
const gitIn = (directory: string): Git => args => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();

export function resolveSourceRef(profile: CopyProfile, git: Git): string {
  git(["fetch", "--prune", "origin"]);
  return `origin/${profile}`;
}

function syncWorktree(path: string, sha: string, mainGit: Git, gitFor: (directory: string) => Git): void {
  const copy = gitFor(path), gitFile = join(path, ".git");
  if (existsSync(path) && realpathSync(path) !== path) {
    throw new ProfileCopyRefusedError("worktree-unowned", "The copy path must not resolve through a symlink.");
  }
  if (existsSync(gitFile)) {
    if (!lstatSync(gitFile).isFile()
      || copy(["rev-parse", "--path-format=absolute", "--git-common-dir"]) !== mainGit(["rev-parse", "--path-format=absolute", "--git-common-dir"])
      || copy(["branch", "--show-current"]) !== "") {
      throw new ProfileCopyRefusedError("worktree-unowned", "The copy path must be this repository's detached worktree.");
    }
    if (copy(["status", "--porcelain"]) !== "") throw new ProfileCopyRefusedError("worktree-dirty", "Preserve the copy's local changes before updating.");
    copy(["checkout", "--detach", sha]);
  } else {
    mainGit(["worktree", "add", "--detach", path, sha]);
  }
  if (copy(["rev-parse", "HEAD"]) !== sha) throw new ProfileCopyRefusedError("worktree-sha-mismatch", "The copy did not check out the selected commit.");
}

interface ProfileCopyOptions {
  readonly profile: CopyProfile;
  readonly repository: string;
  readonly copyPath: string;
  readonly sourceWorkspace: string;
  readonly targetWorkspace: string;
  readonly sourceProfile?: string;
  readonly git?: Git;
  readonly gitFor?: (directory: string) => Git;
  readonly acquire?: typeof acquireRuntimeLifetimeLock;
  readonly install?: (directory: string) => void;
}

const PackageScriptsSchema = z.object({ scripts: z.record(z.string(), z.string()) });

export async function runProfileCopy(options: ProfileCopyOptions): Promise<string> {
  const { profile, sourceProfile } = options, ports = runtimeProfiles[profile];
  let lock: RuntimeLifetimeLock;
  try { lock = await (options.acquire ?? acquireRuntimeLifetimeLock)(ports.lockPort); }
  catch (error) {
    if (error instanceof RuntimeAlreadyRunningError) throw new ProfileCopyRefusedError("profile-running", `Stop the ${profile} dashboard or wait for the other update to finish.`);
    throw error;
  }
  let retain = false;
  try {
    if (realpathSync(options.repository) === options.copyPath) {
      throw new ProfileCopyRefusedError("worktree-in-use", "Run this command from a different Relay checkout.");
    }
    const git = options.git ?? gitIn(options.repository);
    const ref = resolveSourceRef(profile, git);
    const sha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
    const { scripts } = PackageScriptsSchema.parse(JSON.parse(git(["show", `${sha}:package.json`])));
    if (scripts[`dashboard:${profile}`] === undefined) {
      throw new ProfileCopyRefusedError("profile-launcher-missing", `${ref} must contain the ${profile} dashboard launcher before it can be used as an isolated copy.`);
    }
    syncWorktree(options.copyPath, sha, git, options.gitFor ?? gitIn);
    const install = options.install ?? (directory => {
      if (process.platform === "win32") execSync("npm ci", { cwd: directory, stdio: "inherit" });
      else execFileSync("npm", ["ci"], { cwd: directory, stdio: "inherit" });
    });
    install(options.copyPath);
    const imported = sourceProfile === undefined ? undefined : await importProfileLibrary({ ...options, sourceProfile }, lock);
    return [
      `profile: ${profile}`,
      `source: ${ref} @ ${sha} in ${options.copyPath}`,
      `ports: backend ${String(ports.backendPort)}, frontend ${String(ports.frontendPort)}, lock ${String(ports.lockPort)}`,
      `data: ${options.targetWorkspace}`,
      imported === undefined ? "workbooks: finish isolated Duo signup, stop the copy, then rerun with --source-person <production profile UUID>"
        : `workbooks: ${String(imported.created)} created, ${String(imported.refreshed)} refreshed, ${String(imported.unchanged)} unchanged, ${String(imported.keptLocal)} kept local (backup generation ${String(imported.sourceBackup.authorityGeneration)})`,
      ...(imported === undefined ? [] : [`history: ${String(imported.history.runs)} runs, ${String(imported.history.timeline_events)} timeline events, ${String(imported.history.notifications)} notifications`]),
      `start: npm run dashboard:${profile}   (in ${options.copyPath})`,
    ].join("\n");
  } catch (error) {
    retain = hasUnprovedSourceClosure(error);
    throw error;
  } finally { if (!retain) await lock.close(); }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { "source-person": { type: "string" } } });
  const [profile] = z.tuple([CopyProfileSchema]).parse(positionals);
  const sourceProfile = z.uuid().optional().parse(values["source-person"]);
  // Runtime isolation and key custody bind the profile at module initialization.
  process.env[RUNTIME_PROFILE_ENV] = profile;
  const { applicationDataWorkspace } = await import("../../src/backend/app/config/runtime-isolation.js");
  const copyPath = join(homedir(), "Projects", profile === "staging" ? "hr-relay-staging" : "hr-relay-dev");
  process.stdout.write(`${await runProfileCopy({
    profile, copyPath, sourceProfile, repository: fileURLToPath(new URL("../..", import.meta.url)),
    sourceWorkspace: applicationDataWorkspace(undefined, "production"),
    targetWorkspace: applicationDataWorkspace(undefined, profile),
  })}\n`);
}
