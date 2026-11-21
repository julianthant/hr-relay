import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { ArtifactRefSchema } from "../../../src/models/artifacts/artifacts.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import {
  createContentAddressedArtifactWriter,
  type ArtifactWriteFaultStep,
} from "../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { gitVisibleFiles, REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

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

interface PublicationStep {
  readonly step: ArtifactWriteFaultStep;
  readonly final: boolean;
  readonly temps: number;
}

const PUBLICATION_ORDER: readonly ArtifactWriteFaultStep[] = ["temp-written", "temp-synced", "published", "directory-synced"];

/** Checks an observed write trace: bytes stay invisible until the synced temp file is published, and no temp survives. */
function publicationOrderViolations(trace: readonly PublicationStep[]): readonly string[] {
  const issues: string[] = [];
  if (trace.map(({ step }) => step).join(",") !== PUBLICATION_ORDER.join(",")) {
    issues.push(`write steps ran in order ${trace.map(({ step }) => step).join(",")}`);
  }
  for (const { step, final, temps } of trace) {
    const published = step === "published" || step === "directory-synced";
    if (final !== published) issues.push(`final artifact ${final ? "visible" : "missing"} at ${step}`);
    if (!published && temps !== 1) issues.push(`expected one temp file at ${step}, found ${String(temps)}`);
    if (step === "directory-synced" && temps !== 0) issues.push(`temp file left after ${step}`);
  }
  return issues;
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
    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-order-"));
    try {
      const artifactRoot = join(workspace, ".tracker/data/artifacts");
      const bytes = new TextEncoder().encode("ordered artifact bytes");
      const finalName = `${createHash("sha256").update(bytes).digest("hex")}.artifact`;
      const trace: PublicationStep[] = [];
      const writer = createContentAddressedArtifactWriter({
        admission: RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), artifactRoot),
        injectFault(step) {
          const entries = readdirSync(artifactRoot);
          trace.push({ step, final: entries.includes(finalName), temps: entries.filter((entry) => entry.endsWith(".tmp")).length });
        },
      });
      await writer.put(bytes, { mediaType: "text/plain" });
      assert.deepEqual(publicationOrderViolations(trace), []);
      assert.deepEqual(readdirSync(artifactRoot), [finalName]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("catches an artifact made visible before its temp file is synced", () => {
    const ordered: readonly PublicationStep[] = [
      { step: "temp-written", final: false, temps: 1 },
      { step: "temp-synced", final: false, temps: 1 },
      { step: "published", final: true, temps: 1 },
      { step: "directory-synced", final: true, temps: 0 },
    ];
    assert.deepEqual(publicationOrderViolations(ordered), []);
    assert.match(publicationOrderViolations(ordered.map((entry) => entry.step === "temp-synced" ? { ...entry, final: true } : entry))
      .join("\n"), /visible at temp-synced/u);
    assert.match(publicationOrderViolations([ordered[0], ordered[2], ordered[1], ordered[3]].filter((entry): entry is PublicationStep => entry !== undefined))
      .join("\n"), /order/u);
    assert.match(publicationOrderViolations(ordered.map((entry) => entry.step === "directory-synced" ? { ...entry, temps: 1 } : entry))
      .join("\n"), /temp file left/u);
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
