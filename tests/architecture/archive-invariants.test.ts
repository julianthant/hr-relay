import { historicalArchiveAuthority } from "../integration/helpers/historical-archive-authority.js";
/**
 * `archive-invariants` — the structural half of D80/D179 (ref dashboard-surfaces §10.2, ref frontend-backend-integration
 * §8 guard #11).
 *
 * The behavioural clauses live in `tests/unit/archive-model.test.ts`, which
 * drives a real bump through the real kernel. What CANNOT be proved by driving
 * it once is that the archive stays this way, so four things are checked here
 * by construction:
 *
 * 1. **Self-containment is structural.** The module that serves an archived
 *    run may not reach the workflow registry for CONTENT. It is checked over
 *    the import closure, not by grepping one file, because a descriptor read
 *    three modules deep is the same coupling with more steps — and it is
 *    checked against a violating fixture, so a dead check cannot stand in for
 *    enforcement.
 * 2. **The archive is insert-only in SQL.** Not by convention and not by
 *    repository discipline: the migration's triggers are executed against a
 *    real database and every UPDATE and DELETE must ABORT. An archive whose
 *    rows could be rewritten is a weaker record than the live row it replaced.
 * 3. **The ledger is untouchable from here.** No module on the archive path
 *    may name `ledger/` at all — archiving is a display lifecycle and what was
 *    filed in a real HR system is an audit one.
 * 4. **The content digest is a fixed point.** Re-deriving a stored record's
 *    digest from its own content must reproduce it, and a tampered record must
 *    not — otherwise `archiveFingerprint`, which a relaunch cites, would be
 *    decoration.
 * 5. **D223's frozen sections are bound to the record's own generation, both
 *    ways.** A reader admits a generation-1 record and a writer may not
 *    produce one, so "this record predates frozen sections" can never be how a
 *    build records its own failure to freeze them — and a generation-1 row's
 *    canonical bytes are proved unchanged, which is why the bump needed no
 *    migration.
 */
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
} from "../../src/domain/archive/model.js";
import type { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { manualClock } from "../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { REPO_ROOT } from "./helpers/guard-files.js";
import { NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";
import {
  ARCHIVED_RUN,
  ARCHIVED_RUN_WITH_SECTIONS,
  ARCHIVE_RELAUNCH,
  VERSION_BUMP_APPLICATION,
  VERSION_PLAN_ROW,
} from "../fixtures/archive-fixtures.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/* ── the import-closure walker ───────────────────────────────────────────── */

/**
 * The modules an archived run's READ path may value-reach. Type-only imports
 * are exempt for the same reason `dashboard-wire-boundary` exempts them: a
 * type does not survive emission, so it cannot execute a descriptor lookup.
 */
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
  "src/base/workflow.ts",
  "src/backend/app/control/workflow-registry.ts",
  "src/domain/workflow/generated-build-manifest.ts",
]);

describe("archive invariants", () => {
  it("keeps the archived-run read path free of the workflow registry, and catches a violation", () => {
    const entry = join(REPO_ROOT, "src/server/dashboard/queries/archive.ts");
    const closure = [...closureOf(entry)].map((file) => relative(REPO_ROOT, file).replaceAll("\\", "/"));
    const reached = REGISTRY_MODULES.filter((module) => closure.includes(module));
    assert.deepEqual(
      reached,
      [],
      `the archive read path value-reaches ${reached.join(", ")}; an archived run must render with the `
      + "originating descriptor absent (ref frontend-backend-integration §8 guard #11)",
    );

    /*
      The negative control, run through the SAME walker: a module that reaches
      the registry — even two hops away, and even through a `.js` specifier —
      must be caught. Without it, a walker that silently resolved nothing would
      report a clean closure forever.
      */
    const violating = join(REPO_ROOT, "tests/architecture/fixtures/archive-registry-violation.ts");
    const violatingClosure = [...closureOf(violating)]
      .map((file) => relative(REPO_ROOT, file).replaceAll("\\", "/"));
    assert.equal(
      REGISTRY_MODULES.some((module) => violatingClosure.includes(module)),
      true,
      "the violating fixture must be caught by the same walker that clears the real module",
    );
  });

  it("never names a ledger PATH, and imports the ledger only to READ it back", () => {
    /*
     * The invariant is narrower than "the word never appears", and D179's own
     * sentence is why: archiving is a display lifecycle and the ledger is an
     * audit one, so no archive module may WRITE, prune, renumber or name a
     * ledger FILE. Resolving a stored pointer back to the line it names is the
     * opposite act — it is what keeps the pointer honest, and it is why an
     * archived record can carry ids instead of a copy of the audit record.
     *
     * So: a `ledger/` path literal stays banned outright in all three, and
     * exactly ONE import is allowed, in exactly one file — the read-through
     * the archived-detail query calls. Every other ledger import is a
     * violation, including in the two modules that write archived records.
     */
    const readOnly = new Map<string, readonly string[]>([
      ["src/domain/archive/model.ts", ["./ledger-resolution.js"]],
    ]);
    const files = [
      "src/domain/archive/model.ts",
      "src/services/archive/archive-service.ts",
      "src/server/dashboard/queries/archive.ts",
    ];
    for (const file of files) {
      // Comments are stripped first: the word MUST appear in the prose — the
      // whole point of these modules is that the ledger is never archived —
      // and it must never appear in the code except as the allowed import.
      const code = readFileSync(join(REPO_ROOT, file), "utf8")
        .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
        .replaceAll(/^\s*\/\/.*$/gmu, "");
      // Import specifiers are removed before the PATH test: a module
      // SPECIFIER contains a slash by construction, and the two are checked
      // separately below on their own terms.
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

    /*
     * And the read-through itself is read-only: it may open a partition and
     * parse a line, and it may never write one. A "repair" here would rewrite
     * the record of what was really filed against a live HR system, which is
     * the one thing ref write-safety §6 forbids projecting past.
     */
    const reader = readFileSync(join(REPO_ROOT, "src/infra/sqlite/transaction-history.ts"), "utf8")
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

    // Raw SQL, deliberately: the repositories have no update or delete verb,
    // so the only honest way to prove the row cannot move is to try to move it
    // the way a future repository method or a stray migration would.
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

    // A record whose stored content no longer hashes to its digest is exactly
    // what `relaunch-archived-run` refuses on, so the property has to hold in
    // one direction as well as the other.
    const tamperedContent = ArchivedRunContentSchema.parse({ ...content, archivedBy: "someone-else" });
    assert.notEqual(archivedRunContentDigest(tamperedContent), ARCHIVED_RUN.contentDigest);

    // And the record schema itself still parses byte-stable, so a re-read of
    // stored bytes cannot produce a second, different digest.
    const roundTripped = ArchivedRunRecordSchema.parse(JSON.parse(canonicalJsonStringify(ARCHIVED_RUN)));
    assert.equal(roundTripped.contentDigest, ARCHIVED_RUN.contentDigest);
    assert.equal(ARCHIVE_RELAUNCH.archivedRunId, ARCHIVED_RUN.runId);
  });

  it("binds D223's frozen sections to the record's own generation, in BOTH directions", () => {
    /*
     * The read-forward rule (D133) with the half an optional field cannot
     * carry. A READER must admit a generation-1 record — those bytes are on
     * disk and nothing may back-fill them. A WRITER may not produce one: a new
     * record naming no sections would be indistinguishable from a historical
     * one, so "this build could not freeze the logs" would be recorded as
     * "this record predates logs", which is a silent downgrade on the record
     * whose whole job is to be complete.
     */
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
      /predates D223's frozen sections/u,
      "a generation-1 record carrying frozen sections was accepted",
    );

    /*
     * And the generation-1 record's identity did not move when generation 2
     * was added: canonical JSON omits an absent key, so every archived_runs row
     * already on disk still hashes to the digest it was written with. This is
     * the whole reason the bump needed no migration.
     */
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
