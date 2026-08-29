import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  "fulleid",
  "matchedeid",
  "namesearcheid",
  "observedeid",
  "observedemployeeid",
  "outputeid",
  "parsedeid",
  "ppseid",
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

const DIRECT_IDENTIFIER_TRANSFORMS = new Set([
  "directIdentifierDigestReference",
  "evidenceId",
  "redactionDigest",
]);

/**
 * Find one sensitive value carried by an interpolation expression. Calls and
 * conditionals need expression-aware inspection: `String(eid)`,
 * `candidateEids.join(", ")`, and `ok ? eid : ""` all retain the identifier
 * even though their outermost binding names do not.
 */
function sensitiveBindingInExpression(
  expression: ts.Expression,
  sensitive: (name: string) => boolean,
): string | undefined {
  if (ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return sensitiveBindingInExpression(expression.expression, sensitive);
  }
  if (ts.isConditionalExpression(expression)) {
    return sensitiveBindingInExpression(expression.whenTrue, sensitive)
      ?? sensitiveBindingInExpression(expression.whenFalse, sensitive);
  }
  if (ts.isBinaryExpression(expression)) {
    return sensitiveBindingInExpression(expression.left, sensitive)
      ?? sensitiveBindingInExpression(expression.right, sensitive);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        const found = sensitiveBindingInExpression(element.expression, sensitive);
        if (found !== undefined) return found;
      } else if (ts.isExpression(element)) {
        const found = sensitiveBindingInExpression(element, sensitive);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
  if (ts.isCallExpression(expression)) {
    const callee = bindingName(expression.expression);
    if (callee !== undefined && DIRECT_IDENTIFIER_TRANSFORMS.has(callee)) return undefined;
    if (ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.name.text === "map"
      && expression.arguments.some((argument) =>
        ts.isIdentifier(argument) && DIRECT_IDENTIFIER_TRANSFORMS.has(argument.text))) return undefined;

    if (callee !== undefined && sensitive(callee)) return callee;
    if (ts.isPropertyAccessExpression(expression.expression)) {
      const receiver = sensitiveBindingInExpression(expression.expression.expression, sensitive);
      if (receiver !== undefined) return receiver;
    }
    for (const argument of expression.arguments) {
      const found = sensitiveBindingInExpression(argument, sensitive);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const name = bindingName(expression);
  return name !== undefined && sensitive(name) ? name : undefined;
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

function isDiagnosticSink(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression)) return false;
  const receiver = expression.expression;
  return ts.isIdentifier(receiver) && ["log", "console", "logger"].includes(receiver.text);
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
function isDescriptorPresentationTemplateSpan(node: ts.TemplateSpan): boolean {
  const callback = enclosingPresentationCallback(node);
  if (callback === undefined || !ts.isPropertyAssignment(callback.parent)) return false;
  if (!["title", "subtitle"].includes(propertyNameText(callback.parent.name) ?? "")) return false;
  const presentationObject = callback.parent.parent;
  const presentationProperty = presentationObject.parent;
  if (!ts.isObjectLiteralExpression(presentationObject)
    || !ts.isPropertyAssignment(presentationProperty)
    || propertyNameText(presentationProperty.name) !== "presentation") return false;

  if (!ts.isBlock(callback.body)) return isWithin(node, callback.body);
  return callback.body.statements.some((statement) =>
    ts.isReturnStatement(statement)
    && statement.expression !== undefined
    && isWithin(node, statement.expression));
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
  const sensitive = (name: string): boolean => !descriptors.has(name) && isSensitiveBindingName(name);

  function report(node: ts.Node, name: string, why: string): void {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push(`${path}:${String(position.line + 1)}:${String(position.character + 1)}: ${why} ${name}`);
  }

  function visit(node: ts.Node): void {
    if (ts.isTemplateSpan(node)) {
      const name = sensitiveBindingInExpression(node.expression, sensitive);
      if (name !== undefined
        && (!isDirectIdentifierBindingName(name) || !isDescriptorPresentationTemplateSpan(node))) {
        report(node.expression, name, "template interpolates credential-named");
      }
    }
    if (ts.isCallExpression(node) && isDiagnosticSink(node.expression)) {
      for (const argument of node.arguments) {
        const name = sensitiveBindingInExpression(argument, sensitive);
        if (name !== undefined) {
          report(argument, name, "diagnostic sink receives credential-named");
        }
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

  it("exempts only a descriptor presentation callback's direct return expression", () => {
    assert.deepEqual(findSecretInterpolations("src/workflows/example/descriptor.ts", [
      "export const descriptor = {",
      "  presentation: {",
      "    title: (input: { emplId: string }) => `EID ${input.emplId}` ,",
      "    subtitle: (input: { eid: string; show: boolean }) => (input.show ? `EID ${input.eid}` : undefined),",
      "  },",
      "};",
    ].join("\n")), []);

    const violations = findSecretInterpolations("src/workflows/example/descriptor.ts", [
      "export const descriptor = {",
      "  presentation: {",
      "    title: (input: { emplId: string }) => {",
      "      const diagnostic = `unexpected ${input.emplId}`;",
      "      return diagnostic;",
      "    },",
      "    subtitle: (input: { eid: string }) => [input.eid].map((eid) => `nested ${eid}`).join(\"\"),",
      "  },",
      "};",
    ].join("\n"));
    assert.equal(violations.length, 2, violations.join("\n"));
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
