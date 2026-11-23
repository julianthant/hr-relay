import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, expect } from "vitest";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { importProfileLibrary, resolveSourceRef, runProfileCopy, type Git } from "../../../scripts/profiles/profile-copy.js";
import { createBackupFixtures } from "../../support/helpers/storage/backup-fixtures.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, systemClock);
function workspace() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "relay-profile-copy-")));
  cleanups.push(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

it("imports the newest production workbook library into the independently signed-up copy while the source stays open", async () => {
  const source = await openCurrentWorld();
  const destinationWorkspace = workspace();
  const destination = await createBoundProfileFixture({ workspace: destinationWorkspace });
  cleanups.push(() => destination.close());
  const library = createWorkbookLibraryService({ repository: source.database.authority.workbooks, clock: systemClock, sync: unexpectedWorkbookSync });
  library.create({ name: "Example roster", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Sheet", width: 1, hidden: [],
    rows: [{ id: "row", cells: [{ value: "Example" }] }] }] });
  await takeBackup(source);
  library.create({ name: "Latest workbook", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Sheet", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: "Latest" }] }] }] });
  const backup = await takeBackup(source);
  const binding = destination.admission.profileBinding, sourceProfile = source.admission.profileBinding.profileId;
  const generation = source.database.getMeta().authorityGeneration;
  await destination.closeController();

  const lock = await acquireRuntimeLifetimeLock(0);
  cleanups.push(() => lock.close());
  const options = { sourceWorkspace: source.workspace, targetWorkspace: destinationWorkspace, sourceProfile };
  const imported = await importProfileLibrary(options, lock);
  expect(imported.sourceBackup.backupFileName).toBe(backup.manifest.backupFileName);
  expect(imported.created).toBe(2);
  expect((await importProfileLibrary(options, lock)).unchanged).toBe(2);

  const machine = acquireEntrypointAdmission(destinationWorkspace, "exclusive", lock);
  try {
    const admission = machine.admitProfile(binding.profileId);
    try {
      const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
      const database = AuthorityDatabase.open(admission, { path: destination.path, busyTimeoutMs: 250, migrationOwner: "profile-copy-test" },
        systemClock, undefined, undefined, undefined, credentials);
      try {
        expect(database.getMeta()).toMatchObject(binding);
        expect(database.authority.workbooks.catalog().map(entry => entry.name).sort()).toEqual(["Example roster", "Latest workbook"]);
      } finally { database.close(); }
    } finally { admission.release(); }
  } finally { machine.release(); }
  expect(source.database.getMeta().authorityGeneration).toBe(generation);
  expect(binding.installationId).not.toBe(source.admission.profileBinding.installationId);
});

it("follows the two environment branches and fetches from origin", () => {
  const calls: string[][] = [];
  const git: Git = args => { calls.push([...args]); return ""; };
  expect(resolveSourceRef("staging", git)).toBe("origin/staging");
  expect(resolveSourceRef("development", git)).toBe("origin/development");
  expect(calls).toEqual([["fetch", "--prune", "origin"], ["fetch", "--prune", "origin"]]);
});

it("refuses before touching Git while the copy dashboard holds its lifetime lock", async () => {
  const root = workspace(), held = await acquireRuntimeLifetimeLock(0);
  cleanups.push(() => held.close());
  const git: Git = () => { throw new Error("unexpected Git call"); };
  await expect(runProfileCopy({
    profile: "staging", repository: root, copyPath: join(root, "copy"), sourceWorkspace: join(root, "prod"),
    targetWorkspace: join(root, "staging"), git, acquire: () => acquireRuntimeLifetimeLock(held.port),
  })).rejects.toThrow("profile-running");
});

it("prepares a new worktree for independent signup and reports the ref, SHA and profile ports", async () => {
  const root = workspace(), copyPath = join(root, "copy");
  const calls: string[][] = [];
  const git: Git = args => {
    calls.push([...args]);
    if (args[0] === "worktree") mkdirSync(copyPath);
    if (args[0] === "show") return JSON.stringify({ scripts: { "dashboard:staging": "tsx scripts/dev/dashboard.ts --profile=staging" } });
    return args[0] === "rev-parse" ? "0123abc" : "";
  };
  const installed: string[] = [];
  const result = await runProfileCopy({
    profile: "staging", repository: root, copyPath, sourceWorkspace: join(root, "prod"),
    targetWorkspace: join(root, "staging"), git, gitFor: () => git, acquire: () => acquireRuntimeLifetimeLock(0),
    install: path => { installed.push(path); },
  });
  expect(result).toContain("profile: staging");
  expect(result).toContain("origin/staging @ 0123abc");
  expect(result).toContain("backend 3941, frontend 5175, lock 3942");
  expect(calls).toContainEqual(["worktree", "add", "--detach", copyPath, "0123abc"]);
  expect(installed).toEqual([copyPath]);
});
