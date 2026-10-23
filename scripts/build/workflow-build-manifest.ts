/** Hashes canonical (path, content) tuples plus the installed toolchain so any checkout matches; type-only imports count because a type change is a contract change, and the generated module is excluded so the hash reaches a fixed point. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { canonicalJsonStringify } from "../../src/rules/validation/canonical-json.js";
import { FingerprintSchema, TaskIdSchema, WorkflowIdSchema } from "../../src/rules/identity/ids.js";
import {
  BUILD_MANIFEST_PATH,
  BuildManifestSchema,
  parseBuildManifest,
} from "../../src/models/workflow/build-manifest.js";
import type { BuildManifest, SourceHash } from "../../src/models/workflow/build-manifest.js";

const MANIFEST_VERSION = 1;

function posix(path: string): string {
  return path.split("\\").join("/");
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Installed, not declared: a caret range is not a locked toolchain. */
function installedVersion(repoRoot: string, packageName: string): string {
  const manifestPath = join(repoRoot, "node_modules", packageName, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`build manifest requires ${packageName} to be installed; ${manifestPath} is missing`);
  }
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  return z.strictObject({ version: z.string().min(1) }).loose().parse(parsed).version;
}

function relativeSpecifiers(sourcePath: string, content: string): readonly string[] {
  const source = ts.createSourceFile(sourcePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers.filter((specifier) => specifier.startsWith("."));
}

function resolveSource(fromFile: string, specifier: string): string {
  const base = resolve(fromFile, "..", specifier);
  const candidates = specifier.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`build manifest cannot resolve "${specifier}" from ${fromFile}`);
  }
  return found;
}

const closureSources = new Map<string, { content: string; sha256: SourceHash["sha256"]; specifiers: readonly string[] }>();

/** The closure, sorted by repo-relative path so iteration order cannot leak into the hash. */
export function collectSourceClosure(repoRoot: string, entry: string): readonly SourceHash[] {
  const manifestModule = resolve(repoRoot, BUILD_MANIFEST_PATH);
  const seen = new Set<string>();
  const sources: SourceHash[] = [];
  const pending = [resolve(entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file) || file === manifestModule) continue;
    seen.add(file);
    const content = readFileSync(file, "utf8");
    let cached = closureSources.get(file);
    if (cached?.content !== content) {
      cached = { content, sha256: FingerprintSchema.parse(sha256(content)), specifiers: relativeSpecifiers(file, content) };
      closureSources.set(file, cached);
    }
    sources.push({ path: posix(relative(repoRoot, file)), sha256: cached.sha256 });
    for (const specifier of cached.specifiers) {
      pending.push(resolveSource(file, specifier));
    }
  }
  return sources.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/** Union of several server entry closures, still canonicalized by source path. */
function collectSourceClosures(
  repoRoot: string,
  entries: readonly string[],
): readonly SourceHash[] {
  const byPath = new Map<string, SourceHash>();
  for (const entry of entries) {
    for (const source of collectSourceClosure(repoRoot, entry)) byPath.set(source.path, source);
  }
  return [...byPath.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

export function fingerprintSourceSet(
  toolchain: BuildManifest["toolchain"],
  id: string,
  sources: readonly SourceHash[],
): string {
  return sha256(canonicalJsonStringify({
    kind: "hrauto-rebuild-build-manifest",
    manifestVersion: MANIFEST_VERSION,
    toolchain: { typescript: toolchain.typescript, zod: toolchain.zod },
    id,
    sources: sources.map(({ path, sha256: hash }) => ({ path, sha256: hash })),
  }));
}

/** Reads the id a descriptor declares, never one inferred from its folder; `workflow-layout` shares this parser so the two readers cannot drift. */
export function declaredWorkflowId(entry: string): string {
  const source = ts.createSourceFile(
    entry, readFileSync(entry, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ids: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const specIndex = node.expression.text === "defineWorkflowDescriptor"
        || node.expression.text === "defineWorkflow"
        ? 0
        : undefined;
      const spec = specIndex === undefined ? undefined : node.arguments[specIndex];
      if (spec !== undefined && ts.isObjectLiteralExpression(spec)) {
        for (const property of spec.properties) {
          if (ts.isPropertyAssignment(property)
            && ts.isIdentifier(property.name)
            && property.name.text === "id"
            && ts.isStringLiteral(property.initializer)) {
            ids.push(property.initializer.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const [only] = ids;
  if (ids.length !== 1 || only === undefined) {
    throw new Error(
      `build manifest needs exactly one string-literal descriptor id in ${entry}; found ${String(ids.length)}`,
    );
  }
  return only;
}

/** The authored entry spelling follows the workflow's role and folder depth. */
const WORKFLOW_ENTRY_FILES = ["workflow.ts", "step.ts"] as const;

function workflowEntryIn(folder: string): string | undefined {
  const present = WORKFLOW_ENTRY_FILES.map((name) => join(folder, name)).filter((entry) => existsSync(entry));
  if (present.length > 1) {
    throw new Error(`${folder} authors both workflow.ts and step.ts; a folder holds exactly one workflow entry`);
  }
  return present[0];
}

function descriptorFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const child = join(root, name);
    if (!statSync(child).isDirectory()) continue;
    const entry = workflowEntryIn(child);
    if (entry !== undefined) found.push(entry);
    const steps = join(child, "steps");
    if (!existsSync(steps)) continue;
    for (const nested of readdirSync(steps)) {
      const step = join(steps, nested);
      if (!statSync(step).isDirectory()) continue;
      const nestedEntry = workflowEntryIn(step);
      if (nestedEntry !== undefined) found.push(nestedEntry);
    }
  }
  return found;
}

function descriptorEntries(repoRoot: string): readonly { readonly id: string; readonly entry: string }[] {
  return descriptorFiles(join(repoRoot, "src/workflows"))
    .map((entry) => ({ id: declaredWorkflowId(entry), entry }))
    .sort((left, right) => left.id < right.id ? -1 : 1);
}

/** Server-side impl closures; an empty list is legitimate when no store declares one, not a missing binding. */
function taskEntries(
  repoRoot: string,
): readonly { readonly id: string; readonly entries: readonly string[] }[] {
  const entries: { id: string; entries: readonly string[] }[] = [];
  for (const storesRoot of [
    join(repoRoot, "src/backend/systems"),
    join(repoRoot, "src/backend/processing"),
    join(repoRoot, "src/workflows"),
  ]) {
    if (!existsSync(storesRoot)) continue;
    for (const storeDirectory of readdirSync(storesRoot)) {
      const storeRoot = join(storesRoot, storeDirectory);
      if (!statSync(storeRoot).isDirectory()) continue;
      const tasksRoot = join(storeRoot, "tasks");
      if (!existsSync(tasksRoot)) continue;
      const registryPath = join(storeRoot, "task-registry.ts");
      const registrationSource = readFileSync(registryPath, "utf8");
      const workflowMatch = /defineWorkflowStore\(\s*["']([a-z0-9]+(?:-[a-z0-9]+)*)["']/u.exec(registrationSource);
      const namespace = workflowMatch === null ? storeDirectory : `workflow:${workflowMatch[1]}`;
      const driverEntry = join(storeRoot, "driver/interpreter.ts");
      for (const file of readdirSync(tasksRoot)) {
        if (!file.endsWith(".ts")) continue;
        entries.push({
          id: `${namespace}/${file.slice(0, -3)}`,
          entries: [
            join(tasksRoot, file),
            ...(workflowMatch === null && existsSync(driverEntry) ? [driverEntry] : []),
          ],
        });
      }
    }
  }
  return entries.sort((left, right) => left.id < right.id ? -1 : 1);
}

export function computeBuildManifest(repoRoot: string): BuildManifest {
  const toolchain = {
    typescript: installedVersion(repoRoot, "typescript"),
    zod: installedVersion(repoRoot, "zod"),
  };
  const workflows = descriptorEntries(repoRoot).map(({ id, entry }) => {
    const sources = collectSourceClosure(repoRoot, entry);
    return {
      id: WorkflowIdSchema.parse(id),
      fingerprint: FingerprintSchema.parse(fingerprintSourceSet(toolchain, id, sources)),
      sources,
    };
  });
  const tasks = taskEntries(repoRoot).map(({ id, entries }) => {
    const sources = collectSourceClosures(repoRoot, entries);
    return {
      id: TaskIdSchema.parse(id),
      fingerprint: FingerprintSchema.parse(fingerprintSourceSet(toolchain, id, sources)),
      sources,
    };
  });
  return parseBuildManifest({
    kind: "hrauto-rebuild-build-manifest",
    manifestVersion: MANIFEST_VERSION,
    toolchain,
    workflows,
    tasks,
  });
}

/** Rendered under `src/workflow-kit/validation/**` so a descriptor can value-import its fingerprint while staying browser-safe. */
export function renderBuildManifestModule(manifest: BuildManifest): string {
  BuildManifestSchema.parse(manifest);
  return [
    "/** Generated by npm run build:manifest; do not edit by hand. */",
    "",
    `export const GENERATED_BUILD_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;`,
    "",
  ].join("\n");
}

/** Byte check: parsed equality misses rendered drift, and the CLI `--check` and the guard share it. */
export function auditBuildManifestBytes(
  current: string,
  manifest: BuildManifest,
): readonly string[] {
  const rendered = renderBuildManifestModule(manifest);
  if (current === rendered) return [];
  return [
    `${BUILD_MANIFEST_PATH} is stale on disk (${String(current.length)} bytes checked in, `
    + `${String(rendered.length)} bytes generated) — run \`npm run build:manifest\` and commit the result`,
  ];
}
