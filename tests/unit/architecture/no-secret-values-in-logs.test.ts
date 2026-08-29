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
  const normalized = normalize(name);
  if (DIRECT_IDENTIFIER_BINDING_NAMES.has(normalized)) return true;
  const compact = name.replaceAll(/[^A-Za-z0-9]/gu, "");
  const structuralFamily = /(?:Eid|Eids|EIDs|EmplId|EmplIds|EmployeeId|EmployeeIds)$/u.test(compact);
  if (!structuralFamily) return false;
  // Predicate names answer a question ABOUT an identifier; they do not carry
  // it. Value names such as `matchedEid` stay sensitive ("matched" is a value
  // adjective), while a reviewed `rowMatchesTerminationEid` is a boolean.
  return !/(?:matches|equals|differsfrom|contains)[a-z0-9]*(?:eids?|emplids?|employeeids?)$/u
    .test(normalized);
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
  return !isCredentialDescriptorBindingName(name);
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
  expressionName: (expression: ts.Expression) => string | undefined = bindingName,
): string | undefined {
  if (ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return sensitiveBindingInExpression(
      expression.expression,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
      expressionName,
    );
  }
  if (ts.isConditionalExpression(expression)) {
    return sensitiveBindingInExpression(
      expression.whenTrue,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
      expressionName,
    ) ?? sensitiveBindingInExpression(
      expression.whenFalse,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
      expressionName,
    );
  }
  if (ts.isBinaryExpression(expression)) {
    return sensitiveBindingInExpression(
      expression.left,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
      expressionName,
    ) ?? sensitiveBindingInExpression(
      expression.right,
      sensitive,
      isCanonicalSanitizer,
      followUnknownCallArguments,
      expressionName,
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
          expressionName,
        );
        if (found !== undefined) return found;
      } else if (ts.isExpression(element)) {
        const found = sensitiveBindingInExpression(
          element,
          sensitive,
          isCanonicalSanitizer,
          followUnknownCallArguments,
          expressionName,
        );
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const member of expression.properties) {
      const value = ts.isSpreadAssignment(member)
        ? member.expression
        : ts.isPropertyAssignment(member)
          ? member.initializer
          : ts.isShorthandPropertyAssignment(member)
            ? member.name
            : undefined;
      if (value === undefined) continue;
      const found = sensitiveBindingInExpression(
        value,
        sensitive,
        isCanonicalSanitizer,
        followUnknownCallArguments,
        expressionName,
      );
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (ts.isCallExpression(expression)) {
    if (isCanonicalSanitizer(expression.expression)) return undefined;
    if (ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.name.text === "map"
      && expression.arguments.some((argument) =>
        isCanonicalSanitizer(argument))) return undefined;

    const callee = expressionName(expression.expression);
    if (callee !== undefined && sensitive(callee, expression.expression)) return callee;
    if (ts.isPropertyAccessExpression(expression.expression)) {
      const receiver = sensitiveBindingInExpression(
        expression.expression.expression,
        sensitive,
        isCanonicalSanitizer,
        followUnknownCallArguments,
        expressionName,
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
          expressionName,
        );
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  const name = expressionName(expression);
  if (name !== undefined && sensitive(name, expression)) return name;
  if (name === undefined && ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    if (argument !== undefined) {
      const sensitiveKey = sensitiveBindingInExpression(
        argument,
        sensitive,
        isCanonicalSanitizer,
        followUnknownCallArguments,
        expressionName,
      );
      if (sensitiveKey !== undefined) return sensitiveKey;
    }
    const receiverName = expressionName(expression.expression);
    if (receiverName !== undefined && sensitive(receiverName, expression.expression)) {
      return receiverName;
    }
  }
  return undefined;
}

interface AliasBinding {
  readonly name: string;
  readonly node: ts.Node;
  readonly scope: ts.Node;
  readonly sourceExpression?: ts.Expression;
  readonly sourceName?: string;
}

function returnedExpression(
  declaration: ts.FunctionDeclaration,
): ts.Expression | undefined {
  const statements = declaration.body?.statements;
  if (statements === undefined || statements.length !== 1) return undefined;
  const [statement] = statements;
  return statement !== undefined && ts.isReturnStatement(statement)
    ? statement.expression
    : undefined;
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
    } else if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      const expression = returnedExpression(node);
      bindings.push({
        name: node.name.text,
        node,
        scope: lexicalScope(node),
        ...(expression === undefined ? {} : { sourceExpression: expression }),
      });
    } else if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)) {
      bindings.push({
        name: node.left.text,
        node,
        scope: lexicalScope(node),
        sourceExpression: node.right,
      });
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      const property = node.propertyName;
      const pattern = node.parent;
      const declaration = ts.isObjectBindingPattern(pattern) && ts.isVariableDeclaration(pattern.parent)
        ? pattern.parent
        : undefined;
      bindings.push({
        name: node.name.text,
        node,
        scope: lexicalScope(node),
        ...(declaration?.initializer === undefined ? {} : { sourceExpression: declaration.initializer }),
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
 * Resolve a statically named object member back to the literal that packed it.
 * A member we cannot resolve remains unknown to the data-flow ratchet; callers
 * fall back to its own sensitive name, never to a plausible safe value.
 */
function objectPropertyValues(
  raw: ts.Expression,
  property: string,
  bindings: readonly AliasBinding[],
  resolving: ReadonlySet<ts.Node>,
): readonly ts.Expression[] | undefined {
  const expression = ts.isNonNullExpression(raw) || ts.isParenthesizedExpression(raw)
    || ts.isAsExpression(raw) || ts.isSatisfiesExpression(raw)
    ? raw.expression
    : raw;
  if (ts.isObjectLiteralExpression(expression)) {
    const values: ts.Expression[] = [];
    for (const member of expression.properties) {
      if (ts.isSpreadAssignment(member)) {
        const spreadValues = objectPropertyValues(member.expression, property, bindings, resolving);
        if (spreadValues !== undefined) values.push(...spreadValues);
      } else if (ts.isPropertyAssignment(member)
        && propertyNameText(member.name) === property) {
        values.push(member.initializer);
      } else if (ts.isShorthandPropertyAssignment(member)
        && member.name.text === property) {
        values.push(member.name);
      }
    }
    return values.length === 0 ? undefined : values;
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const binding = bindingForIdentifier(expression, bindings);
  if (binding?.sourceExpression === undefined || resolving.has(binding.node)) return undefined;
  const next = new Set(resolving);
  next.add(binding.node);
  return objectPropertyValues(binding.sourceExpression, property, bindings, next);
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
const DIAGNOSTIC_SINK_WRAPPERS = new Set(["call", "apply", "bind"]);

function sinkMemberName(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  return argument !== undefined && (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument))
    ? argument.text
    : undefined;
}

function directDiagnosticSinkKind(
  expression: ts.Expression,
  contextAliases: ReadonlySet<string>,
  sinkContainers: ReadonlySet<string>,
): DiagnosticSinkKind | undefined {
  if (ts.isIdentifier(expression) && expression.text === "Error") return "all-arguments";
  if (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) {
    return undefined;
  }
  const receiver = expression.expression;
  if (ts.isIdentifier(receiver) && sinkContainers.has(receiver.text)) {
    return "all-arguments";
  }
  const receiverName = bindingName(receiver);
  if (sinkMemberName(expression) === "fail" && receiverName !== undefined
    && contextAliases.has(receiverName)) return "second-argument";
  return undefined;
}

function diagnosticContextAliases(source: ts.SourceFile): ReadonlySet<string> {
  const aliases = new Set(["ctx"]);
  let changed = true;
  while (changed) {
    changed = false;
    function visit(node: ts.Node): void {
      const addAlias = (name: ts.Identifier, expression: ts.Expression): void => {
        const sourceName = bindingName(expression);
        if (sourceName !== undefined && aliases.has(sourceName) && !aliases.has(name.text)) {
          aliases.add(name.text);
          changed = true;
        }
      };
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && node.initializer !== undefined) addAlias(node.name, node.initializer);
      if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)) addAlias(node.left, node.right);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return aliases;
}

function diagnosticSinkAliases(
  source: ts.SourceFile,
  contextAliases: ReadonlySet<string>,
): {
  readonly aliases: ReadonlyMap<string, DiagnosticSinkKind>;
  readonly containers: ReadonlySet<string>;
} {
  const aliases = new Map<string, DiagnosticSinkKind>();
  const containers = new Set(["log", "console", "logger"]);
  let changed = true;
  while (changed) {
    changed = false;
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && node.initializer !== undefined) {
        const sourceName = bindingName(node.initializer);
        if (sourceName !== undefined && containers.has(sourceName)
          && !containers.has(node.name.text)) {
          containers.add(node.name.text);
          changed = true;
        }
        const kind = diagnosticSinkKind(node.initializer, aliases, contextAliases, containers);
        if (kind !== undefined && aliases.get(node.name.text) !== kind) {
          aliases.set(node.name.text, kind);
          changed = true;
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
        && node.initializer !== undefined) {
        const sourceName = bindingName(node.initializer);
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name) || element.dotDotDotToken !== undefined) continue;
          const property = element.propertyName !== undefined
            && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
            ? element.propertyName.text
            : element.name.text;
          const kind = sourceName !== undefined && containers.has(sourceName)
            ? "all-arguments"
            : property === "fail" && sourceName !== undefined && contextAliases.has(sourceName)
              ? "second-argument"
              : undefined;
          if (kind !== undefined && aliases.get(element.name.text) !== kind) {
            aliases.set(element.name.text, kind);
            changed = true;
          }
        }
      }
      if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)) {
        const sourceName = bindingName(node.right);
        if (sourceName !== undefined && containers.has(sourceName)
          && !containers.has(node.left.text)) {
          containers.add(node.left.text);
          changed = true;
        }
        const kind = diagnosticSinkKind(node.right, aliases, contextAliases, containers);
        if (kind !== undefined && aliases.get(node.left.text) !== kind) {
          aliases.set(node.left.text, kind);
          changed = true;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { aliases, containers };
}

function diagnosticSinkKind(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, DiagnosticSinkKind>,
  contextAliases: ReadonlySet<string>,
  sinkContainers: ReadonlySet<string>,
): DiagnosticSinkKind | undefined {
  const direct = directDiagnosticSinkKind(expression, contextAliases, sinkContainers)
    ?? (ts.isIdentifier(expression) ? aliases.get(expression.text) : undefined);
  if (direct !== undefined) return direct;
  if ((ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    && DIAGNOSTIC_SINK_WRAPPERS.has(sinkMemberName(expression) ?? "")) {
    return diagnosticSinkKind(expression.expression, aliases, contextAliases, sinkContainers) === undefined
      ? undefined
      : "all-arguments";
  }
  if (ts.isCallExpression(expression)
    && (ts.isPropertyAccessExpression(expression.expression)
      || ts.isElementAccessExpression(expression.expression))
    && sinkMemberName(expression.expression) === "bind") {
    return diagnosticSinkKind(
      expression.expression.expression,
      aliases,
      contextAliases,
      sinkContainers,
    ) === undefined ? undefined : "all-arguments";
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (!ts.isComputedPropertyName(name)) return undefined;
  const expression = name.expression;
  return ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)
    ? expression.text
    : undefined;
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
  const staticExpressionText = (
    raw: ts.Expression,
    resolving: ReadonlySet<ts.Node> = new Set(),
  ): string | undefined => {
    const expression = ts.isNonNullExpression(raw) || ts.isParenthesizedExpression(raw)
      || ts.isAsExpression(raw) || ts.isSatisfiesExpression(raw)
      ? raw.expression
      : raw;
    if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) return expression.text;
    if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (ts.isBinaryExpression(expression)
      && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticExpressionText(expression.left, resolving);
      const right = staticExpressionText(expression.right, resolving);
      return left === undefined || right === undefined ? undefined : `${left}${right}`;
    }
    if (!ts.isIdentifier(expression)) return undefined;
    const binding = bindingForIdentifier(expression, bindings);
    if (binding?.sourceExpression === undefined || resolving.has(binding.node)) return undefined;
    return staticExpressionText(binding.sourceExpression, new Set([...resolving, binding.node]));
  };
  const resolvedExpressionName = (expression: ts.Expression): string | undefined => {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression !== undefined) {
      return staticExpressionText(expression.argumentExpression);
    }
    if (ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression)
      || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
      return resolvedExpressionName(expression.expression);
    }
    if (ts.isCallExpression(expression)) return resolvedExpressionName(expression.expression);
    if (ts.isBinaryExpression(expression)
      && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return resolvedExpressionName(expression.left);
    }
    return undefined;
  };
  const resolvedAccessedPropertyName = (expression: ts.Expression): string | undefined => {
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return ts.isElementAccessExpression(expression) && expression.argumentExpression !== undefined
      ? staticExpressionText(expression.argumentExpression)
      : undefined;
  };
  const resolvingCanonicalAliases = new Set<ts.Node>();
  const resolvesImportedBinding = (
    expression: ts.Expression,
    imports: ReadonlySet<string>,
  ): boolean => {
    if (!ts.isIdentifier(expression)) return false;
    const binding = bindingForIdentifier(expression, bindings);
    if (binding === undefined) return imports.has(expression.text);
    if (binding.sourceExpression === undefined
      || resolvingCanonicalAliases.has(binding.node)) return false;
    resolvingCanonicalAliases.add(binding.node);
    const resolved = resolvesImportedBinding(binding.sourceExpression, imports);
    resolvingCanonicalAliases.delete(binding.node);
    return resolved;
  };
  const isCanonicalSanitizer = (expression: ts.Expression): boolean =>
    resolvesImportedBinding(expression, canonicalSanitizerImports);
  const isCanonicalDescriptorFactory = (expression: ts.Expression): boolean =>
    resolvesImportedBinding(expression, descriptorFactoryImports);
  const resolvingAliases = new Set<ts.Node>();
  const baseSensitive = (name: string): boolean => !descriptors.has(name) && isSensitiveBindingName(name);
  const sensitive = (name: string, expression: ts.Expression): boolean => {
    const property = resolvedAccessedPropertyName(expression);
    if (property !== undefined && (ts.isPropertyAccessExpression(expression)
      || ts.isElementAccessExpression(expression))) {
      const values = objectPropertyValues(expression.expression, property, bindings, new Set());
      if (values !== undefined) {
        for (const value of values) {
          if (sensitiveBindingInExpression(
            value,
            sensitive,
            isCanonicalSanitizer,
            false,
            resolvedExpressionName,
          ) !== undefined) {
            return true;
          }
        }
      }
      return baseSensitive(name);
    }
    if (ts.isIdentifier(expression)) {
      const binding = bindingForIdentifier(expression, bindings);
      const isKnownDynamicContainer = ts.isElementAccessExpression(expression.parent)
        && expression.parent.expression === expression
        && resolvedAccessedPropertyName(expression.parent) === undefined
        && binding?.sourceExpression !== undefined;
      if (binding !== undefined && !resolvingAliases.has(binding.node)) {
        if (binding.sourceName !== undefined && baseSensitive(binding.sourceName)) return true;
        if (binding.sourceExpression !== undefined) {
          resolvingAliases.add(binding.node);
          const resolved = binding.sourceName === undefined
            ? sensitiveBindingInExpression(
              binding.sourceExpression,
              sensitive,
              isCanonicalSanitizer,
              false,
              resolvedExpressionName,
            ) !== undefined
            : (objectPropertyValues(
              binding.sourceExpression,
              binding.sourceName,
              bindings,
              new Set([binding.node]),
            )?.some((value) =>
              sensitiveBindingInExpression(
                value,
                sensitive,
                isCanonicalSanitizer,
                false,
                resolvedExpressionName,
              ) !== undefined) ?? false);
          resolvingAliases.delete(binding.node);
          if (resolved) return true;
          if (isKnownDynamicContainer) return false;
        }
      }
    }
    if (baseSensitive(name)) return true;
    return false;
  };
  const contextAliases = diagnosticContextAliases(source);
  const sinkResolution = diagnosticSinkAliases(source, contextAliases);

  function report(node: ts.Node, name: string, why: string): void {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push(`${path}:${String(position.line + 1)}:${String(position.character + 1)}: ${why} ${name}`);
  }

  function visit(node: ts.Node): void {
    if (ts.isTemplateSpan(node)) {
      const name = sensitiveBindingInExpression(
        node.expression,
        sensitive,
        isCanonicalSanitizer,
        true,
        resolvedExpressionName,
      );
      if (name !== undefined
        && (!isDirectIdentifierBindingName(name)
          || (!isDescriptorPresentationTemplateSpan(node, isCanonicalDescriptorFactory)
            && !isDescriptorIdentityTemplateSpan(node, isCanonicalDescriptorFactory)))) {
        report(node.expression, name, "template interpolates credential-named");
      }
    }
    if (ts.isCallExpression(node)) {
      const sinkKind = diagnosticSinkKind(
        node.expression,
        sinkResolution.aliases,
        contextAliases,
        sinkResolution.containers,
      );
      const diagnosticArguments = sinkKind === "second-argument"
        ? node.arguments.slice(1, 2)
        : sinkKind === "all-arguments" ? node.arguments : [];
      for (const argument of diagnosticArguments) {
        const name = sensitiveBindingInExpression(
          argument,
          sensitive,
          isCanonicalSanitizer,
          true,
          resolvedExpressionName,
        );
        if (name !== undefined) {
          report(argument, name, "diagnostic sink receives credential-named");
        }
      }
    }
    if (ts.isNewExpression(node)
      && diagnosticSinkKind(
        node.expression,
        sinkResolution.aliases,
        contextAliases,
        sinkResolution.containers,
      ) === "all-arguments") {
      for (const argument of node.arguments ?? []) {
        const name = sensitiveBindingInExpression(
          argument,
          sensitive,
          isCanonicalSanitizer,
          true,
          resolvedExpressionName,
        );
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

  it("follows destructured and aliased console/logger methods through call, apply, and bind", () => {
    const violations = findSecretInterpolations("src/core/sink-method-leak.ts", [
      "declare const logger: { warn(message: unknown): void };",
      "export function leak(password: string) {",
      "  const { error: emit } = console;",
      "  const { warn } = logger;",
      "  const sink = console.info;",
      "  emit(password);",
      "  warn(password);",
      "  sink(password);",
      "  emit.call(console, password);",
      "  warn.apply(logger, [password]);",
      "  const bound = console.error.bind(console);",
      "  bound(password);",
      "  const aliasedBound = emit.bind(console);",
      "  aliasedBound(password);",
      "  const call = warn.call;",
      "  call(logger, password);",
      "}",
    ].join("\n"));

    assert.equal(violations.length, 8, violations.join("\n"));
  });

  it("follows sensitive object payloads through direct, shorthand, computed, and spread forms", () => {
    const violations = findSecretInterpolations("src/core/object-property-leak.ts", [
      "declare const log: { info(message: unknown): void };",
      "export function leak(password: string) {",
      '  const envelope = { message: password, safe: "ok" };',
      '  const computedEnvelope = { ["message"]: password };',
      "  const shorthandEnvelope = { password };",
      "  const spreadEnvelope = { ...envelope };",
      "  const aliasedEnvelope = envelope;",
      "  const { message: diagnostic } = aliasedEnvelope;",
      "  log.info(envelope.message);",
      '  throw new Error(aliasedEnvelope["message"]);',
      "  console.error(diagnostic);",
      "  console.error({ message: password });",
      "  log.info(JSON.stringify({ message: password }));",
      '  console.error({ ["message"]: password });',
      "  console.error({ password });",
      "  console.error({ ...envelope });",
      "  console.error(computedEnvelope.message);",
      "  console.error(shorthandEnvelope);",
      "  console.error(spreadEnvelope);",
      "  log.info(envelope.safe);",
      "}",
    ].join("\n"));

    assert.equal(violations.length, 11, violations.join("\n"));
  });

  it("resolves aliased computed keys and fails closed on a dynamic read from a sensitive container", () => {
    const violations = findSecretInterpolations("src/core/computed-property-leak.ts", [
      "export function leak(password: string, runtimeKey: string) {",
      '  const envelope = { message: password, safe: "ok" };',
      '  const messageKey = "message";',
      '  const safeKey = "safe";',
      "  console.error(envelope[messageKey]);",
      "  console.error(envelope[safeKey]);",
      "  console.error(envelope[runtimeKey]);",
      "}",
    ].join("\n"));

    assert.equal(violations.length, 2, violations.join("\n"));
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

  it("follows assignment, function, destructuring, context, and Error aliases", () => {
    const violations = findSecretInterpolations("src/core/alias-families.ts", [
      "export function leak(",
      "  secretValue: string, targetEid: string, input: { personEid: string },",
      "  ctx: { fail(code: string, message: string): never },",
      ") {",
      "  const secretName = secretValue;",
      "  let assigned: string;",
      "  assigned = targetEid;",
      "  function currentIdentity() { return targetEid; }",
      "  const { personEid: destructured } = input;",
      "  const context = ctx;",
      "  const reject = context.fail;",
      "  const Failure = Error;",
      "  throw new Failure(`${secretName} ${assigned} ${currentIdentity()} ${destructured}`);",
      "  reject(\"identity-mismatch\", targetEid);",
      "}",
    ].join("\n"));

    assert.equal(violations.length, 5, violations.join("\n"));
  });

  it("detects structural EID and EMPLID families while retaining reviewed descriptors and predicates", () => {
    for (const binding of [
      "targetEid",
      "personEid",
      "currentEid",
      "targetEmplId",
      "currentEmployeeId",
    ]) assert.equal(isSensitiveBindingName(binding), true, binding);

    for (const binding of [
      "targetEidSchema",
      "personEidField",
      "currentEmplIdPath",
      "rowMatchesTerminationEid",
    ]) assert.equal(isSensitiveBindingName(binding), false, binding);
  });

  it("resolves canonical sanitizer and descriptor-factory aliases by provenance", () => {
    assert.deepEqual(findSecretInterpolations("src/workflows/example/descriptor.ts", [
      'import { defineWorkflowDescriptor } from "../../base/workflow.js";',
      'import { directIdentifierDigestReference } from "../../domain/redaction.js";',
      "const descriptorFactory = defineWorkflowDescriptor;",
      "const safeReference = directIdentifierDigestReference;",
      "export const descriptor = descriptorFactory({",
      "  identity: { matchKey: (input: { targetEid: string }) => `eid:${input.targetEid}` },",
      "  presentation: { title: (input: { personEid: string }) => `EID ${input.personEid}` },",
      "});",
      "export function safe(currentEid: string) {",
      "  throw new Error(`subject ${safeReference(currentEid)}`);",
      "}",
    ].join("\n")), []);

    const spoofed = findSecretInterpolations("src/workflows/example/spoofed.ts", [
      "const descriptorFactory = (value: unknown) => value;",
      "const safeReference = (value: string) => value;",
      "export const descriptor = descriptorFactory({",
      "  identity: { matchKey: (input: { targetEid: string }) => `eid:${input.targetEid}` },",
      "});",
      "export function leak(personEid: string) {",
      "  throw new Error(`subject ${safeReference(personEid)}`);",
      "}",
    ].join("\n"));
    assert.equal(spoofed.length, 2, spoofed.join("\n"));
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
