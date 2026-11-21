import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it, vi } from "vitest";
import ts from "typescript";
import { ArtifactRefSchema } from "../../../src/models/artifacts/artifacts.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter } from "../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { gitVisibleFiles, REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

/** Real filesystem effects of the writer, recorded at node:fs/promises; `skipSync` drops one real fsync. */
const effects = vi.hoisted(() => ({
  trace: [] as { op: string; path: string; to?: string }[],
  skipSync: undefined as ((path: string) => boolean) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    async open(...args: Parameters<typeof actual.open>) {
      const handle = await actual.open(...args);
      const path = String(args[0]);
      effects.trace.push({ op: `open:${String(args[1])}`, path });
      const writeFile = handle.writeFile.bind(handle), sync = handle.sync.bind(handle);
      return Object.assign(handle, {
        async writeFile(...rest: Parameters<typeof handle.writeFile>) {
          await writeFile(...rest);
          effects.trace.push({ op: "write", path });
        },
        async sync() {
          if (effects.skipSync?.(path) === true) return;
          await sync();
          effects.trace.push({ op: "sync", path });
        },
      });
    },
    async link(from: string, to: string) {
      await actual.link(from, to);
      effects.trace.push({ op: "link", path: from, to });
    },
    async unlink(path: string) {
      await actual.unlink(path);
      effects.trace.push({ op: "unlink", path });
    },
  };
});

const MUTABLE_FILE_MODULES = new Set(["node:fs", "node:fs/promises", "fs", "fs/promises"]);
const MUTABLE_FILE_CALLS = new Set([
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "rename",
  "renameSync",
  "writeFile",
  "writeFileSync",
]);

function moduleText(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function isTaskImplementation(path: string): boolean {
  return /^src\/backend\/systems\/.+\/tasks\/.+\.ts$/u.test(path)
    || /^src\/backend\/processing\/.+\/tasks\/.+\.ts$/u.test(path)
    || /^src\/workflows\/.+\.ts$/u.test(path);
}

export function auditArtifactEffectBoundary(root: string): readonly string[] {
  const issues: string[] = [];
  for (const absolute of walkFiles(resolve(root, "src"), { missing: "planned-empty" })) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    if (!isTaskImplementation(path)) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(absolute, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node) && MUTABLE_FILE_MODULES.has(moduleText(node.moduleSpecifier) ?? "")) {
        issues.push(`${path}: task implementation imports mutable filesystem access`);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && MUTABLE_FILE_CALLS.has(node.expression.name.text)) {
        issues.push(`${path}: task implementation calls mutable filesystem primitive ${node.expression.name.text}`);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && MUTABLE_FILE_CALLS.has(node.expression.text)) {
        issues.push(`${path}: task implementation calls mutable filesystem primitive ${node.expression.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...new Set(issues)];
}

type Effect = (typeof effects.trace)[number];

/** Checks the writer's durable order: temp write, temp fsync, atomic link, temp removal, then directory fsync. */
function publicationOrderViolations(trace: readonly Effect[], root: string, finalPath: string): readonly string[] {
  const temp = trace.find(({ op, path }) => op === "open:wx" && path.endsWith(".tmp"))?.path;
  if (temp === undefined) return ["no temp file was opened for exclusive write"];
  const at = (match: (effect: Effect) => boolean) => trace.findIndex(match);
  const write = trace.findLastIndex(({ op, path }) => op === "write" && path === temp);
  const tempSync = trace.findIndex(({ op, path }, index) => index > write && op === "sync" && path === temp);
  const linked = at(({ op, path, to }) => op === "link" && path === temp && to === finalPath);
  const removed = at(({ op, path }) => op === "unlink" && path === temp);
  const directorySync = trace.findLastIndex(({ op, path }) => op === "sync" && path === root);
  const issues: string[] = [];
  if (write < 0) issues.push("temp file was never written");
  if (tempSync < 0) issues.push("temp file was not fsynced after its last write");
  if (linked < 0 || linked < tempSync) issues.push("artifact was linked before its temp file was fsynced");
  if (removed < 0 || removed < linked) issues.push("temp file was not removed after publication");
  if (directorySync < 0 || directorySync < Math.max(linked, removed)) issues.push("artifact directory was not fsynced after publication");
  return issues;
}

async function writeOrdered(skipSync?: (path: string, root: string) => boolean) {
  const workspace = realpathSync(await mkdtemp(join(tmpdir(), "hrauto-artifact-order-")));
  try {
    const root = join(workspace, ".tracker/data/artifacts");
    const bytes = new TextEncoder().encode("ordered artifact bytes");
    const finalPath = join(root, `${createHash("sha256").update(bytes).digest("hex")}.artifact`);
    effects.trace.length = 0;
    effects.skipSync = skipSync === undefined ? undefined : (path) => skipSync(path, root);
    const callbacks: string[] = [];
    await createContentAddressedArtifactWriter({
      admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), root),
      injectFault: (step) => { callbacks.push(step); },
    }).put(bytes, { mediaType: "text/plain" });
    return { violations: publicationOrderViolations(effects.trace, root, finalPath), callbacks, entries: readdirSync(root), finalPath, root };
  } finally {
    effects.skipSync = undefined;
    await rm(workspace, { recursive: true, force: true });
  }
}

describe("content-addressed artifact boundary", () => {
  it("keeps task implementations away from mutable filesystem primitives", () => {
    assert.deepEqual(auditArtifactEffectBoundary(REPO_ROOT), []);
    assert.ok(gitVisibleFiles(["src/workflow-kit/artifacts.ts", "src/backend/storage/artifacts"]).length >= 2);
    const refKeys = Object.keys(ArtifactRefSchema.shape).sort();
    assert.deepEqual(refKeys, ["bytes", "id", "mediaType", "sha256"]);
    assert.equal(refKeys.some((key) => /path|root|fileName/iu.test(key)), false);
  });

  it("publishes artifact bytes only after the temp file is written and synced", async () => {
    const ordered = await writeOrdered();
    assert.deepEqual(ordered.violations, []);
    assert.deepEqual(ordered.entries, [ordered.finalPath.slice(ordered.root.length + 1)]);
  });

  it("catches a skipped or reordered real fsync while the writer's callbacks still fire", async () => {
    const callbacks = ["temp-written", "temp-synced", "published", "directory-synced"];
    const noTempSync = await writeOrdered((path) => path.endsWith(".tmp"));
    assert.deepEqual(noTempSync.callbacks, callbacks);
    assert.match(noTempSync.violations.join("\n"), /not fsynced after its last write/u);
    const noDirectorySync = await writeOrdered((path, root) => path === root);
    assert.deepEqual(noDirectorySync.callbacks, callbacks);
    assert.match(noDirectorySync.violations.join("\n"), /directory was not fsynced/u);
    const root = "/artifacts", temp = `${root}/a.tmp`, finalPath = `${root}/a.artifact`;
    const linkFirst: Effect[] = [
      { op: "open:wx", path: temp }, { op: "write", path: temp }, { op: "link", path: temp, to: finalPath },
      { op: "sync", path: temp }, { op: "unlink", path: temp }, { op: "sync", path: root },
    ];
    assert.match(publicationOrderViolations(linkFirst, root, finalPath).join("\n"), /linked before its temp file was fsynced/u);
    const writeAfterSync: Effect[] = [
      { op: "open:wx", path: temp }, { op: "write", path: temp }, { op: "sync", path: temp }, { op: "write", path: temp },
      { op: "link", path: temp, to: finalPath }, { op: "unlink", path: temp }, { op: "sync", path: root },
    ];
    assert.match(publicationOrderViolations(writeAfterSync, root, finalPath).join("\n"), /not fsynced after its last write/u);
  });

  it("catches direct mutable filesystem writes in a task implementation", () => {
    const root = resolve(tmpdir(), `hrauto-artifact-boundary-${process.pid}-${Date.now()}`);
    const path = resolve(root, "src/backend/processing/extraction/tasks/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        'import { writeFile } from "node:fs/promises";\nexport async function bad() { await writeFile("output.xlsx", "unsafe"); }\n',
      );
      assert.match(auditArtifactEffectBoundary(root).join("\n"), /mutable filesystem/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches direct mutable filesystem writes in a workflow-task implementation", () => {
    const root = resolve(tmpdir(), `hrauto-workflow-task-artifact-boundary-${process.pid}-${Date.now()}`);
    const path = resolve(root, "src/workflows/person-lookup/tasks/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        'import { writeFile } from "node:fs/promises";\nexport async function bad() { await writeFile("output.xlsx", "unsafe"); }\n',
      );
      assert.match(auditArtifactEffectBoundary(root).join("\n"), /mutable filesystem/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
