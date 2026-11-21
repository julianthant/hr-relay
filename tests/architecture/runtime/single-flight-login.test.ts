import { createGuardProgram } from "../../support/helpers/caching-compiler-host.js";

import assert from "node:assert/strict";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/rules/time/clock.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";
import {
  healthyUcpathDriver,
  sessionFactoryHarness,
  sessionManagerFor,
} from "../../support/helpers/phase1f-executor-harness.js";

const SESSION_MODULE = "src/workflow-kit/session.ts";
const LOGIN_OWNER = "src/backend/runtime/workers/worker-sessions.ts";
const PROGRAM_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  jsx: ts.JsxEmit.ReactJSX,
  skipLibCheck: true,
};

function repoPath(file: string): string {
  return relative(REPO_ROOT, file).replaceAll("\\", "/");
}

function isSessionLogin(symbol: ts.Symbol | undefined): boolean {
  return symbol?.name === "login" && (symbol.declarations ?? [])
    .some((declaration) => repoPath(declaration.getSourceFile().fileName) === SESSION_MODULE);
}

/** Every reference to the session provider's login member, by resolved symbol rather than spelling. */
function sessionLoginReferences(program: ts.Program, files: readonly string[]): readonly string[] {
  const checker = program.getTypeChecker();
  const member = (owner: ts.Node, name: string) => checker.getTypeAtLocation(owner).getProperty(name);
  const references: string[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error(`missing parsed source ${repoPath(file)}`);
    const at = (node: ts.Node) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      references.push(`${repoPath(file)}:${String(line + 1)}`);
    };
    const literalKey = (node: ts.Node): string | undefined => {
      if (ts.isStringLiteralLike(node)) return node.text;
      const type = checker.getTypeAtLocation(ts.isComputedPropertyName(node) ? node.expression : node);
      return type.isStringLiteral() ? type.value : undefined;
    };
    const keyOf = (node: ts.Node): string | undefined => ts.isIdentifier(node) ? node.text : literalKey(node);
    const visit = (node: ts.Node): void => {
      // The member name belongs to the interface, so filtering on it first keeps the checker work small.
      if (ts.isPropertyAccessExpression(node) && node.name.text === "login"
        && isSessionLogin(checker.getSymbolAtLocation(node.name))) at(node);
      if (ts.isElementAccessExpression(node)) {
        const key = literalKey(node.argumentExpression);
        if (key === "login" && isSessionLogin(member(node.expression, key))) at(node);
      }
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const key = keyOf(node.propertyName ?? node.name);
        if (key === "login" && isSessionLogin(member(node.parent, key))) at(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return references;
}

function sourceFiles(): readonly string[] {
  return walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] });
}

describe("single-flight login", () => {
  it("keeps session login invocation inside the worker session manager", () => {
    const files = sourceFiles();
    const references = sessionLoginReferences(createGuardProgram(files, PROGRAM_OPTIONS), files);
    assert.deepEqual(references.filter((reference) => !reference.startsWith(`${LOGIN_OWNER}:`)), [],
      "a login path outside the session manager appeared");
    assert.ok(references.some((reference) => reference.startsWith(`${LOGIN_OWNER}:`)),
      "the manager must own the one login call");
  });

  it("finds a login call reached through a renamed binding", () => {
    const files = sourceFiles();
    const host = join(REPO_ROOT, "src/backend/runtime/workers/worker-loop.ts");
    const rogue = `${ts.sys.readFile(host) ?? ""}
import type { SessionProvider as Provider } from "../../../workflow-kit/session.js";
export function renamedDestructure(provider: Provider<"ucpath">) { const { login: signIn } = provider; return signIn; }
export function renamedReceiver(provider: Provider<"ucpath">) { const auth = provider; return auth.login; }
export function computedKey(provider: Provider<"ucpath">) { const key = "login" as const; return provider[key]; }
`;
    const program = createGuardProgram(files, PROGRAM_OPTIONS, new Map([[host, rogue]]));
    const outside = sessionLoginReferences(program, files)
      .filter((reference) => reference.startsWith("src/backend/runtime/workers/worker-loop.ts:"));
    assert.equal(outside.length, 3, `every renamed login spelling must be found: ${outside.join(", ")}`);
  });

  it("authenticates once for two concurrent leases on one worker/system", async () => {
    const harness = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver() });
    const manager = await sessionManagerFor(harness, manualClock(new Date("2026-08-03T09:00:00.000Z")));
    const need = { system: "ucpath", access: "read", session: "reuse-worker" } as const;
    const signal = new AbortController().signal;
    const order: string[] = [];
    await Promise.all([
      manager.withDriver(need, "prod", signal, async () => {
        order.push("first");
      }),
      manager.withDriver(need, "prod", signal, async () => {
        order.push("second");
      }),
    ]);
    assert.deepEqual(order, ["first", "second"], "leases must serialize, not interleave");
    assert.equal(harness.opens("ucpath"), 1, "one session open for both leases");
    assert.equal(harness.logins(), 1, "exactly one login for both leases");
  });
});
