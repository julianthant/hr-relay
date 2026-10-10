
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, resolve } from "node:path";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { REPO_ROOT, repoRelative, walkFiles } from "../support/helpers/guard-files.js";

const RETAINED_MOCK_SITES: Readonly<Record<string, readonly string[]>> = {
  "src/dashboard/surfaces/sessions/sessions-fixture.ts": [
    "[\"separations\",[\"StringLiteral:\",\"LiteralType:\",\"UnionType:\",\"Parameter:workflow\",\"FunctionDeclaration:sampleTimeline\"],\"\\\"separations\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"LiteralType:\",\"UnionType:\",\"Parameter:workflow\",\"FunctionDeclaration:sampleTimeline\"],\"\\\"person-lookup\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"PropertyAccessExpression:map\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:sampleTimeline\"],\"workflow===\\\"separations\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"workflowId:\\\"separations\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"sampleTimeline(\\\"separations\\\",11)\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"workflowId:\\\"person-lookup\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"sampleTimeline(\\\"person-lookup\\\",3)\"]",
    "[\"separations\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"workflowId:\\\"separations\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"sampleTimeline(\\\"separations\\\",0)\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:workflowId\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"VariableDeclaration:workers\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"workflowId:\\\"person-lookup\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:workers\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"CaseClause:\",\"CaseBlock:\",\"SwitchStatement:\",\"Block:\",\"FunctionDeclaration:sessionsSample\"],\"sampleTimeline(\\\"separations\\\",14,\\\"waiting\\\")\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:workers\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"CaseClause:\",\"CaseBlock:\",\"SwitchStatement:\",\"Block:\",\"FunctionDeclaration:sessionsSample\"],\"sampleTimeline(\\\"person-lookup\\\",3,\\\"failed\\\")\"]",
    "[\"separations\",[\"StringLiteral:\",\"CallExpression:\",\"PropertyAssignment:timeline\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"PropertyAssignment:workers\",\"ObjectLiteralExpression:\",\"ReturnStatement:\",\"CaseClause:\",\"CaseBlock:\",\"SwitchStatement:\",\"Block:\",\"FunctionDeclaration:sessionsSample\"],\"sampleTimeline(\\\"separations\\\",11,\\\"paused\\\")\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-manual-model.ts": [
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:formStepIsLocked\"],\"id===\\\"separations\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts": [
    "[\"separations\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"separations\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"id\\\"\",\"ObjectLiteralExpression:\",\"ArrayLiteralExpression:\",\"AsExpression:\",\"VariableDeclaration:WORKFLOW_PREVIEW_DEFINITIONS\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"id\\\":\\\"person-lookup\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"person-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:contracts\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"person-lookup\\\":{runnable:true,methods:[\\\"typed\\\"],inputLabel:\\\"EmployeeIDsornames\\\",placeholder:\\\"10000001;Lee,Jordan\\\",example:\\\"10000001\\\",dryRun:false,roster:false,steps:[step(\\\"searching\\\",\\\"Searchforperson\\\",\\\"UCPath\\\",\\\"SearchPersonOrgSummarybyEmployeeIDorname;MatchusesHR-Taskspersonmatching.\\\"),step(\\\"cross-verification\\\",\\\"Cross-checkidentity\\\",\\\"CRM\\\",\\\"Cross-checkthenamematchagainstCRMwhenCRMcheckisenabled.\\\"),step(\\\"active-status\\\",\\\"Reademploymentstatus\\\",\\\"UCPath\\\",\\\"Readdepartment,HRstatusandemploymentdates.\\\"),step(\\\"crm-dates\\\",\\\"ReadCRMdates\\\",\\\"CRM\\\",\\\"Readfirstdayofserviceandoathdateonlywhenrequestedbyaparentworkflow.\\\"),],result:[[\\\"EmployeeID\\\",\\\"10000001\\\"],[\\\"Employee\\\",\\\"JordanLee\\\"],[\\\"Department\\\",\\\"HDH\\\"],[\\\"HRstatus\\\",\\\"Active\\\"]]}\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-model.ts": [
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"CallExpression:\",\"PropertyAccessExpression:map\",\"CallExpression:\",\"PropertyAccessExpression:filter\",\"CallExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockInputEntries\"],\"id===\\\"person-lookup\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"person-lookup\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"id===\\\"separations\\\"\"]",
    "[\"separations\",[\"StringLiteral:\",\"ArrayLiteralExpression:\",\"PropertyAccessExpression:includes\",\"CallExpression:\",\"PrefixUnaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"IfStatement:\",\"Block:\",\"ForOfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockDraftInputError\"],\"[\\\"onboarding\\\",\\\"separations\\\",\\\"crm-doc-download\\\"]\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockStepState\"],\"run.workflowId===\\\"person-lookup\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ParenthesizedExpression:\",\"SpreadElement:\",\"ArrayLiteralExpression:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:mockConfirmationFacts\"],\"id===\\\"person-lookup\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx": [
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"person-lookup\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:label\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"person-lookup\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:description\",\"JsxAttributes:\",\"JsxOpeningElement:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"person-lookup\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"JsxExpression:\",\"JsxAttribute:placeholder\",\"JsxAttributes:\",\"JsxSelfClosingElement:\",\"JsxElement:\",\"JsxFragment:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"BinaryExpression:\",\"JsxExpression:\",\"JsxElement:\",\"JsxElement:\",\"JsxElement:\",\"JsxFragment:\",\"ReturnStatement:\",\"Block:\",\"FunctionDeclaration:WorkflowMockRunForm\"],\"workflowId===\\\"person-lookup\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-catalog.ts": [
    "[\"person-lookup\",[\"StringLiteral:\",\"PropertyAssignment:\\\"person-lookup\\\"\",\"ObjectLiteralExpression:\",\"VariableDeclaration:MOCK_OPERATION_CATALOG\",\"VariableDeclarationList:\",\"FirstStatement:\"],\"\\\"person-lookup\\\":{searching:[fill(\\\"Searchcriteria\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Name\\\",\\\"$name\\\"],[\\\"Campus\\\",\\\"SDCMP\\\"]]),click(\\\"SearchPersonOrganizationalSummary\\\"),read(\\\"UCPathperson\\\",[[\\\"EmployeeID\\\",\\\"$employeeId\\\"],[\\\"Name\\\",\\\"$name\\\"],[\\\"Department\\\",\\\"HDH\\\"],[\\\"Jobtitle\\\",\\\"Studentassistant\\\"],[\\\"Jobrecord\\\",\\\"0\\\"],[\\\"HRstatus\\\",\\\"Active\\\"]])],\\\"cross-verification\\\":[click(\\\"FindtheonboardingrecordinCRM\\\"),read(\\\"Identitycross-check\\\",[[\\\"UCPathname\\\",\\\"$name\\\"],[\\\"CRMname\\\",\\\"$name\\\"],[\\\"Campusemail\\\",\\\"$email\\\"],[\\\"Startdate\\\",\\\"08/03/2026\\\"],[\\\"Match\\\",\\\"Confirmed\\\"]])],\\\"active-status\\\":[click(\\\"OpenWorkforceJobSummary\\\"),read(\\\"Employmentstatus\\\",[[\\\"HRstatus\\\",\\\"Active\\\"],[\\\"Startdate\\\",\\\"08/03/2026\\\"],[\\\"Enddate\\\",\\\"\u2014\\\"],[\\\"Terminationreason\\\",\\\"\u2014\\\"],[\\\"FoundinUCPath\\\",\\\"Yes\\\"]])],\\\"crm-dates\\\":[read(\\\"Caller-requestedCRMdates\\\",[[\\\"Employmentdate\\\",\\\"08/03/2026\\\"],[\\\"Oathdate\\\",\\\"08/03/2026\\\"]])],}\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-model.ts": [
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"PropertyAssignment:employeeId\",\"ObjectLiteralExpression:\",\"VariableDeclaration:values\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:mockOperationValue\"],\"run.workflowId!==\\\"separations\\\"\"]",
    "[\"person-lookup\",[\"StringLiteral:\",\"BinaryExpression:\",\"BinaryExpression:\",\"BinaryExpression:\",\"IfStatement:\",\"Block:\",\"IfStatement:\",\"Block:\",\"FunctionDeclaration:mockOperations\"],\"run.workflowId===\\\"person-lookup\\\"\"]"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-review-model.ts": [
    "[\"separations\",[\"StringLiteral:\",\"BinaryExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"ConditionalExpression:\",\"VariableDeclaration:type\",\"VariableDeclarationList:\",\"FirstStatement:\",\"Block:\",\"FunctionDeclaration:extractedReviewRecords\"],\"run.workflowId===\\\"separations\\\"\"]"
  ]
};

function retainedLiteralSite(node: ts.StringLiteralLike, source: ts.SourceFile): string {
  const chain: string[] = [];
  let parent: ts.Node | undefined = node;
  while (parent !== undefined && !ts.isSourceFile(parent)) {
    const name = "name" in parent && parent.name !== undefined ? (parent.name as ts.Node).getText(source) : "";
    chain.push(`${ts.SyntaxKind[parent.kind]}:${name}`);
    parent = parent.parent;
  }
  return JSON.stringify([node.text, chain, ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, node.parent, source).replace(/\s+/gu, "")]);
}

const RETAINED_MOCK_LITERALS: Readonly<Record<string, readonly string[]>> = {
  "src/dashboard/surfaces/sessions/sessions-fixture.ts": [
    "separations",
    "person-lookup",
    "separations",
    "separations",
    "separations",
    "person-lookup",
    "person-lookup",
    "separations",
    "separations",
    "person-lookup",
    "separations",
    "person-lookup",
    "separations"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-manual-model.ts": [
    "separations"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts": [
    "separations",
    "person-lookup",
    "person-lookup"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-model.ts": [
    "person-lookup",
    "person-lookup",
    "separations",
    "separations",
    "person-lookup",
    "person-lookup"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-mock-run.tsx": [
    "person-lookup",
    "person-lookup",
    "person-lookup",
    "person-lookup"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-catalog.ts": [
    "person-lookup"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-operation-model.ts": [
    "separations",
    "person-lookup"
  ],
  "src/dashboard/surfaces/workflows/mocks/workflow-review-model.ts": [
    "separations"
  ]
};

function workflowLiteralIssues(sources: ReadonlyMap<string, string>, ids: readonly string[]): readonly string[] {
  const violations: string[] = [];
  for (const path of Object.keys(RETAINED_MOCK_LITERALS)) if (!sources.has(path)) violations.push(`${path}: missing retained fixture owner`);
  for (const [path, content] of sources) {
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    const values: string[] = [];
    visit(source, node => { if (ts.isStringLiteralLike(node) && ids.includes(node.text)) values.push(retainedLiteralSite(node, source)); });
    const expected = RETAINED_MOCK_SITES[path];
    if (expected !== undefined && JSON.stringify(values) === JSON.stringify(expected)) continue;
    if (values.length > 0 || expected !== undefined) violations.push(`${path}: unadmitted workflow literals ${values.join(", ")}`);
  }
  return violations;
}

const DASHBOARD_ROOT = resolve(REPO_ROOT, "src/dashboard");

/** The `@` alias in `vite.dashboard.config.ts` — kept in sync by the arm below. */
const DASHBOARD_ALIAS = "@/";

const NODE_BUILTINS = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || NODE_BUILTINS.has(specifier);
}

// Type-only imports and exports disappear from the browser bundle.
function bundledSpecifiers(file: string, source: ts.SourceFile): readonly string[] {
  const specifiers: string[] = [];
  visit(source, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly === true) return;
      const bindings = clause?.namedBindings;
      const everyBindingIsType = clause?.name === undefined
        && bindings !== undefined
        && ts.isNamedImports(bindings)
        && bindings.elements.length > 0
        && bindings.elements.every((element) => element.isTypeOnly);
      if (everyBindingIsType) return;
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
  });
  return specifiers.map((specifier) => specifier.startsWith(DASHBOARD_ALIAS)
    ? `${repoRelative(DASHBOARD_ROOT)}/${specifier.slice(DASHBOARD_ALIAS.length)}`
    : specifier)
    .filter((specifier) => specifier !== file);
}

// verbatimModuleSyntax uses .js specifiers for .ts and .tsx sources.
function resolveSourceFile(fromFile: string, specifier: string): string | undefined {
  const base = specifier.startsWith(".")
    ? resolve(fromFile, "..", specifier)
    : specifier.startsWith("src/") ? join(REPO_ROOT, specifier) : undefined;
  if (base === undefined) return undefined;
  const candidates = base.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Every Node built-in the entry's bundled-import closure can reach, with the chain that got there. */
function nodeBuiltinReach(entry: string): readonly string[] {
  const violations: string[] = [];
  const parents = new Map<string, string>();
  const seen = new Set<string>();
  const pending = [resolve(REPO_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = parse(file);
    for (const specifier of bundledSpecifiers(file, source)) {
      if (isNodeBuiltin(specifier)) {
        const chain = [repoRelative(file)];
        for (let cursor = parents.get(file); cursor !== undefined; cursor = parents.get(cursor)) {
          chain.push(repoRelative(cursor));
        }
        violations.push(`${repoRelative(file)}: imports Node built-in "${specifier}" — reached from ${entry} via ${chain.reverse().join(" -> ")}`);
        continue;
      }
      const target = resolveSourceFile(file, specifier);
      if (target === undefined || seen.has(target)) continue;
      parents.set(target, file);
      pending.push(target);
    }
  }
  return violations.sort();
}


function dashboardHtmlFiles(): readonly string[] {
  const files = readdirSync(DASHBOARD_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name)
    .sort();
  expect(files.length, "src/dashboard declares at least one HTML entry").toBeGreaterThan(0);
  return files;
}

function dashboardEntries(): readonly string[] {
  const entries = dashboardHtmlFiles().flatMap((file) => {
    const html = readFileSync(join(DASHBOARD_ROOT, file), "utf8");
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
      .map((match) => `src/dashboard${match[1] ?? ""}`);
    expect(scripts.length, `${file} declares a module entry`).toBeGreaterThan(0);
    return scripts;
  });
  expect(entries.length).toBeGreaterThan(0);
  return entries;
}

/** Every project-internal source file an entry's bundled-import closure reaches. */
function bundleClosure(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const pending = [resolve(REPO_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of bundledSpecifiers(file, parse(file))) {
      if (isNodeBuiltin(specifier)) continue;
      const target = resolveSourceFile(file, specifier);
      if (target !== undefined && !seen.has(target)) pending.push(target);
    }
  }
  return new Set([...seen].map((file) => repoRelative(file)));
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

describe("dashboard wire boundary (ref frontend-backend-integration §8)", () => {
  const files = walkFiles(DASHBOARD_ROOT);

  it("scans a non-vacuous dashboard tree", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("declares no handwritten mirror of a *Wire contract under src/dashboard", () => {
    const violations: string[] = [];
    for (const file of files) {
      visit(parse(file), (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith("Wire")) {
          violations.push(`${repoRelative(file)}: interface ${node.name.text} mirrors a wire contract; import the schema-inferred type`);
        }
        if (
          ts.isTypeAliasDeclaration(node)
          && node.name.text.endsWith("Wire")
          && ts.isTypeLiteralNode(node.type)
        ) {
          violations.push(`${repoRelative(file)}: type ${node.name.text} mirrors a wire contract; import the schema-inferred type`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("reaches no Node built-in from ANY dashboard bundle entry", () => {
    const entries = dashboardEntries();

    expect(dashboardHtmlFiles()).toContain("index.html");
    expect(dashboardHtmlFiles()).toContain("kit.html");
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // The `@` alias the walker rewrites must be the one the bundler resolves.
    const viteConfig = readFileSync(join(REPO_ROOT, "vite.dashboard.config.ts"), "utf8");
    expect(viteConfig).toContain('"@": resolve(import.meta.dirname, "src/dashboard")');
    // Match the Rollup input declaration; a path mentioned only in a comment is not a built entry.
    for (const file of dashboardHtmlFiles()) {
      const key = file.replace(/\.html$/, "");
      const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const inputPattern = new RegExp(
        `\\b${key}\\s*:\\s*resolve\\(\\s*import\\.meta\\.dirname\\s*,\\s*"src/dashboard/${escapedFile}"\\s*\\)`,
      );
      expect(inputPattern.test(viteConfig), `${file} is a rollup input (as "${key}: resolve(...)")`).toBe(true);
    }
    for (const entry of entries) {
      expect(nodeBuiltinReach(entry), entry).toEqual([]);
    }

    const breach = nodeBuiltinReach("src/backend/app/config/resolve.ts");
    expect(breach.some((violation) => violation.includes('"node:crypto"'))).toBe(true);
    expect(breach.some((violation) =>
      violation.includes("src/backend/app/config/runtime-paths.ts") && violation.includes('"node:path"'))).toBe(true);
  });

  it("keeps executable preflight registry composition out of the bootstrap wire closure", () => {
    const closure = bundleClosure("src/models/dashboard/bootstrap.ts");
    expect(closure).toContain("src/models/preflight/preflight-contract.ts");
    expect(closure).not.toContain("src/models/runtime/runtime-dependencies.ts");
    expect(closure).not.toContain("src/models/runtime/runtime-environment.ts");
    expect(closure).not.toContain("src/models/config/secrets.ts");
  });

  it("keeps the rerun client on the strict browser-safe preflight contract", () => {
    const closure = bundleClosure("src/dashboard/client/queries.ts");
    expect(closure).toContain("src/models/preflight/preflight-contract.ts");
    expect(closure).toContain("src/rules/preflight/preflight-semantics.ts");
    expect(closure).not.toContain("src/models/preflight/preflight.ts");
    expect(closure).not.toContain("src/models/runtime/runtime-dependencies.ts");
  });


  it("reaches no operator surface, client, state or app module from the specimen entry", () => {
    const forbidden = [
      "src/dashboard/surfaces/",
      "src/dashboard/client/",
      "src/dashboard/state/",
      "src/dashboard/app/",
    ];
    const closure = bundleClosure("src/dashboard/kit/main.tsx");
    // Non-vacuous: the walker really is resolving the specimen's own modules
    // and the barrel it draws every primitive from.
    expect(closure).toContain("src/dashboard/kit/kit-page.tsx");
    expect(closure).toContain("src/dashboard/ds/ui.tsx");
    expect(closure).toContain("src/dashboard/ds/primitives/primitives-status.tsx");
    const violations = [...closure]
      .filter((file) => forbidden.some((root) => file.startsWith(root)))
      .sort();
    expect(violations, "the specimen bundle may not reach an operator module").toEqual([]);

    // Require a non-entry app module; matching the entry itself would pass with a broken closure walker.
    const operator = bundleClosure("src/dashboard/app/main.tsx");
    for (const root of forbidden) {
      if (root === "src/dashboard/app/") {
        expect(operator, root).toContain("src/dashboard/app/dashboard-app.tsx");
        continue;
      }
      expect([...operator].some((file) => file.startsWith(root)), root).toBe(true);
    }
  });

  it("reaches no workflow registry from any dashboard entry", () => {

    const forbidden = ["src/workflows/", "src/backend/app/registries/workflow-registry.ts"];
    const violations: string[] = [];
    for (const entry of dashboardEntries()) {
      for (const file of bundleClosure(entry)) {
        if (forbidden.some((root) => file.startsWith(root))) {
          violations.push(`${entry}: reaches ${file}`);
        }
      }
    }
    expect(violations.sort(), "no dashboard bundle may carry the workflow registry").toEqual([]);


    const registry = bundleClosure("src/workflows/descriptor-registry.ts");
    expect([...registry].filter((file) => file.startsWith("src/workflows/")).length)
      .toBeGreaterThan(1);
  });

  it("bounds retained fixture literals exactly and refuses served or sibling workflow branches", () => {
    const ids = WORKFLOW_DESCRIPTORS.map(descriptor => String(descriptor.id));
    const sources = new Map(files.map(file => [repoRelative(file), readFileSync(file, "utf8")]));
    expect(Object.values(RETAINED_MOCK_LITERALS).flat()).toHaveLength(31);
    expect(workflowLiteralIssues(sources, ids)).toEqual([]);
    for (const path of ["src/dashboard/client/queries/day-queries.ts", "src/dashboard/surfaces/workflows/mocks/new-sibling.ts", ...Object.keys(RETAINED_MOCK_LITERALS)]) {
      const changed = new Map(sources);
      changed.set(path, `${sources.get(path) ?? ""}\nconst injected = (id: string) => id === "person-lookup";`);
      expect(workflowLiteralIssues(changed, ids).some(issue => issue.startsWith(`${path}:`))).toBe(true);
    }
    const repurposedPath = "src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.ts";
    const repurposed = new Map(sources);
    const original = sources.get(repurposedPath)!;
    repurposed.set(repurposedPath, original.replace('"separations"', '(unknownId === "separations" ? unknownId : unknownId)'));
    expect(workflowLiteralIssues(repurposed, ids).some(issue => issue.startsWith(`${repurposedPath}:`))).toBe(true);
    const missing = new Map(sources); missing.delete(Object.keys(RETAINED_MOCK_LITERALS)[0]);
    expect(workflowLiteralIssues(missing, ids).length).toBeGreaterThan(0);
  });

  it("branches on no concrete workflow id anywhere under src/dashboard", () => {
    const ids = WORKFLOW_DESCRIPTORS.map((descriptor) => String(descriptor.id));
    expect(ids.length).toBeGreaterThan(0);
    const sources = new Map(files.map(file => [repoRelative(file), readFileSync(file, "utf8")]));
    const violations = workflowLiteralIssues(sources, ids);
    expect(violations).toEqual([]);
  });
});
