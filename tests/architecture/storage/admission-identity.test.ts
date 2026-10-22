import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

const owner = "src/backend/storage/admission/admission.ts";
const identity = "src/backend/storage/admission/admission-identity.ts";
const credentialCycleEdges = new Set([
  "src/backend/storage/configuration/credential-store.ts",
  "src/backend/storage/configuration/chatgpt-credential-repository.ts",
  "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
]);

function audit(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const findings: string[] = [];
  const registrations = new Set<string>();
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && credentialCycleEdges.has(file)
      && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith("admission/admission.js")
      && node.importClause?.isTypeOnly !== true) findings.push(`${file}: runtime credential admission cycle`);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith("admission-identity.js")) {
      if (ts.isExportDeclaration(node)) findings.push(`${file}: admission identity re-export`);
      else {
        const bindings = node.importClause?.namedBindings;
        if (node.importClause?.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings)) findings.push(`${file}: indirect identity import`);
        else for (const binding of bindings.elements) {
          const imported = binding.propertyName?.text ?? binding.name.text;
          if (imported === "registerRuntimeAdmission") {
            registrations.add(binding.name.text);
            if (file !== owner || binding.name.text !== imported || binding.isTypeOnly) findings.push(`${file}: foreign identity issuer`);
          } else if (imported !== "requireRuntimeAdmission") findings.push(`${file}: unknown identity import`);
        }
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument) && argument.text.endsWith("admission-identity.js")) findings.push(`${file}: dynamic identity import`);
    }
    if (ts.isIdentifier(node) && registrations.has(node.text) && !ts.isImportSpecifier(node.parent)) {
      if (!ts.isCallExpression(node.parent) || node.parent.expression !== node) findings.push(`${file}: escaped identity registration`);
      else {
        calls += 1;
        let enclosing: ts.Node | undefined = node.parent.parent;
        while (enclosing !== undefined && !ts.isConstructorDeclaration(enclosing) && !ts.isFunctionLike(enclosing)) enclosing = enclosing.parent;
        if (file !== owner || enclosing === undefined || !ts.isConstructorDeclaration(enclosing)
          || !ts.isClassDeclaration(enclosing.parent) || enclosing.parent.name?.text !== "RuntimeAdmission"
          || node.parent.arguments.length !== 1 || node.parent.arguments[0]?.kind !== ts.SyntaxKind.ThisKeyword) findings.push(`${file}: nonconstructor identity registration`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (file === owner && (registrations.size !== 1 || calls !== 1)) findings.push(`${file}: constructor registration membership`);
  if (file === identity) {
    const imports = source.statements.filter(ts.isImportDeclaration);
    if (imports.length !== 1 || imports[0]?.importClause?.isTypeOnly !== true) findings.push(`${file}: runtime identity dependency`);
  }
  return findings;
}

it("keeps issuance in the token-protected RuntimeAdmission constructor and identity dependencies type-only", () => {
  const findings = gitVisibleFiles(["src", "tests", "scripts"]).filter(file => /\.tsx?$/u.test(file)).flatMap(file => audit(file, readFileSync(resolve(REPO_ROOT, file), "utf8")));
  assert.deepEqual(findings, []);
  const source = readFileSync(resolve(REPO_ROOT, owner), "utf8");
  assert.ok(source.indexOf('if (token !== issuanceToken)') < source.indexOf("registerRuntimeAdmission(this)"));
});

it("rejects foreign, escaped, aliased, dynamic and nonconstructor registration mutations", () => {
  const prefix = 'import { registerRuntimeAdmission } from "./admission-identity.js";';
  for (const [file, text] of [
    ["src/forged.ts", `${prefix} registerRuntimeAdmission({});`],
    [owner, `${prefix} export const issue = registerRuntimeAdmission;`],
    [owner, 'import { registerRuntimeAdmission as issue } from "./admission-identity.js"; issue({});'],
    [owner, `${prefix} function forge() { registerRuntimeAdmission(this); }`],
    ["src/forged.ts", 'export * from "./admission-identity.js";'],
    ["src/forged.ts", 'import("./admission-identity.js");'],
    [identity, 'import { RuntimeAdmission } from "./admission.js";'],
  ]) assert.ok(audit(file, text).length > 0, file);
});

it("removes credential admission edges at the declaration under verbatim module emit", () => {
  const mixed = 'import { type RuntimeAdmission } from "../admission/admission.js";';
  const erased = 'import type { RuntimeAdmission } from "../admission/admission.js";';
  const emit = (text: string) => ts.transpileModule(text, { compilerOptions: {
    module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true,
  } }).outputText;
  assert.match(emit(mixed), /import \{\s*\} from/u);
  assert.doesNotMatch(emit(erased), /from/u);
  for (const file of credentialCycleEdges) {
    assert.deepEqual(audit(file, erased), []);
    assert.match(audit(file, mixed).join("\n"), /runtime credential admission cycle/u);
  }
});
