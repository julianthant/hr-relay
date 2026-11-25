import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

const COUNT_FIELDS = new Set(["monthCounts", "workflowCounts", "statusCounts"]);
const CALENDAR_SUMMARY = "src/backend/storage/sqlite/run-summaries.ts";
const THE_PROJECTION = "src/backend/runs/projections/run-queue-projection.ts";


const LEDGER_BLOCK_BUILDERS = [
  "src/models/dashboard/activity.ts",
  "src/backend/storage/sqlite/transaction-history.ts",
];
const LEDGER_BLOCK_CONSUMERS = [
  "src/backend/storage/sqlite/transaction-history.ts",
  THE_PROJECTION,
  "src/backend/runs/queries/activity-summaries.ts",
];

function identifiers(filePath: string): ReadonlySet<string> {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) found.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function countFieldConstructions(filePath: string, content = readFileSync(filePath, "utf8")): readonly string[] {
  const source = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    // An object-literal property named monthCounts/workflowCounts/statusCounts
    // is a count being BUILT; reading one off a parsed payload is fine.
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = node.name;
      if (ts.isIdentifier(name) && COUNT_FIELDS.has(name.text)) found.push(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("one-projection-counts", () => {
  it("keeps queue/status counts in one projection and bounds the admitted Calendar month-count owner", () => {
    const files = walkFiles(`${REPO_ROOT}/src`, { extensions: [".ts", ".tsx"] });
    const offenders: string[] = [];
    for (const file of files) {
      const relativePath = relative(REPO_ROOT, file).replaceAll("\\", "/");

      if (relativePath.startsWith("src/models/")) continue;
      const constructions = countFieldConstructions(file);
      if (constructions.length === 0) continue;
      if (relativePath === CALENDAR_SUMMARY && constructions.length === 1 && constructions[0] === "monthCounts") continue;
      if (relativePath !== THE_PROJECTION) {
        offenders.push(`${relativePath}: builds ${[...new Set(constructions)].join(", ")}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a count/aggregate reachable from a surface may only originate in the one run/queue projection",
    );
    assert.deepEqual(countFieldConstructions(`${REPO_ROOT}/${CALENDAR_SUMMARY}`), ["monthCounts"],
      "the admitted Calendar summary owns exactly one month count projection; queue/status counts remain forbidden");
    // The one legal constructor must actually exist — an empty scan proves
    // nothing once files move.
    assert.ok(
      countFieldConstructions(`${REPO_ROOT}/${THE_PROJECTION}`).length >= 3,
      "the run/queue projection must be the module that builds the count fields",
    );
  });

  it("bounds carve-out to one builder and one consumer", () => {
    const files = walkFiles(`${REPO_ROOT}/src`, { extensions: [".ts", ".tsx"] });
    const builders: string[] = [];
    const consumers: string[] = [];
    for (const file of files) {
      const relativePath = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const names = identifiers(file);
      if (names.has("ActivityLedgerBlockSchema")) builders.push(relativePath);
      if (names.has("foldActivityRange")) consumers.push(relativePath);
    }

    assert.deepEqual(
      builders.sort((a, b) => a.localeCompare(b)),
      [...LEDGER_BLOCK_BUILDERS].sort((a, b) => a.localeCompare(b)),
      "a write-ledger block is built in exactly the declared modules",
    );
    assert.deepEqual(
      consumers.sort((a, b) => a.localeCompare(b)),
      [...LEDGER_BLOCK_CONSUMERS].sort((a, b) => a.localeCompare(b)),
      "a write-ledger block is asked for in exactly the declared modules",
    );
  });
});
