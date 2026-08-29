import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, normalize as normalizePath } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import {
  auditCountAllowlist,
  gitVisibleFiles,
  REPO_ROOT,
  type CountAllowlist,
} from "./helpers/guard-files.js";

/**
 * Guard (ref clock-config-secrets §5): a secret VALUE never reaches a diagnostic string.
 *
 * Ref clock-config-secrets pairs `secrets-single-source` (who may read a credential) with this
 * one (what may be said about it): a ratchet "flagging `log.*`/template-literal
 * interpolation of identifiers named `password`/`privateKey`/`credential`/
 * `secret` (case-insensitive) ... catching an accidental
 * ``log.info(`login as ${password}`)``".
 *
 * Why an interpolation and not a type check: ref clock-config-secrets's redaction contract only
 * protects values that travel as CLASSIFIED fields into
 * `redactDiagnosticFields`. The moment a credential is spliced into a string it
 * has become an opaque message body, the classification is gone, and every
 * downstream note/failure/screenshot-metadata/bundle/notification writer copies
 * it verbatim. That is unrecoverable — the value is already on disk before
 * anyone reads the line.
 *
 * Scope. Both halves of the doc's rule:
 *
 * - EVERY template-literal interpolation in `src/**`, because a template
 *   is how a value escapes classification regardless of who consumes it (a
 *   thrown `Error` message is as durable as a log line — see the
 *   `SecretMissingError` messages in `domain/secrets.ts`, which deliberately
 *   name only the KEY).
 * - EVERY argument to a `log.*` / `console.*` call, so a bare
 *   `log.info(password)` is caught even without a template.
 *
 * A name is sensitive when its normalized form (lowercased, separators
 * stripped) contains a credential-ish root. Name-shaped companions are
 * exempted by suffix — `secretName`, `secretNames`, `credentialPath`,
 * `tokenCount` describe a credential without being one; `secretValue` or
 * `passwordText` do not get that pass.
 *
 * This is a RATCHET with the standard shrink-only `Record<file,{count,reason}>`
 * allowlist, deliberately EMPTY today: no rebuild file interpolates a
 * credential-named binding, and new `src` code gets zero tolerance.
 */

const SENSITIVE_ROOTS = [
  "password", "passwd", "passphrase", "secret", "credential", "privatekey",
  "apikey", "accesskey", "authtoken", "bearertoken", "sessiontoken", "refreshtoken",
  "cookie", "storagestate", "ssn",
] as const;

/** Person values whose canonical binding names do not contain a credential root. */
const DIRECT_IDENTIFIER_BINDING_NAMES = new Set([
  "approvableeids",
  "approvedemplid",
  "bindingeid",
  "candidateeids",
  "crmeid",
  "datesobservedeid",
  "displayedeid",
  "displayedeidafterstage",
  "displayedeidraw",
  "disagreeing",
  "disagreeingname",
  "documenteid",
  "documenteidinput",
  "documenteidsecretvalue",
  "documenteidtext",
  "documenteidvalue",
  "eid",
  "eidsuffix",
  "employeeeid",
  "employeeid",
  "employeename",
  "emplid",
  "expectedeid",
  "expectedeidinput",
  "expectedname",
  "fulleid",
  "idempotencykey",
  "matchedeid",
  "namesearcheid",
  "naturalkey",
  "observedeid",
  "observedemployeeid",
  "outputeid",
  "parsedeid",
  "ppseid",
  "permanentkey",
  "queriedeid",
  "raweid",
  "recordobservedeid",
  "roweid",
  "sweepsubjectemplid",
  "timekeepername",
  "tieeids",
  "unreadableeid",
]);

function isDirectIdentifierBindingName(name: string): boolean {
  return DIRECT_IDENTIFIER_BINDING_NAMES.has(normalize(name));
}

/**
 * Suffixes that make a binding a DESCRIPTOR of a credential rather than the
 * credential itself. `secretName`, `credentialPath`, and `credentialDependencyId`
 * are exactly what a legible fail-loud message is supposed to name.
 *
 * `key`/`keys` are deliberately ABSENT: `apiKey`, `secretKey`, and `privateKey`
 * all carry the value. So is `state` — `storageState` is a credential, not a
 * description of one.
 */
const DESCRIPTOR_SUFFIXES = [
  "name", "names", "id", "ids", "path", "paths", "prefix", "prefixes",
  "file", "files", "family", "families", "spec", "specs", "env", "envs",
  "count", "length", "label", "labels", "kind", "type", "classification",
  "field", "fields", "schema", "policy", "poll", "polls", "pollms",
] as const;

function normalize(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function isDescriptorSuffixed(normalized: string, root: string): boolean {
  return DESCRIPTOR_SUFFIXES.some((suffix) =>
    normalized.endsWith(suffix) && normalized.length > root.length);
}

function isCredentialDescriptorBindingName(name: string): boolean {
  const normalized = normalize(name);
  const root = SENSITIVE_ROOTS.find((candidate) => normalized.includes(candidate));
  return root !== undefined && isDescriptorSuffixed(normalized, root);
}

export function isSensitiveBindingName(name: string): boolean {
  const normalized = normalize(name);
  if (isDirectIdentifierBindingName(name)) return true;
  const root = SENSITIVE_ROOTS.find((candidate) => normalized.includes(candidate));
  if (root === undefined) return false;
  return !isDescriptorSuffixed(normalized, root);
}

/** The name an expression would be reported under, or undefined when it has none. */
function bindingName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)) return expression.argumentExpression.text;
  if (ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return bindingName(expression.expression);
  if (ts.isCallExpression(expression)) return bindingName(expression.expression);
  // `dependency.secretNames ?? []` still describes `secretNames`.
  if (ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return bindingName(expression.left);
  return undefined;
}

const CANONICAL_REDACTION_MODULE = "src/domain/redaction.ts";
const CANONICAL_SANITIZER_EXPORTS = new Set([
  "directIdentifierDigestReference",
  "redactedEvidenceId",
]);
const CANONICAL_WORKFLOW_MODULE = "src/base/workflow.ts";
const CANONICAL_DESCRIPTOR_FACTORY_EXPORTS = new Set(["defineWorkflowDescriptor"]);

function importedCanonicalBindings(
  path: string,
  source: ts.SourceFile,
  canonicalModule: string,
  canonicalExports: ReadonlySet<string>,
): ReadonlySet<string> {
  const imported = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly
      || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const resolved = normalizePath(join(dirname(path), statement.moduleSpecifier.text))
      .replace(/\.js$/u, ".ts");
    if (resolved !== canonicalModule) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = element.propertyName?.text ?? element.name.text;
      if (canonicalExports.has(importedName)) imported.add(element.name.text);
    }
  }

  return imported;
}

function importedCanonicalSanitizers(path: string, source: ts.SourceFile): ReadonlySet<string> {
  return importedCanonicalBindings(
    path,
    source,
    CANONICAL_REDACTION_MODULE,
    CANONICAL_SANITIZER_EXPORTS,
  );
}

/**
 * Find one sensitive value carried by an interpolation expression. Calls and
 * conditionals need expression-aware inspection: `String(eid)`,
 * `candidateEids.join(", ")`, and `ok ? eid : ""` all retain the identifier
 * even though their outermost binding names do not.
 */
function sensitiveBindingInExpression(
  expression: ts.Expression,
  sensitive: (name: string, expression: ts.Expression) => boolean,
  isCanonicalSanitizer: (expression: ts.Expression) => boolean,
  followUnknownCallArguments = true,
): string | undefined {
  if (ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return sensitiveBindingInExpression(
      expression.expression,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
    );
  }
  if (ts.isConditionalExpression(expression)) {
    return sensitiveBindingInExpression(
      expression.whenTrue,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
    ) ?? sensitiveBindingInExpression(
      expression.whenFalse,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
    );
  }
  if (ts.isBinaryExpression(expression)) {
    return sensitiveBindingInExpression(
      expression.left,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
    ) ?? sensitiveBindingInExpression(
      expression.right,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
    );
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        const found = sensitiveBindingInExpression(
          element.expression,
          sensitive,
          isCanonicalSanitizer,
          followUnknownCallArguments,
        );
        if (found !== undefined) return found;
      } else if (ts.isExpression(element)) {
        const found = sensitiveBindingInExpression(
          element,
          sensitive,
          isCanonicalSanitizer,
          followUnknownCallArguments,
        );
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
  if (ts.isCallExpression(expression)) {
    if (isCanonicalSanitizer(expression.expression)) return undefined;
    if (ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.name.text === "map"
      && expression.arguments.some((argument) =>
        isCanonicalSanitizer(argument))) return undefined;

    const callee = bindingName(expression.expression);
    if (callee !== undefined && sensitive(callee, expression.expression)) return callee;
    if (ts.isPropertyAccessExpression(expression.expression)) {
      const receiver = sensitiveBindingInExpression(
        expression.expression.expression,
        sensitive,
        isCanonicalSanitizer,
        followUnknownCallArguments,
      );
      if (receiver !== undefined) return receiver;
    }
    const transparentlyCarriesArguments = ts.isIdentifier(expression.expression)
      && expression.expression.text === "String"
      || ts.isPropertyAccessExpression(expression.expression)
        && expression.expression.name.text === "stringify";
    if (followUnknownCallArguments || transparentlyCarriesArguments) {
      for (const argument of expression.arguments) {
        const found = sensitiveBindingInExpression(
          argument,
          sensitive,
          isCanonicalSanitizer,
          followUnknownCallArguments,
        );
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  const name = bindingName(expression);
  return name !== undefined && sensitive(name, expression) ? name : undefined;
}

interface AliasBinding {
  readonly name: string;
  readonly node: ts.Node;
  readonly scope: ts.Node;
  readonly sourceExpression?: ts.Expression;
  readonly sourceName?: string;
}

function lexicalScope(node: ts.Node): ts.Node {
  let ancestor: ts.Node | undefined = node.parent;
  while (ancestor !== undefined && !ts.isSourceFile(ancestor)) {
    if (ts.isFunctionLike(ancestor) || ts.isBlock(ancestor)) return ancestor;
    ancestor = ancestor.parent;
  }
  return ancestor ?? node.getSourceFile();
}

function aliasBindings(source: ts.SourceFile): readonly AliasBinding[] {
  const bindings: AliasBinding[] = [];
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      bindings.push({
        name: node.name.text,
        node,
        scope: lexicalScope(node),
        ...(node.initializer === undefined ? {} : { sourceExpression: node.initializer }),
      });
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      bindings.push({ name: node.name.text, node, scope: lexicalScope(node) });
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      const property = node.propertyName;
      bindings.push({
        name: node.name.text,
        node,
        scope: lexicalScope(node),
        sourceName: property !== undefined
          && (ts.isIdentifier(property) || ts.isStringLiteralLike(property))
          ? property.text
          : node.name.text,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return bindings;
}

function bindingForIdentifier(
  identifier: ts.Identifier,
  bindings: readonly AliasBinding[],
): AliasBinding | undefined {
  const position = identifier.getStart();
  return bindings
    .filter((binding) => binding.name === identifier.text
      && binding.node.getStart() <= position
      && binding.scope.getStart() <= position
      && binding.scope.end >= identifier.end)
    .sort((left, right) => {
      const leftWidth = left.scope.end - left.scope.getStart();
      const rightWidth = right.scope.end - right.scope.getStart();
      return leftWidth - rightWidth || right.node.getStart() - left.node.getStart();
    })[0];
}

/**
 * Loop variables drawn from a descriptor COLLECTION are descriptors themselves:
 * `for (const secret of dependency.secretNames)` iterates names, so the bare
 * `secret` binding cannot be a value even though its name reads like one.
 * Collected per file — a ratchet's precision floor, not a type system.
 */
function descriptorLoopBindings(source: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const source = bindingName(node.expression);
      const isDescriptorCollection = source !== undefined
        && SENSITIVE_ROOTS.some((root) => normalize(source).includes(root))
        && !isSensitiveBindingName(source);
      if (isDescriptorCollection) {
        for (const declaration of node.initializer.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return names;
}

type DiagnosticSinkKind = "all-arguments" | "second-argument";

function directDiagnosticSinkKind(expression: ts.Expression): DiagnosticSinkKind | undefined {
  if (ts.isIdentifier(expression) && expression.text === "Error") return "all-arguments";
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const receiver = expression.expression;
  if (ts.isIdentifier(receiver) && ["log", "console", "logger"].includes(receiver.text)) {
    return "all-arguments";
  }
  if (expression.name.text === "fail" && bindingName(receiver) === "ctx") return "second-argument";
  return undefined;
}

function diagnosticSinkAliases(source: ts.SourceFile): ReadonlyMap<string, DiagnosticSinkKind> {
  const aliases = new Map<string, DiagnosticSinkKind>();
  let changed = true;
  while (changed) {
    changed = false;
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && node.initializer !== undefined) {
        const kind = directDiagnosticSinkKind(node.initializer)
          ?? (ts.isIdentifier(node.initializer) ? aliases.get(node.initializer.text) : undefined);
        if (kind !== undefined && aliases.get(node.name.text) !== kind) {
          aliases.set(node.name.text, kind);
          changed = true;
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
        && node.initializer !== undefined && bindingName(node.initializer) === "ctx") {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const property = element.propertyName !== undefined
            && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
            ? element.propertyName.text
            : element.name.text;
          if (property === "fail" && aliases.get(element.name.text) !== "second-argument") {
            aliases.set(element.name.text, "second-argument");
            changed = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return aliases;
}

function diagnosticSinkKind(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, DiagnosticSinkKind>,
): DiagnosticSinkKind | undefined {
  return directDiagnosticSinkKind(expression)
    ?? (ts.isIdentifier(expression) ? aliases.get(expression.text) : undefined);
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function enclosingPresentationCallback(
  node: ts.Node,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  let ancestor: ts.Node | undefined = node.parent;
  while (ancestor !== undefined && !ts.isSourceFile(ancestor)) {
    if (ts.isArrowFunction(ancestor) || ts.isFunctionExpression(ancestor)) return ancestor;
    ancestor = ancestor.parent;
  }
  return undefined;
}

function isWithin(node: ts.Node, expression: ts.Expression): boolean {
  return node.pos >= expression.pos && node.end <= expression.end;
}

/** Descriptor title/subtitle callbacks are typed UI projection, not diagnostics. */
function isCanonicalDescriptorSpecObject(
  object: ts.ObjectLiteralExpression,
  isCanonicalDescriptorFactory: (expression: ts.Expression) => boolean,
): boolean {
  const call = object.parent;
  return ts.isCallExpression(call)
    && call.arguments.length === 1
    && call.arguments[0] === object
    && isCanonicalDescriptorFactory(call.expression);
}

function isDescriptorCallbackTemplateSpan(
  node: ts.TemplateSpan,
  isCanonicalDescriptorFactory: (expression: ts.Expression) => boolean,
  sectionName: "identity" | "presentation",
  callbackNames: ReadonlySet<string>,
): boolean {
  const callback = enclosingPresentationCallback(node);
  if (callback === undefined || !ts.isPropertyAssignment(callback.parent)) return false;
  if (!callbackNames.has(propertyNameText(callback.parent.name) ?? "")) return false;
  const sectionObject = callback.parent.parent;
  const sectionProperty = sectionObject.parent;
  if (!ts.isObjectLiteralExpression(sectionObject)
    || !ts.isPropertyAssignment(sectionProperty)
    || propertyNameText(sectionProperty.name) !== sectionName) return false;
  const descriptorSpec = sectionProperty.parent;
  if (!ts.isObjectLiteralExpression(descriptorSpec)
    || !isCanonicalDescriptorSpecObject(descriptorSpec, isCanonicalDescriptorFactory)) return false;

  if (!ts.isBlock(callback.body)) return isWithin(node, callback.body);
  return callback.body.statements.some((statement) =>
    ts.isReturnStatement(statement)
    && statement.expression !== undefined
    && isWithin(node, statement.expression));
}

function isDescriptorPresentationTemplateSpan(
  node: ts.TemplateSpan,
  isCanonicalDescriptorFactory: (expression: ts.Expression) => boolean,
): boolean {
  return isDescriptorCallbackTemplateSpan(
    node,
    isCanonicalDescriptorFactory,
    "presentation",
    new Set(["title", "subtitle"]),
  );
}

function isDescriptorIdentityTemplateSpan(
  node: ts.TemplateSpan,
  isCanonicalDescriptorFactory: (expression: ts.Expression) => boolean,
): boolean {
  return isDescriptorCallbackTemplateSpan(
    node,
    isCanonicalDescriptorFactory,
    "identity",
    new Set(["matchKey"]),
  );
}

export function findSecretInterpolations(path: string, content: string): readonly string[] {
  const source = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  const descriptors = descriptorLoopBindings(source);
  const canonicalSanitizerImports = importedCanonicalSanitizers(path, source);
  const descriptorFactoryImports = importedCanonicalBindings(
    path,
    source,
    CANONICAL_WORKFLOW_MODULE,
    CANONICAL_DESCRIPTOR_FACTORY_EXPORTS,
  );
  const bindings = aliasBindings(source);
  const resolvesImportedBinding = (expression: ts.Expression, imports: ReadonlySet<string>): boolean =>
    ts.isIdentifier(expression)
    && imports.has(expression.text)
    && bindingForIdentifier(expression, bindings) === undefined;
  const isCanonicalSanitizer = (expression: ts.Expression): boolean =>
    resolvesImportedBinding(expression, canonicalSanitizerImports);
  const isCanonicalDescriptorFactory = (expression: ts.Expression): boolean =>
    resolvesImportedBinding(expression, descriptorFactoryImports);
  const resolvingAliases = new Set<ts.Node>();
  const baseSensitive = (name: string): boolean => !descriptors.has(name) && isSensitiveBindingName(name);
  const sensitive = (name: string, expression: ts.Expression): boolean => {
    if (baseSensitive(name)) return true;
    if (isCredentialDescriptorBindingName(name)) return false;
    if (!ts.isIdentifier(expression)) return false;
    const binding = bindingForIdentifier(expression, bindings);
    if (binding === undefined || resolvingAliases.has(binding.node)) return false;
    if (binding.sourceName !== undefined) return baseSensitive(binding.sourceName);
    if (binding.sourceExpression === undefined) return false;
    resolvingAliases.add(binding.node);
    const resolved = sensitiveBindingInExpression(
      binding.sourceExpression,
      sensitive,
      isCanonicalSanitizer,
      false,
    ) !== undefined;
    resolvingAliases.delete(binding.node);
    return resolved;
  };
  const sinkAliases = diagnosticSinkAliases(source);

  function report(node: ts.Node, name: string, why: string): void {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push(`${path}:${String(position.line + 1)}:${String(position.character + 1)}: ${why} ${name}`);
  }

  function visit(node: ts.Node): void {
    if (ts.isTemplateSpan(node)) {
      const name = sensitiveBindingInExpression(node.expression, sensitive, isCanonicalSanitizer);
      if (name !== undefined
        && (!isDirectIdentifierBindingName(name)
          || (!isDescriptorPresentationTemplateSpan(node, isCanonicalDescriptorFactory)
            && !isDescriptorIdentityTemplateSpan(node, isCanonicalDescriptorFactory)))) {
        report(node.expression, name, "template interpolates credential-named");
      }
    }
    if (ts.isCallExpression(node)) {
      const sinkKind = diagnosticSinkKind(node.expression, sinkAliases);
      const diagnosticArguments = sinkKind === "second-argument"
        ? node.arguments.slice(1, 2)
        : sinkKind === "all-arguments" ? node.arguments : [];
      for (const argument of diagnosticArguments) {
        const name = sensitiveBindingInExpression(argument, sensitive, isCanonicalSanitizer);
        if (name !== undefined) {
          report(argument, name, "diagnostic sink receives credential-named");
        }
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === "Error") {
      for (const argument of node.arguments ?? []) {
        const name = sensitiveBindingInExpression(argument, sensitive, isCanonicalSanitizer);
        if (name !== undefined) report(argument, name, "diagnostic sink receives credential-named");
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

function rebuildSources(): readonly string[] {
  return gitVisibleFiles(["src"]).filter((path) => /\.[cm]?[jt]sx?$/.test(path));
}

function rebuildViolations(): readonly string[] {
  return rebuildSources().flatMap((path) =>
    findSecretInterpolations(path, readFileSync(join(REPO_ROOT, path), "utf8")));
}

/** file (relative to repo root) -> { count, reason }; empty = no reviewed exception. */
const ALLOWLIST: CountAllowlist = {};

describe("no secret values in logs", () => {
  it("scans a non-vacuous rebuild tree that actually contains interpolated diagnostics", () => {
    const files = rebuildSources();
    assert.equal(files.length > 0, true, "src resolved zero scannable source files");

    // The scanner must be looking at real templates: `domain/secrets.ts` builds
    // its fail-loud messages by interpolation, so a zero-template result means
    // the walker broke, not that the tree is clean.
    const templates = files.filter((path) =>
      readFileSync(join(REPO_ROOT, path), "utf8").includes("${"));
    assert.equal(templates.includes("src/domain/secrets.ts"), true);
    assert.equal(templates.length > 1, true);
  });

  it("keeps every rebuild diagnostic free of credential-named interpolation", () => {
    assert.deepEqual(rebuildViolations(), []);
  });

  it("keeps the reviewed allowlist shrink-only and non-stale", () => {
    const counts = new Map<string, number>();
    for (const violation of rebuildViolations()) {
      const file = violation.slice(0, violation.indexOf(":"));
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    assert.deepEqual(
      auditCountAllowlist(counts, ALLOWLIST, {
        unallowlisted: (file, count) => `${file}: ${String(count)} credential-named interpolation(s); pass a classified field to the redaction contract instead.`,
        changed: (file, expected, actual) => `${file}: allowlisted ${String(expected)} interpolation(s) but found ${String(actual)}.`,
        stale: (file, expected) => `${file}: allowlist claims ${String(expected)} interpolation(s) but none remain; drop the entry.`,
      }),
      [],
    );
  });

  it("flags templates, person-secret values, property reads, and bare diagnostic arguments", () => {
    const violations = findSecretInterpolations("src/core/leak.ts", [
      "declare const log: { info(message: unknown): void };",
      "export function leak(password: string, employeeName: string, timekeeperName: string,",
      "  employeeNameSecretValue: string, timekeeperNameSecretValue: string,",
      "  auth: { apiKey: string; secretValue: string }) {",
      "  log.info(`login as ${password}`);",
      "  log.info(`employee ${employeeName}`);",
      "  log.info(`timekeeper ${timekeeperName}`);",
      "  log.info(`employee ${employeeNameSecretValue}`);",
      "  log.info(`timekeeper ${timekeeperNameSecretValue}`);",
      "  log.info(`key ${auth.apiKey}`);",
      '  log.info(`state ${auth["secretValue"]}`);',
      "  log.info(password);",
      "  console.error(auth.apiKey);",
      "  throw new Error(`could not authenticate with ${password}`);",
      "}",
    ].join("\n"));
    assert.equal(violations.length, 10, violations.join("\n"));
    assert.equal(violations.filter((violation) => violation.includes("template interpolates")).length, 8);
    assert.equal(violations.filter((violation) => violation.includes("diagnostic sink receives")).length, 2);
  });

  it("flags the closed EID binding family in templates and diagnostic arguments", () => {
    const eidBindings = [
      "eid",
      "emplId",
      "documentEid",
      "documentEidText",
      "documentEidValue",
      "employeeId",
      "employeeEid",
      "approvedEmplId",
      "bindingEid",
      "candidateEids",
      "crmEid",
      "datesObservedEid",
      "displayedEid",
      "expectedEid",
      "fullEid",
      "matchedEid",
      "nameSearchEid",
      "observedEid",
      "observedEmployeeId",
      "outputEid",
      "parsedEid",
      "ppsEid",
      "queriedEid",
      "rawEid",
      "recordObservedEid",
      "rowEid",
      "sweepSubjectEmplId",
      "unreadableEid",
      "eidSuffix",
    ] as const;
    for (const binding of eidBindings) assert.equal(isSensitiveBindingName(binding), true, binding);

    const violations = findSecretInterpolations("src/core/eid-leak.ts", [
      "declare const log: { info(message: unknown): void };",
      "export function leak(eid: string, input: { emplId: string; documentEid: string; employeeId: string; candidateEids: string[]; observedEmployeeId: string }) {",
      "  log.info(`subject ${eid}`);",
      "  throw new Error(`expected ${input.emplId}; document ${input.documentEid}`);",
      "  console.error(input.employeeId);",
      "  log.info(`candidates ${input.candidateEids.join(\", \")}`);",
      "  log.info(`observed ${input.observedEmployeeId}`);",
      "  log.info(`conditional ${eid.length === 8 ? eid : \"\"}`);",
      "  log.info(`coerced ${String(input.emplId)}`);",
      "}",
    ].join("\n"));
    assert.equal(violations.length, 8, violations.join("\n"));
  });

  it("exempts only a canonical imported redaction helper, including an import alias", () => {
    assert.deepEqual(findSecretInterpolations("src/core/safe.ts", [
      'import { directIdentifierDigestReference as safeReference } from "../domain/redaction.js";',
      "export function safe(eid: string) {",
      "  throw new Error(`subject ${safeReference(eid)}`);",
      "}",
    ].join("\n")), []);

    const localSpoof = findSecretInterpolations("src/core/spoof.ts", [
      "function directIdentifierDigestReference(value: string): string { return value; }",
      "export function leak(eid: string) {",
      "  throw new Error(`subject ${directIdentifierDigestReference(eid)}`);",
      "}",
    ].join("\n"));
    assert.equal(localSpoof.length, 1, localSpoof.join("\n"));

    const shadowedImport = findSecretInterpolations("src/core/shadow.ts", [
      'import { directIdentifierDigestReference as safeReference } from "../domain/redaction.js";',
      "export function leak(eid: string, safeReference: (value: string) => string) {",
      "  throw new Error(`subject ${safeReference(eid)}`);",
      "}",
    ].join("\n"));
    assert.equal(shadowedImport.length, 1, shadowedImport.join("\n"));

    const mixedScopes = findSecretInterpolations("src/core/mixed-scopes.ts", [
      'import { directIdentifierDigestReference as safeReference } from "../domain/redaction.js";',
      "export function safe(eid: string) {",
      "  throw new Error(`subject ${safeReference(eid)}`);",
      "}",
      "export function leak(eid: string, safeReference: (value: string) => string) {",
      "  throw new Error(`subject ${safeReference(eid)}`);",
      "}",
    ].join("\n"));
    assert.equal(mixedScopes.length, 1, mixedScopes.join("\n"));
  });

  it("exempts only a descriptor presentation callback's direct return expression", () => {
    assert.deepEqual(findSecretInterpolations("src/workflows/example/descriptor.ts", [
      'import { defineWorkflowDescriptor } from "../../base/workflow.js";',
      "export const descriptor = defineWorkflowDescriptor({",
      "  presentation: {",
      "    title: (input: { emplId: string }) => `EID ${input.emplId}` ,",
      "    subtitle: (input: { eid: string; show: boolean }) => (input.show ? `EID ${input.eid}` : undefined),",
      "  },",
      "});",
    ].join("\n")), []);

    const violations = findSecretInterpolations("src/workflows/example/descriptor.ts", [
      'import { defineWorkflowDescriptor } from "../../base/workflow.js";',
      "export const descriptor = defineWorkflowDescriptor({",
      "  presentation: {",
      "    title: (input: { emplId: string }) => {",
      "      const diagnostic = `unexpected ${input.emplId}`;",
      "      return diagnostic;",
      "    },",
      "    subtitle: (input: { eid: string }) => [input.eid].map((eid) => `nested ${eid}`).join(\"\"),",
      "  },",
      "});",
    ].join("\n"));
    assert.equal(violations.length, 2, violations.join("\n"));

    const lookalike = findSecretInterpolations("src/workflows/example/descriptor.ts", [
      "export const descriptor = {",
      "  presentation: { title: (input: { emplId: string }) => `EID ${input.emplId}` },",
      "};",
    ].join("\n"));
    assert.equal(lookalike.length, 1, lookalike.join("\n"));

    const shadowedFactory = findSecretInterpolations("src/workflows/example/descriptor.ts", [
      'import { defineWorkflowDescriptor as defineDescriptor } from "../../base/workflow.js";',
      "export function spoof(defineDescriptor: (value: unknown) => unknown, emplId: string) {",
      "  return defineDescriptor({ presentation: { title: () => `EID ${emplId}` } });",
      "}",
    ].join("\n"));
    assert.equal(shadowedFactory.length, 1, shadowedFactory.join("\n"));
  });

  it("exempts a durable match key only on the canonical descriptor identity argument", () => {
    assert.deepEqual(findSecretInterpolations("src/workflows/example/descriptor.ts", [
      'import { defineWorkflowDescriptor } from "../../base/workflow.js";',
      "export const descriptor = defineWorkflowDescriptor({",
      "  identity: { matchKey: (input: { emplId: string }) => `eid:${input.emplId}` },",
      "});",
    ].join("\n")), []);

    const lookalike = findSecretInterpolations("src/workflows/example/descriptor.ts", [
      "export const descriptor = {",
      "  identity: { matchKey: (input: { emplId: string }) => `eid:${input.emplId}` },",
      "};",
    ].join("\n"));
    assert.equal(lookalike.length, 1, lookalike.join("\n"));
  });

  it("follows aliases into concatenation, join, Error, ctx.fail, and an aliased sink", () => {
    const violations = findSecretInterpolations("src/core/alias-leak.ts", [
      "export function leak(",
      "  eid: string, expectedName: string, candidateEids: string[],",
      "  ctx: { fail(code: string, message: string): never },",
      ") {",
      "  const alias = eid;",
      "  const renamed = alias;",
      "  const fail = ctx.fail;",
      '  const concatenated = "subject " + renamed;',
      '  const joined = candidateEids.join(", ");',
      "  new Error(expectedName);",
      "  new Error(concatenated);",
      "  new Error(joined);",
      "  Error(eid);",
      '  ctx.fail("subject-mismatch", renamed);',
      '  fail("subject-mismatch", expectedName);',
      "}",
    ].join("\n"));

    assert.equal(violations.length, 6, violations.join("\n"));
  });

  it("follows an authority-only natural key through a neutral alias into a diagnostic", () => {
    const violations = findSecretInterpolations("src/core/key-leak.ts", [
      "export function leak(idempotencyKey: string) {",
      "  const key = idempotencyKey;",
      "  throw new Error(`fenced ${key}`);",
      "}",
    ].join("\n"));

    assert.equal(violations.length, 1, violations.join("\n"));
  });

  it("permits descriptor names that identify a credential without carrying it", () => {
    assert.deepEqual(findSecretInterpolations("src/domain/ok.ts", [
      "declare const log: { info(message: unknown): void };",
      "export function report(spec: { env: string; secretName: string }, credentialPath: string, tokenCount: number) {",
      "  log.info(`missing ${spec.secretName} (${spec.env})`);",
      "  log.info(`credential file ${credentialPath}; ${String(tokenCount)} entries`);",
      "}",
    ].join("\n")), []);

    assert.equal(isSensitiveBindingName("secretName"), false);
    assert.equal(isSensitiveBindingName("credentialPath"), false);
    assert.equal(isSensitiveBindingName("credentialDependencyId"), false);
    assert.equal(isSensitiveBindingName("secretFamily"), false);
    // Value-carrying names that merely LOOK structural stay sensitive.
    assert.equal(isSensitiveBindingName("apiKeys"), true);
    assert.equal(isSensitiveBindingName("secretKey"), true);
    assert.equal(isSensitiveBindingName("privateKey"), true);
    assert.equal(isSensitiveBindingName("UCPATH_PASSWORD"), true);
    assert.equal(isSensitiveBindingName("storageState"), true);
    assert.equal(isSensitiveBindingName("employeeName"), true);
    assert.equal(isSensitiveBindingName("timekeeperName"), true);
    assert.equal(isSensitiveBindingName("employeeNameSecretValue"), true);
    assert.equal(isSensitiveBindingName("timekeeperNameSecretValue"), true);
    assert.equal(isSensitiveBindingName("eidSchema"), false);
    assert.equal(isSensitiveBindingName("rowMatchesTerminationEid"), false);
    assert.equal(isSensitiveBindingName("runId"), false);
  });

  it("treats a loop variable drawn from a descriptor collection as a descriptor", () => {
    assert.deepEqual(findSecretInterpolations("src/domain/ok.ts", [
      "export function audit(dependency: { secretNames?: string[]; secretFiles?: string[] }) {",
      "  const violations: string[] = [];",
      "  for (const secret of dependency.secretNames ?? []) violations.push(`cannot own ${secret}`);",
      "  for (const secretFile of dependency.secretFiles ?? []) violations.push(`cannot own ${secretFile}`);",
      "  return violations;",
      "}",
    ].join("\n")), []);

    // ...but only when the collection itself is a descriptor. `apiKeys` holds
    // values, so its loop variable stays sensitive. (One report, not two: the
    // template span owns it, so the enclosing sink call does not double-count.)
    assert.equal(findSecretInterpolations("src/domain/bad.ts", [
      "export function leak(pool: { apiKeys: string[] }) {",
      "  for (const secret of pool.apiKeys) console.log(`using ${secret}`);",
      "}",
    ].join("\n")).length, 1);
  });

  it("ignores source-shaped strings and comments", () => {
    assert.deepEqual(findSecretInterpolations("src/domain/ok.ts", [
      'export const doc = "log.info(`login as ${password}`)";',
      "// log.info(`login as ${password}`)",
      "export const plain = 'password';",
    ].join("\n")), []);
  });
});
