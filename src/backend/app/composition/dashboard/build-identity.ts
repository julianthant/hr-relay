import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { systemClock } from "../../../../rules/time/clock.js";

export const DASHBOARD_BUILD_IDENTITY_FILE = "dashboard-build-identity.json";
export const DASHBOARD_BUILD_COMMAND = "npm run web:build";
export const PARITY_BUILD_COMMAND = "npm exec vite -- build --config vite.parity.config.ts";
export type DashboardBuildCommand = typeof DASHBOARD_BUILD_COMMAND | typeof PARITY_BUILD_COMMAND;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
export const DashboardBuildIdentitySchema = z.strictObject({
  stampVersion: z.literal(1),
  inputDigest: Sha256Schema,
  outputDigest: Sha256Schema,
  buildScript: z.enum([DASHBOARD_BUILD_COMMAND, PARITY_BUILD_COMMAND]),
  builtAt: z.string().datetime({ offset: true }),
});
export type DashboardBuildIdentity = z.infer<typeof DashboardBuildIdentitySchema>;

const INPUT_ROOTS = ["src"] as const;
const INPUT_FILES = [
  "config/dashboard-workflow-sources.json",
  "vite.dashboard.config.ts",
  "tsconfig.json",
  "package.json",
  "package-lock.json",
] as const;

const PARITY_INPUT_FILES = ["vite.parity.config.ts", "tests/parity/app-entry.tsx", "tests/parity/helpers/workflow-composition.ts"] as const;

function filesUnder(root: string, into: string[]): void {
  const info = lstatSync(root);
  if (!info.isDirectory()) throw new Error(`dashboard build input is not a directory: ${root}`);
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) filesUnder(path, into);
    else if (entry.isFile()) into.push(path);
    else throw new Error(`dashboard build input contains an unsafe entry: ${relative(root, path)}`);
  }
}

function digestFiles(base: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(base, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function computeDashboardBuildInputDigest(repoRoot: string, buildScript: DashboardBuildCommand = DASHBOARD_BUILD_COMMAND): string {
  const root = resolve(repoRoot);
  const files: string[] = [];
  for (const inputRoot of INPUT_ROOTS) filesUnder(join(root, inputRoot), files);
  if (buildScript === PARITY_BUILD_COMMAND) filesUnder(join(root, "tests/support/helpers/dashboard/controls"), files);
  for (const inputFile of [...INPUT_FILES, ...(buildScript === PARITY_BUILD_COMMAND ? PARITY_INPUT_FILES : [])]) {
    const path = join(root, inputFile);
    if (!lstatSync(path).isFile()) throw new Error(`dashboard build input is not a regular file: ${inputFile}`);
    files.push(path);
  }
  if (files.length === 0) throw new Error("dashboard build input scan resolved no files");
  return digestFiles(root, files.sort());
}

export function computeDashboardBuildOutputDigest(distDir: string): string {
  const root = resolve(distDir);
  const entries: { path: string; kind: "file" | "symlink"; bytes: Buffer }[] = [];
  const visit = (directory: string): void => {
    const info = lstatSync(directory);
    if (!info.isDirectory()) throw new Error("dashboard bundle root or directory is not a regular directory");
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const name = relative(root, path).split(sep).join("/");
      if (name === DASHBOARD_BUILD_IDENTITY_FILE) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) entries.push({ path: name, kind: "file", bytes: readFileSync(path) });
      else if (entry.isSymbolicLink()) entries.push({ path: name, kind: "symlink", bytes: Buffer.from(readlinkSync(path)) });
      else throw new Error(`dashboard bundle contains an unsafe entry: ${name}`);
    }
  };
  visit(root);
  if (entries.length === 0) throw new Error("dashboard bundle emitted no files");
  const hash = createHash("sha256");
  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.kind);
    hash.update("\0");
    hash.update(createHash("sha256").update(entry.bytes).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function dashboardBuildIdentityPath(distDir: string): string {
  return join(distDir, DASHBOARD_BUILD_IDENTITY_FILE);
}

export function readDashboardBuildIdentity(distDir: string): DashboardBuildIdentity | undefined {
  const path = dashboardBuildIdentityPath(distDir);
  if (!existsSync(path)) return undefined;
  if (!lstatSync(path).isFile()) throw new Error("dashboard bundle identity is not a regular file");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    throw new Error("dashboard bundle identity is unreadable", { cause: error });
  }
  return DashboardBuildIdentitySchema.parse(parsed);
}

export function writeDashboardBuildIdentity(input: Readonly<{ repoRoot: string; distDir: string; buildScript?: DashboardBuildCommand }>): DashboardBuildIdentity {
  const identity = DashboardBuildIdentitySchema.parse({
    stampVersion: 1,
    inputDigest: computeDashboardBuildInputDigest(input.repoRoot, input.buildScript),
    outputDigest: computeDashboardBuildOutputDigest(input.distDir),
    buildScript: input.buildScript ?? DASHBOARD_BUILD_COMMAND,
    builtAt: systemClock.now().toISOString(),
  });
  const path = dashboardBuildIdentityPath(input.distDir);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o644);
  try {
    writeFileSync(descriptor, `${JSON.stringify(identity, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, path);
  } catch (error: unknown) {
    unlinkSync(temporary);
    throw error;
  }
  return identity;
}

export type DashboardBuildState =
  | Readonly<{ state: "current"; identity: DashboardBuildIdentity }>
  | Readonly<{ state: "stale"; reason: string }>;

export function dashboardBuildState(input: Readonly<{ distDir: string; repoRoot: string; buildScript?: DashboardBuildCommand }>): DashboardBuildState {
  try {
    const identity = readDashboardBuildIdentity(input.distDir);
    if (identity === undefined) return { state: "stale", reason: `missing ${DASHBOARD_BUILD_IDENTITY_FILE}` };
    if (identity.buildScript !== (input.buildScript ?? DASHBOARD_BUILD_COMMAND)) return { state: "stale", reason: "bundle build command does not match the required composition" };
    const inputDigest = computeDashboardBuildInputDigest(input.repoRoot, input.buildScript);
    if (identity.inputDigest !== inputDigest) return { state: "stale", reason: "bundle inputs changed after build" };
    const outputDigest = computeDashboardBuildOutputDigest(input.distDir);
    if (identity.outputDigest !== outputDigest) return { state: "stale", reason: "bundle bytes changed after build" };
    return { state: "current", identity };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown identity error";
    return { state: "stale", reason: `invalid build identity or bundle: ${message}` };
  }
}

export function assertDashboardBuildCurrent(input: Readonly<{ distDir: string; repoRoot: string; buildScript?: DashboardBuildCommand }>): DashboardBuildIdentity {
  const result = dashboardBuildState(input);
  if (result.state === "current") return result.identity;
  throw new Error(`dashboard bundle refused: ${result.reason}; run \`${input.buildScript ?? DASHBOARD_BUILD_COMMAND}\``);
}
