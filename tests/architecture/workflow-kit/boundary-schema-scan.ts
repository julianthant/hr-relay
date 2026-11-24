import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { z } from "zod";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

const BOUNDARY_SCHEMA_ROOTS = [
  "src/models",
  "src/rules",
  "src/backend/app/config",
  "src/backend/app/registries",
  "src/backend/runs/lifecycle",
  "src/backend/storage/sqlite",
  "src/backend/systems/crm/driver",
  "src/backend/systems/ucpath/driver",
  "src/workflow-kit/validation",
];

// Each exception applies to one exported schema and its current non-strict object paths.
const EXISTING_NON_STRICT_BOUNDARY_SCHEMAS = new Map<string, readonly string[]>([
  ["src/backend/storage/sqlite/authority-change-log.ts:SingletonImageSchema", ["$"]],
  ["src/models/config/test-data.ts:TestDataSharedConfigSchema", ["$.subjects"]],
  ["src/models/dashboard/assistant.ts:AssistantInferenceRequestSchema", [
    "$.input[]|2|0", "$.input[]|2|0.summary[]", "$.input[]|2|1", "$.input[]|2|1.content[]",
  ]],
  ["src/models/dashboard/assistant.ts:AssistantInferenceResultSchema", [
    "$.output[]|0", "$.output[]|0.summary[]", "$.output[]|1", "$.output[]|1.content[]",
  ]],
  ["src/models/dashboard/assistant.ts:AssistantInputItemSchema", [
    "$|2|0", "$|2|0.summary[]", "$|2|1", "$|2|1.content[]",
  ]],
  ["src/models/dashboard/assistant.ts:AssistantResponseItemSchema", [
    "$|0", "$|0.summary[]", "$|1", "$|1.content[]",
  ]],
]);

function isSchemaName(name: string): boolean {
  return name.endsWith("Schema");
}

function hasSchemaBinding(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return isSchemaName(name.text);
  return name.elements.some(element => ts.isBindingElement(element) && hasSchemaBinding(element.name));
}

function mightExportSchema(path: string): boolean {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest);
  return source.statements.some(statement => {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const clause = statement.exportClause;
      return clause === undefined || (ts.isNamedExports(clause) && clause.elements.some(
        specifier => !specifier.isTypeOnly && isSchemaName(specifier.name.text),
      ));
    }
    return ts.isVariableStatement(statement)
      && !!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
      && statement.declarationList.declarations.some(({ name }) => hasSchemaBinding(name));
  });
}

async function discoverBoundarySchemas(): Promise<ReadonlyMap<string, z.core.$ZodType>> {
  const schemas = new Map<string, z.core.$ZodType>();
  for (const file of gitVisibleFiles(BOUNDARY_SCHEMA_ROOTS)) {
    if ((!file.endsWith(".ts") && !file.endsWith(".tsx")) || file.endsWith(".d.ts")) continue;
    const path = join(REPO_ROOT, file);
    if (!mightExportSchema(path)) continue;
    const moduleExports: unknown = await import(pathToFileURL(path).href);
    assert.ok(moduleExports !== null && typeof moduleExports === "object", `${file}: expected a module namespace`);
    const entries: [string, unknown][] = Object.entries(moduleExports);
    for (const [name, value] of entries) {
      if (isSchemaName(name) && value instanceof z.core.$ZodType) schemas.set(`${file}:${name}`, value);
    }
  }
  return schemas;
}

export async function assertDiscoveredBoundarySchemasAreStrict(): Promise<void> {
  const schemas = await discoverBoundarySchemas();
  const existing = new Set([...EXISTING_NON_STRICT_BOUNDARY_SCHEMAS].flatMap(([name, paths]) =>
    paths.map(path => `${name} ${path}`),
  ));
  const failures: string[] = [];
  for (const [name, schema] of schemas) {
    for (const path of strictnessViolations(schema)) {
      const location = `${name} ${path}`;
      if (!existing.delete(location)) failures.push(`${location}: object schema is not strict`);
    }
  }
  for (const location of existing) failures.push(`${location}: remove stale strictness exception`);
  assert.deepEqual(failures, []);
}

export function strictnessViolations(
  schema: z.core.$ZodType,
  path = "$",
  ancestors = new Set<z.core.$ZodType>(),
): readonly string[] {
  if (ancestors.has(schema)) return [];
  ancestors.add(schema);
  try {
    const visit = (child: z.core.$ZodType, suffix: string) => strictnessViolations(child, path + suffix, ancestors);
    if (schema instanceof z.core.$ZodObject) {
      const { catchall, shape } = schema._zod.def;
      const violations = catchall instanceof z.core.$ZodNever ? [] : [path];
      return [...violations, ...Object.entries(shape).flatMap(([key, child]) => visit(child, `.${key}`))];
    }
    if (schema instanceof z.core.$ZodUnion) return schema._zod.def.options.flatMap((child, index) => visit(child, `|${index}`));
    if (schema instanceof z.core.$ZodArray) return visit(schema._zod.def.element, "[]");
    if (schema instanceof z.core.$ZodRecord || schema instanceof z.core.$ZodMap) {
      return [...visit(schema._zod.def.keyType, "{key}"), ...visit(schema._zod.def.valueType, "{value}")];
    }
    if (schema instanceof z.core.$ZodSet) return visit(schema._zod.def.valueType, "{value}");
    if (schema instanceof z.core.$ZodLazy) return visit(schema._zod.def.getter(), "<lazy>");
    if (schema instanceof z.core.$ZodOptional || schema instanceof z.core.$ZodNullable
      || schema instanceof z.core.$ZodDefault || schema instanceof z.core.$ZodPrefault
      || schema instanceof z.core.$ZodReadonly || schema instanceof z.core.$ZodNonOptional
      || schema instanceof z.core.$ZodCatch || schema instanceof z.core.$ZodPromise
      || schema instanceof z.core.$ZodSuccess) {
      return visit(schema._zod.def.innerType, "?");
    }
    if (schema instanceof z.core.$ZodPipe) return [...visit(schema._zod.def.in, "<in>"), ...visit(schema._zod.def.out, "<out>")];
    if (schema instanceof z.core.$ZodFunction) return [...visit(schema._zod.def.input, "<in>"), ...visit(schema._zod.def.output, "<out>")];
    if (schema instanceof z.core.$ZodIntersection) return [...visit(schema._zod.def.left, "&left"), ...visit(schema._zod.def.right, "&right")];
    if (schema instanceof z.core.$ZodTuple) {
      const { items, rest } = schema._zod.def;
      return [...items.flatMap((child, index) => visit(child, `[${index}]`)), ...(rest ? visit(rest, "[...]") : [])];
    }
    return [];
  } finally {
    ancestors.delete(schema);
  }
}
