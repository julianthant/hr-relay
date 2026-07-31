import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

export const REPO_ROOT = process.cwd();

/**
 * The legacy repository this rebuild replaces (D93).
 *
 * The split made isolation physical, but it did NOT end the rebuild's
 * obligations toward legacy: D90 change accounting, D58 capability
 * disposition, the legacy-test disposition inventory, and the environment /
 * runtime-dependency inventories all describe LEGACY reality and must read it.
 * Doc 07 §4 requires that accounting to survive cross-repo "keyed by the legacy
 * repo's commit hashes" — which is only possible if this repo can find that
 * repo.
 *
 * Resolution is explicit and FAILS LOUD. There is no "legacy not found, skip
 * the check" path: doc 10 §3.13 makes this accounting "the program's only drift
 * detector" now that the same-tree scan is retired, so a silently-skipped
 * legacy audit is precisely the failure mode that would let legacy drift go
 * unnoticed.
 *
 * `HRAUTO_LEGACY_REPO` overrides the default sibling checkout.
 */
function resolveLegacyRepoRoot(): string {
  const configured = process.env.HRAUTO_LEGACY_REPO;
  const root = configured === undefined || configured.trim() === ""
    ? resolve(REPO_ROOT, "..", "hr-automation")
    : resolve(configured);
  const source = configured === undefined || configured.trim() === ""
    ? "default sibling checkout ../hr-automation"
    : "HRAUTO_LEGACY_REPO";
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(
      `Legacy repository not found at ${root} (${source}). The rebuild's D90 change accounting, D58 capability disposition, and environment/runtime-dependency inventories all audit the legacy repo; set HRAUTO_LEGACY_REPO to its checkout.`,
    );
  }
  if (!existsSync(resolve(root, ".git"))) {
    throw new Error(`Legacy repository at ${root} (${source}) is not a git checkout; change accounting reads its commit history.`);
  }
  return root;
}

export const LEGACY_REPO_ROOT = resolveLegacyRepoRoot();

/**
 * Path scheme for the two roots this repo audits.
 *
 * After D93 both repositories have a `src/` — `src/cli.ts` exists in BOTH — so
 * a bare repo-relative path is ambiguous across them. Every inventory entry
 * that names a LEGACY file therefore carries an explicit `legacy:` scheme;
 * unprefixed paths are always this repo's.
 */
export const LEGACY_PATH_PREFIX = "legacy:";

export function isLegacyPath(path: string): boolean {
  return path.startsWith(LEGACY_PATH_PREFIX);
}

export function legacyPathTail(path: string): string {
  return isLegacyPath(path) ? path.slice(LEGACY_PATH_PREFIX.length) : path;
}

/** Absolute location of a scheme-qualified path in whichever repo owns it. */
export function resolveScopedPath(path: string): string {
  return isLegacyPath(path)
    ? resolve(LEGACY_REPO_ROOT, legacyPathTail(path))
    : resolve(REPO_ROOT, path);
}

export interface WalkFilesOptions {
  readonly extensions?: readonly string[];
  readonly missing?: "error" | "planned-empty";
}

/**
 * Deterministic recursive file walk shared by architecture guards.
 *
 * Missing roots fail by default. The only permitted soft-missing mode is the
 * explicitly named pre-activation state used while `src` does not yet
 * exist; callers must still prove non-vacuity once that root is activated.
 */
export function walkFiles(
  root: string,
  options: WalkFilesOptions = {},
): string[] {
  const extensions = options.extensions ?? [".ts", ".tsx"];
  if (!existsSync(root)) {
    if (options.missing === "planned-empty") return [];
    throw new Error(`Architecture guard scan root does not exist: ${root}`);
  }

  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, options));
    } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

export function repoRelative(path: string): string {
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

/**
 * Repository-visible files: tracked files plus non-ignored untracked files.
 *
 * Architecture inventories use this instead of the raw filesystem so ignored
 * OS artifacts and empty local scratch directories cannot make a clean
 * worktree behave differently from an isolated Git worktree.
 */
export function gitVisibleFiles(paths: readonly string[]): string[] {
  return gitVisibleFilesIn(REPO_ROOT, paths);
}

/** The same inventory, taken in an explicit repository root. */
export function gitVisibleFilesIn(root: string, paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...paths],
    { cwd: root, encoding: "utf8" },
  ).trim().split("\n").filter(Boolean).sort();
}

/** Legacy-repo file inventory, returned with the `legacy:` scheme applied. */
export function legacyGitVisibleFiles(paths: readonly string[]): string[] {
  return gitVisibleFilesIn(LEGACY_REPO_ROOT, paths).map((path) => `${LEGACY_PATH_PREFIX}${path}`);
}

export interface CountAllowlistEntry {
  readonly count: number;
  readonly reason: string;
}

export type CountAllowlist = Readonly<Record<string, CountAllowlistEntry>>;

export interface CountAllowlistMessages {
  readonly unallowlisted: (file: string, count: number) => string;
  readonly changed: (file: string, expected: number, actual: number) => string;
  readonly stale: (file: string, expected: number) => string;
}

/** Fail-both-ways audit for the architecture suite's reviewed count ratchets. */
export function auditCountAllowlist(
  found: ReadonlyMap<string, number>,
  allowlist: CountAllowlist,
  messages: CountAllowlistMessages,
): string[] {
  const violations: string[] = [];

  for (const [file, count] of found) {
    const entry = allowlist[file];
    if (!entry) {
      violations.push(messages.unallowlisted(file, count));
      continue;
    }
    if (entry.count !== count) {
      violations.push(messages.changed(file, entry.count, count));
    }
  }

  for (const [file, entry] of Object.entries(allowlist)) {
    if (!found.has(file)) violations.push(messages.stale(file, entry.count));
    if (!entry.reason.trim()) {
      violations.push(`${file}: allowlist reason must be non-empty.`);
    }
    if (!Number.isInteger(entry.count) || entry.count <= 0) {
      violations.push(`${file}: allowlist count must be a positive integer.`);
    }
  }

  return violations;
}
