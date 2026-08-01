/**
 * Computes the checked-in build manifest behind `descriptor.contractFingerprint`
 * (doc 02 §1.1; schema in `src/domain/workflow/build-manifest.ts`).
 *
 * The hash covers canonical `(repo-relative path, file content)` tuples for a
 * descriptor module and its transitive relative-import closure, plus the
 * INSTALLED TypeScript and zod versions. Deliberately excluded: absolute paths,
 * mtimes, build timestamps, object iteration order, and any minified function
 * text. So the same source in another checkout hashes identically, while a
 * `bind`/`identity`/`derive` edit changes the fingerprint even though its output
 * zod schema did not — which is the whole point, because a checkpoint written
 * under the old bind semantics must not silently replay under the new ones.
 *
 * Type-only imports are inside the closure on purpose. They do not ship, but a
 * changed type IS a changed contract, and a fingerprint that ignored them would
 * call two semantically different descriptors compatible.
 *
 * The generated module is excluded from every closure: a manifest that hashed
 * its own contents could never reach a fixed point.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { FingerprintSchema, TaskIdSchema, WorkflowIdSchema } from "../../domain/ids.js";
import {
  BUILD_MANIFEST_PATH,
  BuildManifestSchema,
  parseBuildManifest,
} from "../../domain/workflow/build-manifest.js";
import type { BuildManifest, SourceHash } from "../../domain/workflow/build-manifest.js";

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
    sources.push({
      path: posix(relative(repoRoot, file)),
      sha256: FingerprintSchema.parse(sha256(content)),
    });
    for (const specifier of relativeSpecifiers(file, content)) {
      pending.push(resolveSource(file, specifier));
    }
  }
  return sources.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function fingerprintOf(
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

function descriptorEntries(repoRoot: string): readonly { readonly id: string; readonly entry: string }[] {
  const root = join(repoRoot, "src/workflows");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .map((name) => ({ id: name, entry: join(root, name, "descriptor.ts") }))
    .filter((candidate) => existsSync(candidate.entry))
    .sort((left, right) => left.id < right.id ? -1 : 1);
}

/**
 * Task-impl fingerprints cover each bound implementation's server-side closure.
 * Impl binding lands with the workers in 1f; until a store declares one the
 * list is legitimately empty rather than absent.
 */
function taskEntries(repoRoot: string): readonly { readonly id: string; readonly entry: string }[] {
  const storesRoot = join(repoRoot, "src/stores");
  if (!existsSync(storesRoot)) return [];
  const entries: { id: string; entry: string }[] = [];
  for (const system of readdirSync(storesRoot)) {
    const tasksRoot = join(storesRoot, system, "tasks");
    if (!existsSync(tasksRoot)) continue;
    for (const file of readdirSync(tasksRoot)) {
      if (!file.endsWith(".ts")) continue;
      entries.push({ id: `${system}/${file.slice(0, -3)}`, entry: join(tasksRoot, file) });
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
      fingerprint: FingerprintSchema.parse(fingerprintOf(toolchain, id, sources)),
      sources,
    };
  });
  const tasks = taskEntries(repoRoot).map(({ id, entry }) => {
    const sources = collectSourceClosure(repoRoot, entry);
    return {
      id: TaskIdSchema.parse(id),
      fingerprint: FingerprintSchema.parse(fingerprintOf(toolchain, id, sources)),
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

/**
 * Render the checked-in module. It lives under `src/domain/**` so a descriptor
 * can value-import its own fingerprint without reaching outside the bundle-safe
 * set, and so the diff is reviewable in the same commit as the change that
 * moved it.
 */
export function renderBuildManifestModule(manifest: BuildManifest): string {
  BuildManifestSchema.parse(manifest);
  return [
    "/**",
    " * GENERATED — run `npm run build:manifest`. Do not edit by hand.",
    " *",
    " * Descriptor and task-impl fingerprints over canonical (path, content)",
    " * tuples plus the locked toolchain. `descriptor-coverage` regenerates this",
    " * file and fails on any diff.",
    " */",
    "",
    `export const GENERATED_BUILD_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;`,
    "",
  ].join("\n");
}
