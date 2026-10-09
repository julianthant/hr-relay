import { historicalArchiveAuthority } from "../../support/helpers/integration/historical-archive-authority.js";

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  archivedRunContentDigest,
  ArchivedRunContentSchema,
  ArchivedRunRecordSchema,
} from "../../../src/models/archive/model.js";
import type { AuthorityDatabase } from "../../../src/backend/storage/sqlite/index.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { REPO_ROOT } from "../support/helpers/guard-files.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
import {
  ARCHIVED_RUN,
  ARCHIVED_RUN_WITH_SECTIONS,
  ARCHIVE_RELAUNCH,
  VERSION_BUMP_APPLICATION,
  VERSION_PLAN_ROW,
} from "../../support/fixtures/archive-fixtures.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/* ── the import-closure walker ───────────────────────────────────────────── */


const IMPORT_PATTERN =
  /^\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?from\s+)?["']([^"']+)["'];?\s*$/gmu;

function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const target = resolve(dirname(fromFile), specifier.replace(/\.js$/u, ".ts"));
  return target;
}

function closureOf(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      // A `.tsx` sibling or a directory index the archive path never has;
      // recorded as unreachable rather than silently skipped.
      continue;
    }
    seen.add(file);
    for (const match of content.matchAll(IMPORT_PATTERN)) {
      const next = resolveSpecifier(file, match[1]);
      if (next !== undefined) pending.push(next);
    }
  }
  return seen;
}

/** Modules whose whole purpose is to resolve or interpret a descriptor. */
const REGISTRY_MODULES = Object.freeze([
  "src/workflow-kit/workflow.ts",
  "src/backend/app/registries/workflow-registry.ts",
  "src/workflow-kit/validation/generated-build-manifest.ts",
]);

describe("archive invariants", () => {
  it("keeps the archived-run read path free of the workflow registry, and catches a violation", () => {
    const entry = join(REPO_ROOT, "src/backend/runs/queries/archive.ts");
    const closure = [...closureOf(entry)].map((file) => relative(REPO_ROOT, file).replaceAll("\\", "/"));
    const reached = REGISTRY_MODULES.filter((module) => closure.includes(module));
    assert.deepEqual(
      reached,
      [],
      `the archive read path value-reaches ${reached.join(", ")}; an archived run must render with the `
      + "originating descriptor absent (ref frontend-backend-integration §8 guard #11)",
    );


    const violating = join(REPO_ROOT, "tests/architecture/storage/fixtures/archive-registry-violation.ts");
    const violatingClosure = [...closureOf(violating)]
      .map((file) => relative(REPO_ROOT, file).replaceAll("\\", "/"));
    assert.equal(
      REGISTRY_MODULES.some((module) => violatingClosure.includes(module)),
      true,
      "the violating fixture must be caught by the same walker that clears the real module",
    );
  });

  it("never names a ledger PATH, and imports the ledger only to READ it back", () => {

    const readOnly = new Map<string, readonly string[]>([
      ["src/models/archive/model.ts", ["./ledger-resolution.js"]],
    ]);
    const files = [
      "src/models/archive/model.ts",
      "src/backend/runs/archive/archive-service.ts",
      "src/backend/runs/queries/archive.ts",
    ];
    for (const file of files) {
      // Strip comments before the ledger scan; descriptions of the invariant must not count as accesses.
      const code = readFileSync(join(REPO_ROOT, file), "utf8")
        .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
        .replaceAll(/^\s*\/\/.*$/gmu, "");
      // Remove import specifiers before checking paths; their slashes are module syntax.
      const withoutImports = code.replaceAll(/from\s+["'][^"']*["']/gu, "");
      assert.equal(
        /["'`][^"'`]*ledger\//u.test(withoutImports),
        false,
        `${file} names a ledger PATH; the archive may never move, prune or renumber a ledger file`,
      );
      const allowed = readOnly.get(file) ?? [];
      const imports = [...code.matchAll(/from\s+["']([^"']*ledger[^"']*)["']/gu)].map((match) => match[1]);
      assert.deepEqual(
        imports.filter((specifier) => !allowed.includes(specifier)),
        [],
        `${file} imports a ledger module that is not the allowed read-only resolution`,
      );
    }


    const reader = readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/transaction-history.ts"), "utf8")
      .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
      .replaceAll(/^\s*\/\/.*$/gmu, "");
    for (const primitive of ["writeFileSync", "appendFileSync", "writeSync", "unlinkSync", "rmSync", "renameSync", "openSync"]) {
      assert.equal(
        reader.includes(primitive),
        false,
        `the archive's ledger read-through names ${primitive}; it may read a line and never write one`,
      );
    }
  });

  it("aborts every UPDATE and DELETE against the three archive tables", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-archive-immutable-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const database = historicalArchiveAuthority(path, manualClock(new Date(NOW)));
    databases.push(database);
    database.withAuthorityTransaction((repositories) => {
      repositories.runs.enqueue(QUEUED_RUN);
      repositories.versionPlans.insert(VERSION_PLAN_ROW);
      repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
      repositories.archivedRuns.insert(ARCHIVED_RUN);
      repositories.runs.enqueue({
        ...QUEUED_RUN,
        envelope: {
          ...QUEUED_RUN.envelope,
          runId: ARCHIVE_RELAUNCH.runId,
          itemId: "77777777-0007-4000-8000-777700000007",
          traceId: "pl-170001-3333",
        },
      });
      return undefined;
    });
    database.close();
    databases.pop();

    // Use raw SQL to probe immutability because repository APIs expose no update or delete.
    const raw = new DatabaseSync(path);
    try {
      raw.prepare("INSERT INTO archive_relaunches(record_key,archived_run_id,record_json,created_at) VALUES (?,?,?,?)").run(ARCHIVE_RELAUNCH.runId, ARCHIVE_RELAUNCH.archivedRunId, JSON.stringify(ARCHIVE_RELAUNCH), ARCHIVE_RELAUNCH.relaunchedAt);
      for (const table of ["version_bump_applications", "archived_runs", "archive_relaunches"]) {
        // A trigger only fires on a row that exists, so an empty table would
        // pass this check by doing nothing at all.
        const rows = raw.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
        assert.equal(rows.count > 0, true, `${table} has no row to attempt a mutation against`);
        assert.throws(
          () => raw.prepare(`UPDATE ${table} SET created_at = ?`).run("2030-01-01T00:00:00.000Z"),
          /immutable/u,
          `${table} accepted an UPDATE`,
        );
        assert.throws(
          () => raw.prepare(`DELETE FROM ${table}`).run(),
          /never deleted/u,
          `${table} accepted a DELETE`,
        );
      }
    } finally {
      raw.close();
    }
  });

  it("makes the content digest a fixed point, and refuses a tampered record", () => {
    const { contentDigest: _stored, ...content } = ARCHIVED_RUN;
    const rederived = archivedRunContentDigest(ArchivedRunContentSchema.parse(content));
    assert.equal(rederived, ARCHIVED_RUN.contentDigest);


    const tamperedContent = ArchivedRunContentSchema.parse({ ...content, archivedBy: "someone-else" });
    assert.notEqual(archivedRunContentDigest(tamperedContent), ARCHIVED_RUN.contentDigest);

    // And the record schema itself still parses byte-stable, so a re-read of
    // stored bytes cannot produce a second, different digest.
    const roundTripped = ArchivedRunRecordSchema.parse(JSON.parse(canonicalJsonStringify(ARCHIVED_RUN)));
    assert.equal(roundTripped.contentDigest, ARCHIVED_RUN.contentDigest);
    assert.equal(ARCHIVE_RELAUNCH.archivedRunId, ARCHIVED_RUN.runId);
  });

  it("binds frozen sections to the record's own generation, in BOTH directions", () => {
    // Readers accept unfilled earlier generations; writers must declare the current fields.
    const { contentDigest: _current, ...sectioned } = ARCHIVED_RUN_WITH_SECTIONS;
    assert.equal(ARCHIVED_RUN.sections, undefined, "the generation-1 fixture must stay the read-forward witness");
    assert.equal(ARCHIVED_RUN_WITH_SECTIONS.archiveSchemaGeneration, 2);

    // Generation 2 without the block: refused, by name.
    const { sections: _dropped, ...withoutSections } = sectioned;
    assert.throws(
      () => ArchivedRunContentSchema.parse(withoutSections),
      /must carry its frozen sections/u,
      "a generation-2 record with no frozen sections was accepted",
    );

    // Generation 1 WITH the block: refused too — a record cannot describe
    // bytes it does not hold.
    assert.throws(
      () => ArchivedRunContentSchema.parse({ ...sectioned, archiveSchemaGeneration: 1 }),
      /predates the frozen sections/u,
      "a generation-1 record carrying frozen sections was accepted",
    );

    // Absent JSON keys are omitted from canonical serialization, preserving existing archive digests.
    const { contentDigest: _stored, ...priorContent } = ARCHIVED_RUN;
    assert.equal(
      archivedRunContentDigest(ArchivedRunContentSchema.parse(priorContent)),
      ARCHIVED_RUN.contentDigest,
    );
    assert.equal(
      canonicalJsonStringify(ArchivedRunContentSchema.parse(priorContent)).includes("\"sections\""),
      false,
      "a generation-1 record's canonical bytes must not gain a sections key",
    );
  });
});
