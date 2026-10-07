/**
 * Guard (ref execution-and-sessions §10.7, D267): no login path reaches the SSO
 * form or the Duo assertion without presenting a `DuoCeremonyLeaseToken`, the
 * token is minted and retired by the lease store alone, and
 * `defineVerifiedLoginRecipe` is the ONE acquirer.
 *
 * ## Why this guard exists
 *
 * Duo's WebAuthn signature counter is per CREDENTIAL; Duo Autopilot's copy is
 * per browser PROFILE; §1 partitions profiles per worker. Two ceremonies for
 * one credential inside the same second present the same floored counter and
 * Duo reads the non-advancing one as a cloned key, which BURNS the profile
 * (D243 recorded three further logins refused with counters more than a
 * thousand ahead; only a fresh directory recovered). The lease serializes the
 * ceremonies, and the token is what makes "under the lease" structural: the SSO
 * helpers refuse without one, so a recipe that bypassed the wrapper could not
 * reach SSO at all. The type system enforces the parameter; THIS guard pins the
 * shape so the next recipe cannot rebuild the defect from scratch:
 *
 * - `mintDuoCeremonyLeaseToken` / `retireDuoCeremonyLeaseToken` are named only
 *   by their module and the lease store;
 * - the brand is conjured through `as` / `satisfies` nowhere outside its module;
 * - `withCeremony` — the acquisition — is called only by the wrapper;
 * - every store recipe is the wrapper's `{navigate, ceremony}` shape (no
 *   `flow`), and every SSO-helper call inside a store presents `token`.
 *
 * Each arm runs against the checked-in violating fixture
 * (`fixtures/duo-lease-recipe-violation.ts`, the exact shipped pre-lease
 * shape), so a walker that resolved nothing cannot report the tree clean.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

const TOKEN_MODULE = "src/workflow-kit/duo-ceremony-lease.ts";
const LEASE_STORE = "src/backend/storage/sqlite/authority-database.ts";
const WRAPPER_MODULE = "src/backend/systems/browser-shared/authenticated-application.ts";
const GATE_MODULE = "src/backend/runtime/gates/duo-ceremony-gate.ts";
const WRAPPER = "defineVerifiedLoginRecipe";
const ACQUIRE = "withCeremony";
const MINT_FUNCTIONS = ["mintDuoCeremonyLeaseToken", "retireDuoCeremonyLeaseToken"] as const;
const TOKEN_TYPE = "DuoCeremonyLeaseToken";
const SSO_HELPERS = new Set(["waitForSsoForm", "fillSsoCredentials", "submitSsoForm", "waitForAuthenticatedLanding"]);
const VIOLATING_FIXTURE = "tests/architecture/runtime/fixtures/duo-lease-recipe-violation.ts";

function parse(path: string, content: string): ts.SourceFile {
  return ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => { visit(child, callback); });
}

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

/** Arm 1 — only the token module and the lease store may name the mint/retire functions. */
export function auditMintingCallers(path: string, content: string): readonly string[] {
  if (path === TOKEN_MODULE || path === LEASE_STORE) return [];
  return MINT_FUNCTIONS
    .filter((name) => content.includes(name))
    .map((name) => `${path}: names ${name}; only ${LEASE_STORE} may mint or retire a Duo ceremony lease token`);
}

/** Arm 2 — the brand is never conjured by `as` / `satisfies` outside the token module. */
export function auditTokenConjuring(path: string, content: string): readonly string[] {
  if (path === TOKEN_MODULE) return [];
  const violations: string[] = [];
  visit(parse(path, content), (node) => {
    if ((ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
      && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName)
      && node.type.typeName.text === TOKEN_TYPE) {
      violations.push(`${path}: ${TOKEN_TYPE} is conjured by a type assertion; only the lease store mints one`);
    }
  });
  return violations;
}

/** Arm 3 — `withCeremony` is CALLED only by the wrapper (the gate module defines it). */
export function auditAcquirers(path: string, content: string): readonly string[] {
  if (path === WRAPPER_MODULE || path === GATE_MODULE || path === TOKEN_MODULE) return [];
  const violations: string[] = [];
  visit(parse(path, content), (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === ACQUIRE) {
      violations.push(`${path}: calls ${ACQUIRE}; ${WRAPPER} in ${WRAPPER_MODULE} is the only acquirer`);
    }
  });
  return violations;
}

/**
 * Arm 4 — a store recipe is the wrapper's `{navigate, ceremony}` shape, and
 * every SSO-helper call in the store presents the token it was handed.
 */
export function auditRecipeShape(path: string, content: string): readonly string[] {
  const violations: string[] = [];
  visit(parse(path, content), (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === WRAPPER) {
      const argument = node.arguments[0];
      if (argument === undefined || !ts.isObjectLiteralExpression(argument)) {
        violations.push(`${path}: ${WRAPPER} is not called with an object literal`);
        return;
      }
      const names = argument.properties
        .map((property) => property.name)
        .filter((name): name is ts.Identifier => name !== undefined && ts.isIdentifier(name))
        .map((name) => name.text);
      if (names.includes("flow")) {
        violations.push(`${path}: ${WRAPPER} is given a single \`flow\`; the SSO ceremony must be the \`ceremony\` half that receives the lease token`);
      }
      for (const required of ["navigate", "ceremony"]) {
        if (!names.includes(required)) violations.push(`${path}: ${WRAPPER} lacks its \`${required}\` half`);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && SSO_HELPERS.has(node.expression.text)) {
      const presentsToken = node.arguments.some((argument) => ts.isIdentifier(argument) && argument.text === "token");
      if (!presentsToken) {
        violations.push(`${path}: ${node.expression.text}(...) presents no \`token\`; the SSO form and the Duo assertion are reachable only under the Duo ceremony lease`);
      }
    }
  });
  return violations;
}

function sourceFiles(): readonly string[] {
  return gitVisibleFiles(["src", "scripts"]).filter((path) => /\.tsx?$/.test(path));
}

function storeSessionFiles(): readonly string[] {
  return gitVisibleFiles(["src/stores", "src/backend/systems"]).filter((path) => /\/session\.ts$/.test(path));
}

describe("the Duo ceremony lease is structural", () => {
  it("lets only the lease store mint or retire a token, anywhere in src/ and scripts/", () => {
    const files = sourceFiles();
    assert.ok(files.includes(LEASE_STORE) && files.includes(TOKEN_MODULE), "the lease store and token module must exist");
    assert.deepEqual(files.flatMap((path) => auditMintingCallers(path, read(path))), []);
    assert.ok(read(LEASE_STORE).includes(MINT_FUNCTIONS[0]), "the lease store must be the minter");
    assert.match(
      auditMintingCallers("src/backend/runtime/workers/worker-sessions.ts", "const token = mintDuoCeremonyLeaseToken(input);").join("\n"),
      /only src\/infra\/sqlite\/authority-database\.ts may mint/,
    );
  });

  it("never conjures the token brand outside its module", () => {
    assert.deepEqual(sourceFiles().flatMap((path) => auditTokenConjuring(path, read(path))), []);
    assert.match(
      auditTokenConjuring("src/backend/systems/onbase/session.ts", [
        `const token = { credentialKey, generation, holder, expiresAt } as ${TOKEN_TYPE};`,
        `const other = {} satisfies ${TOKEN_TYPE};`,
      ].join("\n")).join("\n"),
      /conjured by a type assertion[\s\S]*conjured by a type assertion/,
    );
  });

  it("keeps defineVerifiedLoginRecipe the ONE acquirer", () => {
    assert.ok(read(WRAPPER_MODULE).includes(`.${ACQUIRE}(`), "the wrapper must acquire through the gate");
    assert.deepEqual(sourceFiles().flatMap((path) => auditAcquirers(path, read(path))), []);
    assert.match(
      auditAcquirers("src/backend/systems/onbase/session.ts", "await context.duoCeremony.withCeremony(async (token) => run(token));").join("\n"),
      /the only acquirer/,
    );
  });

  it("scans every landed store recipe and finds each in the {navigate, ceremony} shape presenting its token", () => {
    const files = storeSessionFiles();
    const withRecipes = files.filter((path) => read(path).includes("LoginRecipe"));
    assert.deepEqual(
      withRecipes.sort(),
      [
        "src/backend/systems/crm/session.ts",
        "src/backend/systems/kuali/session.ts",
        "src/backend/systems/new-kronos/session.ts",
        "src/backend/systems/ucpath/session.ts",
      ],
      "a landed login recipe must be scanned by this guard",
    );
    for (const path of withRecipes) {
      const content = read(path);
      assert.ok([...SSO_HELPERS].some((helper) => content.includes(`${helper}(`)), `${path} must drive the SSO helpers`);
    }
    assert.deepEqual(files.flatMap((path) => auditRecipeShape(path, read(path))), []);
  });

  it("catches the shipped pre-lease recipe shape — the checked-in violating fixture", () => {
    const content = read(VIOLATING_FIXTURE);
    const violations = auditRecipeShape(VIOLATING_FIXTURE, content);
    assert.match(violations.join("\n"), /is given a single `flow`/);
    assert.match(violations.join("\n"), /lacks its `navigate` half/);
    assert.match(violations.join("\n"), /lacks its `ceremony` half/);
    for (const helper of SSO_HELPERS) {
      assert.match(violations.join("\n"), new RegExp(`${helper}\\(\\.\\.\\.\\) presents no \`token\``));
    }
    assert.equal(
      auditRecipeShape(VIOLATING_FIXTURE, content.replace(/\(SYSTEM, context/g, "(SYSTEM, context, token")).filter((line) => /presents no/.test(line)).length,
      0,
      "the same calls presenting a token are clean",
    );
  });
});
