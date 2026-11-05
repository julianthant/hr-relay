import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { isDirectExecution } from "../test/scope-files.js";
import { declaredWorkflowId } from "./workflow-build-manifest.js";

interface DefinitionReference {
  readonly name: string;
  readonly source: string;
  readonly moduleName: string;
}

interface Registration {
  readonly folder: string;
  readonly alias: string;
  readonly definition: DefinitionReference;
  readonly exposure: "public" | "child-only" | "unregistered";
  readonly order: number;
  readonly proofs: readonly { readonly definition: DefinitionReference; readonly order: number }[];
  readonly queueCapabilities: boolean;
}

function objectFields(node: ts.Node | undefined, keys: readonly string[], context: string): ReadonlyMap<string, ts.Expression> {
  if (node !== undefined && ts.isAsExpression(node)) return objectFields(node.expression, keys, context);
  if (node === undefined || !ts.isObjectLiteralExpression(node)) throw new Error(`${context} must be an object literal`);
  const fields = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw new Error(`${context} requires named property assignments`);
    }
    const key = property.name.text;
    if (!keys.includes(key) || fields.has(key)) throw new Error(`${context} has an unknown or duplicate property ${key}`);
    fields.set(key, property.initializer);
  }
  for (const key of keys) if (!fields.has(key)) throw new Error(`${context} is missing ${key}`);
  return fields;
}

function orderOf(node: ts.Expression | undefined, context: string): number {
  if (node === undefined || !ts.isNumericLiteral(node) || !Number.isSafeInteger(Number(node.text))) {
    throw new Error(`${context} requires a nonnegative integer order`);
  }
  return Number(node.text);
}

function readRegistration(repoRoot: string, folder: string): Registration {
  const path = join(repoRoot, "src/workflows", folder, "index.ts");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const imports = new Map<string, { readonly name: string; readonly source: string }>();
  const declarations: ts.Expression[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.importClause?.isTypeOnly === false && statement.importClause.namedBindings !== undefined
      && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const binding of statement.importClause.namedBindings.elements) {
        if (!binding.isTypeOnly) imports.set(binding.name.text, {
          name: binding.propertyName?.text ?? binding.name.text, source: statement.moduleSpecifier.text,
        });
      }
    }
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "registration" && declaration.initializer !== undefined) {
        declarations.push(declaration.initializer);
      }
    }
  }
  const [declaration] = declarations;
  if (declarations.length !== 1 || declaration === undefined || !ts.isCallExpression(declaration)
    || !ts.isIdentifier(declaration.expression) || declaration.expression.text !== "deepFreeze"
    || imports.get("deepFreeze")?.name !== "deepFreeze"
    || imports.get("deepFreeze")?.source !== "../../rules/validation/immutability.js" || declaration.arguments.length !== 1) {
    throw new Error(`${path} must export const registration = deepFreeze({ ... } as const)`);
  }
  let registrationObject = declaration.arguments[0];
  while (registrationObject !== undefined && ts.isAsExpression(registrationObject)) registrationObject = registrationObject.expression;
  if (registrationObject === undefined || !ts.isObjectLiteralExpression(registrationObject)) throw new Error(`${path} registration must be an object literal`);
  const registrationFields = new Map(registrationObject.properties.filter(ts.isPropertyAssignment)
    .map(property => [property.name.getText(source).replace(/^['"]|['"]$/gu, ""), property.initializer]));
  const fields = objectFields(registrationObject, ["definition", "exposure", "store", "proofs", ...(registrationFields.has("queueCapabilities") ? ["queueCapabilities"] : [])], path);
  const imported = (node: ts.Expression | undefined, expected: RegExp) => {
    const binding = node !== undefined && ts.isIdentifier(node) ? imports.get(node.text) : undefined;
    if (binding === undefined || !expected.test(binding.source) || !existsSync(join(path, "..", binding.source.replace(/\.js$/u, ".ts")))) {
      throw new Error(`${path} must reference a real named value import from ${expected.source}`);
    }
    return binding;
  };
  const definitionOf = (node: ts.Expression | undefined, expected: RegExp): DefinitionReference => {
    const binding = imported(node, expected);
    if (!binding.name.endsWith("Workflow")) throw new Error(`${path}: definition export ${binding.name} must end in Workflow`);
    return { ...binding, moduleName: binding.name.replace(/Workflow$/u, "Module") };
  };
  const definition = definitionOf(fields.get("definition"), /^\.\/workflow\.js$/u);
  if (declaredWorkflowId(join(path, "../workflow.ts")) !== folder) throw new Error(`${path}: workflow id must match its folder`);
  imported(fields.get("store"), /^\.\/task-registry\.js$/u);
  const exposureNode = fields.get("exposure");
  const exposureFields = objectFields(exposureNode,
    exposureNode !== undefined && ts.isObjectLiteralExpression(exposureNode) && exposureNode.properties.some(property => ts.isPropertyAssignment(property)
      && ts.isIdentifier(property.name) && property.name.text === "order") ? ["kind", "order"] : ["kind"], path);
  const kind = exposureFields.get("kind");
  if (kind === undefined || !ts.isStringLiteral(kind)
    || (kind.text !== "public" && kind.text !== "child-only" && kind.text !== "unregistered")) {
    throw new Error(`${path}: exposure kind must be public, child-only or unregistered`);
  }
  const exposure = kind.text;
  if (exposure !== "public" && exposureFields.has("order")) throw new Error(`${path}: only public exposure has picker order`);
  const order = exposure === "public" ? orderOf(exposureFields.get("order"), path) : 0;
  const proofsNode = fields.get("proofs");
  if (proofsNode === undefined || !ts.isArrayLiteralExpression(proofsNode)) throw new Error(`${path}: proofs must be an array literal`);
  const proofs = proofsNode.elements.map(node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "defineStepProof"
      || imports.get("defineStepProof")?.source !== "../../workflow-kit/workflow-definition.js"
      || node.arguments.length !== 2 || node.arguments[0]?.getText(source) !== fields.get("definition")?.getText(source)) {
      throw new Error(`${path}: proofs must call defineStepProof with this workflow and an imported step definition`);
    }
    const binding = imported(node.arguments[1], /^\.\/steps\/[^/]+\/step\.js$/u);
    if (!binding.name.endsWith("Definition")) throw new Error(`${path}: step export must end in Definition`);
    const stepPath = join(path, "..", binding.source.replace(/\.js$/u, ".ts"));
    const stepSource = ts.createSourceFile(stepPath, readFileSync(stepPath, "utf8"), ts.ScriptTarget.Latest, true);
    let proof: ts.Expression | undefined;
    for (const statement of stepSource.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== binding.name
          || declaration.initializer === undefined || !ts.isCallExpression(declaration.initializer)
          || declaration.initializer.expression.getText(stepSource) !== "defineStep") continue;
        const spec = declaration.initializer.arguments[0];
        if (spec !== undefined && ts.isObjectLiteralExpression(spec)) {
          for (const property of spec.properties) {
            if (ts.isPropertyAssignment(property) && property.name.getText(stepSource) === "proof") proof = property.initializer;
          }
        }
      }
    }
    const proofFields = objectFields(proof, ["id", "order", "build"], stepPath);
    return { definition: { ...binding, moduleName: binding.name.replace(/Definition$/u, "Module") }, order: orderOf(proofFields.get("order"), stepPath) };
  });
  const steps = join(path, "../steps");
  const sources = readdirSync(steps, { withFileTypes: true }).filter(entry => entry.isDirectory()
    && existsSync(join(steps, entry.name, "step.ts"))).map(entry => `./steps/${entry.name}/step.js`).sort();
  if (JSON.stringify(proofs.map(proof => proof.definition.source).sort()) !== JSON.stringify(sources)) {
    throw new Error(`${path}: proofs must list every steps/<step>/step.ts exactly once`);
  }
  return { folder, alias: `${definition.moduleName}Registration`, definition, exposure, order, proofs,
    queueCapabilities: fields.has("queueCapabilities") };
}

function unique(values: readonly (string | number)[], context: string): void {
  if (new Set(values).size !== values.length) throw new Error(`workflow registrations repeat ${context}`);
}

export function workflowRegistrySources(repoRoot: string): ReadonlyMap<string, string> {
  const root = join(repoRoot, "src/workflows");
  const registrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()
    && existsSync(join(root, entry.name, "workflow.ts"))).map(entry => entry.name).sort()
    .map(folder => readRegistration(repoRoot, folder));
  const active = registrations.filter(registration => registration.exposure !== "unregistered");
  const publicEntries = active.filter(registration => registration.exposure === "public").sort((left, right) => left.order - right.order);
  const children = active.filter(registration => registration.exposure === "child-only");
  const proofs = active.flatMap(registration => registration.proofs.map((proof, index) => ({ ...proof, registration, index })))
    .sort((left, right) => left.order - right.order);
  unique(publicEntries.map(registration => registration.order), "public picker order");
  unique(proofs.map(proof => proof.order), "step proof order");
  unique(registrations.flatMap(registration => [registration.definition, ...registration.proofs.map(proof => proof.definition)])
    .map(definition => definition.moduleName), "module export names");
  unique(registrations.flatMap(registration => [registration.definition, ...registration.proofs.map(proof => proof.definition)]
    .map(definition => declaredWorkflowId(join(root, registration.folder, definition.source.replace(/\.js$/u, ".ts"))))), "workflow ids");
  const header = "// Generated by npm run build:registries. Do not edit.\n";
  const importOf = (registration: Registration) => `import { registration as ${registration.alias} } from "../../../workflows/${registration.folder}/index.js";`;
  const imports = active.map(importOf);
  const compiler = 'import { compileWorkflow, composeWorkflowModule } from "../../../workflow-kit/workflow-definition.js";';
  const stores = 'import { taskStoreRegistry } from "./task-registry.js";';
  const tuple = (name: string, entries: readonly string[]) => `export const ${name} = Object.freeze([${entries.length === 0 ? "" : `\n${entries.map(entry => `  ${entry},`).join("\n")}\n`}] as const);\n`;
  const module = (name: string, definition: string) => `export const ${name} = composeWorkflowModule(compileWorkflow(${definition}), taskStoreRegistry.stores);`;
  return new Map([
    ["src/workflows/generated-descriptors.ts", header + [
      ...(publicEntries.length === 0 ? [] : ['import { compileWorkflow } from "../workflow-kit/workflow-definition.js";']),
      ...publicEntries.map(registration => `import { ${registration.definition.name} } from "./${registration.folder}/workflow.js";`),
      "", tuple("WORKFLOW_DESCRIPTORS", publicEntries.map(registration => `compileWorkflow(${registration.definition.name}).descriptor`)),
    ].join("\n")],
    ["src/backend/app/registries/generated-workflow-stores.ts", header + [...imports, "",
      tuple("WORKFLOW_TASK_STORES", active.map(registration => `${registration.alias}.store`)),
    ].join("\n")],
    ["src/backend/app/registries/generated-workflow-modules.ts", header + [...(active.length === 0 ? [] : [compiler, stores]), ...imports, "",
      ...active.map(registration => module(registration.definition.moduleName, `${registration.alias}.definition`)), "",
      tuple("WORKFLOW_MODULES", publicEntries.map(registration => registration.definition.moduleName)),
      tuple("CHILD_ONLY_WORKFLOW_MODULES", children.map(registration => registration.definition.moduleName)),
      tuple("WORKFLOW_QUEUE_CAPABILITIES", active.filter(registration => registration.queueCapabilities)
        .map(registration => `[String(${registration.alias}.definition.id), ${registration.alias}.queueCapabilities] as const`)),
    ].join("\n")],
    ["src/backend/app/registries/generated-step-proof-modules.ts", header + [...(proofs.length === 0 ? [] : [compiler, stores]),
      ...active.filter(registration => registration.proofs.length > 0).map(importOf), "",
      ...proofs.map(proof => module(proof.definition.moduleName, `${proof.registration.alias}.proofs[${proof.index}].definition`)), "",
      tuple("STEP_PROOF_MODULES", proofs.map(proof => proof.definition.moduleName)),
    ].join("\n")],
  ]);
}

if (isDirectExecution(import.meta.url)) {
  const repoRoot = resolve(import.meta.dirname, "../..");
  for (const [path, content] of workflowRegistrySources(repoRoot)) {
    const target = join(repoRoot, path);
    if (process.argv.includes("--check")) {
      if (!existsSync(target) || readFileSync(target, "utf8") !== content) {
        throw new Error(`${path} is missing or stale; run npm run build:registries`);
      }
    } else {
      writeFileSync(target, content, "utf8");
    }
    process.stdout.write(`${path} ${process.argv.includes("--check") ? "is current" : "written"}.\n`);
  }
}
