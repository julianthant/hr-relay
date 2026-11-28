import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from "node:path";
import { createVitest } from "vitest/node";
import { z } from "zod";
import config from "../../vitest.config.js";
import { ciPlanSchema } from "../test/ci-plan.js";

// The V8 mapper uses Infinity for unknown end columns, which JSON encodes as null.
const position = z.strictObject({ line: z.number(), column: z.number().nullable() });
const range = z.strictObject({ start: position, end: position });
// The V8 mapper can emit empty positions for unmapped branch arms.
const branchPosition = position.partial();
const branchRange = z.strictObject({ start: branchPosition, end: branchPosition });
const counts = z.record(z.string(), z.number().nonnegative());
// ast-v8-to-istanbul can subtract a larger taken-arm count from the enclosing V8 count for an implicit else.
const branchCounts = z.record(z.string(), z.array(z.number().transform(hits => Math.max(0, hits))));
const reportSchema = z.record(z.string(), z.strictObject({
  path: z.string(),
  statementMap: z.record(z.string(), range),
  fnMap: z.record(z.string(), z.strictObject({ name: z.string(), decl: range, loc: range, line: z.number() })),
  branchMap: z.record(z.string(), z.strictObject({
    loc: range, type: z.string(), locations: z.array(branchRange), line: z.number(),
  })),
  s: counts,
  f: counts,
  b: branchCounts,
  bT: branchCounts.optional(),
  all: z.boolean().optional(),
  meta: z.strictObject({
    lastBranch: z.number(), lastFunction: z.number(), lastStatement: z.number(),
    seen: counts, fnNames: z.strictObject({}),
  }).optional(),
}));
const metrics = ["lines", "statements", "functions", "branches"] as const;
const totals = z.strictObject({
  total: z.number(), covered: z.number(), skipped: z.number(),
  pct: z.union([z.number(), z.literal("Unknown")]),
});
const summarySchema = z.record(z.string(), z.strictObject({
  lines: totals, statements: totals, functions: totals, branches: totals,
  branchesTrue: totals.optional(),
}));

function readReport(report: string, shardRoot: string) {
  const files = reportSchema.parse(JSON.parse(readFileSync(report, "utf8")));
  return Object.fromEntries(Object.entries(files).map(([path, entry]) => {
    const file = relative(shardRoot, path);
    assert(isAbsolute(path) && path === entry.path && file.startsWith("src/"),
      `Coverage path ${path} in ${report} is outside the shard's src directory.`);
    const normalized = resolve(file);
    return [normalized, { ...entry, path: normalized }];
  }));
}

const [directory, rawPlan] = process.argv.slice(2);
assert(directory && rawPlan, "Full coverage requires the artifact directory and CI plan.");
const plan = ciPlanSchema.parse(JSON.parse(rawPlan));
assert.equal(plan.workflow, "full", "Coverage can only be merged for a Full run.");
const artifacts = [
  ...plan.ubuntu.include.map(({ suite, shard }) => `coverage-ubuntu-${suite}-${shard}`),
  ...plan.macos.include.map(({ shard }) => `coverage-macos-${shard}`),
];
const reports = artifacts.flatMap(name => {
  const artifact = join(directory, name);
  const shardRoot = readFileSync(join(artifact, "root"), "utf8").trim();
  assert(isAbsolute(shardRoot), `Coverage artifact ${name} needs an absolute workspace path.`);
  const files = globSync("*/coverage-final.json", { cwd: artifact }).sort();
  assert(!name.startsWith("coverage-ubuntu-") || files.length === 1,
    `Expected one coverage report in ${name}.`);
  return files.map(file => readReport(join(artifact, file), shardRoot));
});
assert(reports.some(report => Object.keys(report).length > 0), "The Full shards recorded no source coverage.");

const coverage = config.test?.coverage;
assert(coverage?.provider === "v8" && coverage.thresholds, "Full coverage requires the configured V8 floors.");
const reportsDirectory = join(dirname(directory), "merged-full-coverage");
const vitest = await createVitest({
  watch: false,
  coverage: {
    enabled: true,
    reportsDirectory,
    reporter: ["json-summary"],
  },
});
try {
  const provider = await vitest.createCoverageProvider();
  assert(provider?.mergeReports, "The configured coverage provider cannot merge shard reports.");
  await provider.mergeReports(reports);
} finally {
  await vitest.close();
}

const { total, ...files } = summarySchema.parse(
  JSON.parse(readFileSync(join(reportsDirectory, "coverage-summary.json"), "utf8")),
);
assert(total, "The merged coverage report is missing global totals.");
const criticalPatterns = Object.keys(coverage.thresholds).filter(pattern => pattern.startsWith("src/"));
function percentages(summary: typeof total): string {
  return metrics.map(metric => `${metric} ${summary[metric].pct}%`).join(", ");
}

process.stdout.write(`Full coverage for ${Object.keys(files).length} files\nGlobal: ${percentages(total)}\n`);
for (const [path, summary] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
  const file = relative(process.cwd(), path);
  if (criticalPatterns.some(pattern => matchesGlob(file, pattern))) {
    process.stdout.write(`Safety-critical ${file}: ${percentages(summary)}\n`);
  }
}
