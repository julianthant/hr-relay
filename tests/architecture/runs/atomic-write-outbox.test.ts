import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { releaseSeededWriteOwners } from "../../support/helpers/timeline-write-fixture.js";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import type { AuthorityWriteCommitHooks } from "../../../src/backend/storage/sqlite/authority-repositories.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

const CLOCK = manualClock(new Date(NOW));
const databases: AuthorityDatabase[] = [];
const paths = new WeakMap<AuthorityDatabase, string>();
let template: { profile: Awaited<ReturnType<typeof createBoundProfileFixture>>; snapshot: Buffer } | undefined;

async function databasePath(): Promise<string> {
  if (template === undefined) {
    const profile = await createBoundProfileFixture();
    const primed = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "atomic-write-test" },
      CLOCK,
    );
    primed.close();
    template = { profile, snapshot: readFileSync(profile.path) };
  }
  for (const suffix of ["-wal", "-shm"]) {
    const companion = `${template.profile.path}${suffix}`;
    if (existsSync(companion)) rmSync(companion);
  }
  writeFileSync(template.profile.path, template.snapshot);
  return template.profile.path;
}

function open(path: string, hooks?: AuthorityWriteCommitHooks): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "atomic-write-test" },
    CLOCK,
    hooks,
  );
  databases.push(database);
  paths.set(database, path);
  return database;
}

afterEach(() => {
  for (const database of databases) releaseSeededWriteOwners(database, NOW);
  for (const database of databases.splice(0)) database.close();
});

afterAll(async () => {
  await template?.profile.close();
});
describe("atomic write authority commit", () => {

  it("keeps standalone attempt/outbox mutation private and routes the commit through one authority transaction", async () => {
    const database = open(await databasePath());

    assert.deepEqual(Object.keys(database.authority.writeAttempts), ["get", "listByIntent"]);
    assert.equal("durableOutbox" in database.authority, false);

    const adapterPath = join(REPO_ROOT, "src/backend/storage/sqlite/authority-database.ts");
    const adapter = readFileSync(adapterPath, "utf8");
    assert.match(adapter, /commitWriteAttempt\(input: unknown, checkpointInput: unknown\)[\s\S]*?return this\.withAuthorityTransaction\(\(\) => \{/);
    assert.doesNotMatch(adapter, /writeAttempts:\s*Object\.freeze\(\{\s*insert:/);
    assert.doesNotMatch(adapter, /durableOutbox:\s*Object\.freeze\(\{\s*insert:/);

    const sourceText = gitVisibleFiles(["src"])
      .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
      .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
      .join("\n");
    assert.doesNotMatch(sourceText, /\.authority\.writeAttempts\.insert\s*\(/);
    assert.doesNotMatch(sourceText, /\.authority\.durableOutbox\.insert\s*\(/);
  });
});
