import { ATOMIC_WRITE_COMMIT as HISTORICAL_COMMIT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

import assert from "node:assert/strict";
import {
mkdirSync,
mkdtempSync,
realpathSync,
rmSync,
writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import {
composeStorageCommand as composeNativeStorageCommand
} from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
COMMAND_FIXTURES,
NOW,
WRITE_ATTEMPT,
WRITE_INTENT_ATTEMPTING
} from "../../../support/fixtures/phase1c-contract-fixtures.js";

const CLOCK = manualClock(new Date(NOW));
const roots: string[] = [];
const admissions = new Map<string,RuntimeAdmission>();
async function composeStorageCommand(isolation:typeof rebuildRuntimeIsolation,args:readonly string[],clock:typeof CLOCK,repoRoot:string){const admission=admissions.get(repoRoot);assert.ok(admission);return composeNativeStorageCommand(isolation,args,clock,repoRoot,admission);}

afterEach(() => {
  for(const admission of admissions.values())admission.release();admissions.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface DrillPaths {
  readonly repoRoot: string;
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  readonly authorityPath: string;
  readonly backupDirectory: string;
  readonly processLockRoot: string;
}

function drillPaths(): DrillPaths {
  const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "native-restore-drill-"));
  roots.push(repoRoot);
  const admission=acquireEntrypointAdmission(repoRoot,"exclusive");admissions.set(repoRoot,admission);
  const stateRoot = admission.stateRoot;
  mkdirSync(stateRoot, { recursive: true });
  // The command reads the running build's version out of its repo root, the
  // same way the dashboard composition does; the drill's root is a repo root.
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "drill", version: "0.1.0" }));
  return {
    repoRoot,
    admission,
    stateRoot,
    authorityPath: join(stateRoot, "state.db"),
    backupDirectory: join(stateRoot, "backups", "authority"),
    processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
  };
}

function open(paths: DrillPaths): AuthorityDatabase {
  return AuthorityDatabase.open(paths.admission,
    { path: paths.authorityPath, busyTimeoutMs: 250, migrationOwner: "restore-drill" },
    CLOCK,
  );
}


function seedRealShapedAuthority(database: AuthorityDatabase, paths:DrillPaths): Readonly<{
  claimGeneration: number;
  runId: string;
}> {
  database.authority.commands.insert(COMMAND_FIXTURES[0]);
  seedAtomicWriteOwner(database,HISTORICAL_COMMIT,paths.authorityPath);
  const run=database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);assert.ok(run);
  const claimGeneration=run.claimGeneration;
  const fenced = database.authority.writeIntents.fenceAttempt({
    intent: WRITE_INTENT_ATTEMPTING,
    attempt: WRITE_ATTEMPT,
  });
  assert.equal(fenced.state, "fenced");
  return { claimGeneration, runId: String(WRITE_INTENT_ATTEMPTING.runId) };
}

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("names every storage-doctor exit-zero condition in command help", async () => {
    const paths = drillPaths();
    const usage = await composeStorageCommand(
      rebuildRuntimeIsolation,
      [],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(usage.exitCode, 1);
    assert.match(
      usage.output,
      /authority, recovery inspection, credentials and span reconciliation are healthy; backup is reported, not gated/u,
    );
  });

  it("refuses restore without an exact named manifest", async () => {
    const paths = drillPaths();
    const database = open(paths);
    seedRealShapedAuthority(database,paths);
    database.close();
    const usage = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore"],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(usage.exitCode, 2);
    assert.match(usage.output, /requires the exact backup manifest/u);
    // A missing manifest is a refusal that names the file, never a fall-back
    // to whatever backup happens to be newest.
    const missing = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", join(paths.backupDirectory, "no-such.manifest.json")],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(missing.exitCode, 1);
    assert.match(missing.output, /no-such\.manifest\.json does not exist/u);
  });
});
