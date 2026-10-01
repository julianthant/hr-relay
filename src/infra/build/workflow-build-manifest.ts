/**
 * Computes the checked-in build manifest behind `descriptor.contractFingerprint`
 * (ref workflow-model §1.1; schema in `src/domain/workflow/build-manifest.ts`).
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

/** Union of several server entry closures, still canonicalized by source path. */
export function collectSourceClosures(
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

/**
 * The workflow id a descriptor file DECLARES, read from its own source.
 *
 * D265 §1.2.2 detached the path from the id: a chunk harness now lives at
 * `src/workflows/<composition>/<step>/`, where no path segment is its id
 * (`separations/kuali-extraction/` is `separations-kuali-read`). Ids are run
 * identity and did not move with the folders, so the manifest — which every
 * descriptor looks its own fingerprint up in BY ID — has to read the id the
 * descriptor actually declares rather than infer one from where it sits.
 *
 * Fail loud on anything but exactly one string-literal `id` in exactly one
 * workflow-authoring call: the not-yet-converted harness form passes the spec
 * first to `defineWorkflowDescriptor`, and D317's authored form passes it
 * first to `defineWorkflow`. A guessed id would key a fingerprint to a
 * workflow that does not exist, and `resolveWorkflowFingerprint`'s throw would
 * then fire at load time for the workflow that does.
 *
 * Exported because `workflow-layout` (D265 arm (a)) asks the same question of
 * the same files — "which workflow does the descriptor at this path declare?" —
 * and a second reader of the same syntax is a second opinion that can drift the
 * moment either one learns about a new spelling.
 */
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

/** The two authored entry spellings a workflow folder may hold (D317 / transitional harness). */
const WORKFLOW_ENTRY_FILES = ["workflow.ts", "descriptor.ts"] as const;

function workflowEntryIn(folder: string): string | undefined {
  const present = WORKFLOW_ENTRY_FILES.map((name) => join(folder, name)).filter((entry) => existsSync(entry));
  if (present.length > 1) {
    throw new Error(`${folder} authors both workflow.ts and descriptor.ts; a folder holds exactly one workflow entry`);
  }
  return present[0];
}

/**
 * Every workflow entry under `src/workflows/`, at either depth D265 §1.2.2
 * allows: `<workflow>/` for a rail workflow, `<workflow>/<step>/` for the
 * harness that proves one of its timeline steps. D317's authored entry is
 * `workflow.ts`; a not-yet-converted harness still authors `descriptor.ts`.
 */
function descriptorFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const child = join(root, name);
    if (!statSync(child).isDirectory()) continue;
    const entry = workflowEntryIn(child);
    if (entry !== undefined) found.push(entry);
    for (const nested of readdirSync(child)) {
      const grandchild = join(child, nested);
      if (!statSync(grandchild).isDirectory()) continue;
      const nestedEntry = workflowEntryIn(grandchild);
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

/**
 * Task-impl fingerprints cover each bound implementation's server-side closure.
 * Impl binding lands with the workers in 1f; until a store declares one the
 * list is legitimately empty rather than absent.
 */
function taskEntries(
  repoRoot: string,
): readonly { readonly id: string; readonly entries: readonly string[] }[] {
  const entries: { id: string; entries: readonly string[] }[] = [];
  for (const storesRoot of [join(repoRoot, "src/backend/systems"), join(repoRoot, "src/stores")]) {
    if (!existsSync(storesRoot)) continue;
    for (const storeDirectory of readdirSync(storesRoot)) {
      const storeRoot = join(storesRoot, storeDirectory);
      if (!statSync(storeRoot).isDirectory()) continue;
      const tasksRoot = join(storeRoot, "tasks");
      if (!existsSync(tasksRoot)) continue;
      const indexPath = join(storeRoot, "index.ts");
      const indexSource = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
      const workflowMatch = /defineWorkflowStore\(\s*["']([a-z0-9]+(?:-[a-z0-9]+)*)["']/u.exec(indexSource);
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

/**
 * The BYTE arm behind the manifest gate.
 *
 * `descriptor-coverage` also compares the PARSED manifest against a fresh
 * recomputation, and that comparison is structurally blind to how the module was
 * rendered: indentation, key spacing, and the doc comment can all drift while
 * `deepEqual` stays green. A stale-on-disk file that still parses to the right
 * object is exactly the "silent drift" the root CLAUDE.md says must be a red
 * gate, so the checked-in text is compared to the generator's exact output.
 *
 * One arm, two callers — `scripts/generate-build-manifest.ts --check` and the
 * guard — so the CLI check and the gate can never disagree about what "current"
 * means.
 */
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
