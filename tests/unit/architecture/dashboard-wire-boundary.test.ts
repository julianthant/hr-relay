/**
 * Doc 13 §8.2/§8.3 — the two frontend boundary guards that land with the 1i
 * dashboard surfaces.
 *
 * (2) No duplicate wire types: dashboard code renders schema-inferred types.
 *     A handwritten structural mirror of a `*Wire` contract (an `interface
 *     FooWire { … }` or `type FooWire = { … }` declared under src/dashboard)
 *     is exactly the drift D93 warns about — the mirror keeps compiling after
 *     the schema moves. Aliases of schema-inferred types (`type FooWire =
 *     z.infer<…>`) remain legal.
 *
 * (3) No workflow switches: production dashboard code may not branch on a
 *     concrete workflow id. The registered ids come from the ONE composition
 *     root's bundle-safe view; any string literal equal to a registered id
 *     under src/dashboard (client, surfaces, app, ds) fails. Workflow identity
 *     reaches surfaces only as data (bootstrap projections and descriptor
 *     objects), never as a literal a branch can hang off.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { REPO_ROOT, repoRelative, walkFiles } from "./helpers/guard-files.js";

const DASHBOARD_ROOT = resolve(REPO_ROOT, "src/dashboard");

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

describe("dashboard wire boundary (doc 13 §8)", () => {
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

  it("branches on no concrete workflow id anywhere under src/dashboard", () => {
    const ids = WORKFLOW_DESCRIPTORS.map((descriptor) => String(descriptor.id));
    expect(ids.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      visit(parse(file), (node) => {
        if (!ts.isStringLiteralLike(node)) return;
        if (ids.includes(node.text)) {
          violations.push(`${repoRelative(file)}: workflow id literal "${node.text}"`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
