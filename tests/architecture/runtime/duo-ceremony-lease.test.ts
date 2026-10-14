// Duo counters are credential-wide but browser storage is profile-local; serialize ceremonies to avoid key-clone
// refusals.
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

describe("worker reset owner closure provenance", () => {
  const home = "src/backend/storage/sqlite/worker-control.ts";
  const owner = "src/backend/runtime/workers/worker-sessions.ts";
  const audit = (path: string, content: string) => path === home || path === owner ? []
    : content.includes("mintWorkerControlClosure") ? [`${path}: only the session manager may mint reset closure`] : [];
  it("permits only the actual session manager to mint closure capability", () => {
    assert.deepEqual(sourceFiles().flatMap(path => audit(path, read(path))), []);
    assert.match(read(owner), /return mintWorkerControlClosure\(binding/);
    assert.equal(audit("src/forged.ts", "mintWorkerControlClosure(binding)").length, 1);
  });
});

describe("worker lifecycle supervisor provenance", () => {
  const home = "src/backend/storage/sqlite/worker-control.ts";
  const owner = "src/backend/runtime/workers/worker-supervisor.ts";
  const audit = (path: string, content: string) => path === home || path === owner ? []
    : content.includes("mintWorkerSupervisorEffect") ? [`${path}: only the actual process supervisor may mint lifecycle effect proof`] : [];
  it("permits only actual supervisor exit and birth paths to mint effect capability", () => {
    assert.deepEqual(sourceFiles().flatMap(path => audit(path, read(path))), []);
    assert.match(read(owner), /return mintWorkerSupervisorEffect\(binding/);
    assert.equal(audit("src/forged.ts", "mintWorkerSupervisorEffect(binding)").length, 1);
  });
});

describe("the Duo ceremony lease is structural", () => {
  it("lets only the lease store mint or retire a token, anywhere in src/ and scripts/", () => {
    const files = sourceFiles();
    assert.ok(files.includes(LEASE_STORE) && files.includes(TOKEN_MODULE), "the lease store and token module must exist");
    assert.deepEqual(files.flatMap((path) => auditMintingCallers(path, read(path))), []);
    assert.ok(read(LEASE_STORE).includes(MINT_FUNCTIONS[0]), "the lease store must be the minter");
    assert.match(
      auditMintingCallers("src/backend/runtime/workers/worker-sessions.ts", "const token = mintDuoCeremonyLeaseToken(input);").join("\n"),
      /only src\/backend\/storage\/sqlite\/authority-database\.ts may mint/,
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
