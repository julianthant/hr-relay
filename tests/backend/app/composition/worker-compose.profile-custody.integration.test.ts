import { runCredentialSourceRetentionCase } from "../../../support/helpers/credential-source-retention.js";
import assert from "node:assert/strict";
import { copyFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import * as artifactWriters from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { composeSelectedProfileStorage, RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import * as credentialStores from "../../../../src/backend/storage/configuration/credential-store.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { happySessionHarness } from "../../../support/helpers/phase1f-executor-harness.js";

for (const failure of ["none", "artifact", "artifact-and-close"] as const) it(`owns every bound worker startup stage with ${failure} failure`, async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  copyFileSync("package.json", join(f.workspace, "package.json"));
  const initialized = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  await initialized.account.close(); initialized.database.close();
  let artifactFailure: unknown;
  const closeFailure = new Error("synthetic actual database close failure");
  let issued: RuntimeAdmission | undefined, database: AuthorityDatabase | undefined;
  const createStore = credentialStores.createCredentialStore;
  let store: ReturnType<typeof createStore> | undefined;
  vi.spyOn(credentialStores, "createCredentialStore").mockImplementation(options => {
    issued = options.admission; store = createStore(options); return store;
  });
  const createWriter = artifactWriters.createContentAddressedArtifactWriter;
  let writerCreated = false;
  vi.spyOn(artifactWriters, "createContentAddressedArtifactWriter").mockImplementation(options => {
    const actual = createWriter(options); writerCreated = true;
    if (failure === "none") return actual;
    const held = join(f.workspace, "held-artifact-directory");
    renameSync(f.admission.artifactRoot, held);
    writeFileSync(f.admission.artifactRoot, "synthetic non-directory", { mode: 0o600 });
    return { stageDiagnostic: actual.stageDiagnostic.bind(actual), put: actual.put.bind(actual), open: actual.open.bind(actual), ready: actual.ready.catch(error => {
      artifactFailure = error;
      unlinkSync(f.admission.artifactRoot); renameSync(held, f.admission.artifactRoot);
      throw error;
    }) };
  });
  const lifetimeLock = f.lifetime;
  let opened: AuthorityDatabase | undefined;
  try {
    const running = composeWorkerRuntime({ lifetimeLock, admission: f.machine, repoRoot: f.workspace, isolation: rebuildRuntimeIsolation,
      args: ["person-lookup", "--pool-index", "1", "--drain"], clock, env: {},
      preflightRunnerFactory: healthyRuntimePreflightRunners, duoCeremony: await fixtureDuoCeremonyGates(clock), sessionFactory: happySessionHarness().factory,
      stopSignal: new AbortController().signal, write: () => undefined,
      openDatabase: (options, openClock) => {
        assert.ok(issued); assert.ok(store);
        database = AuthorityDatabase.open(issued, options, openClock, undefined, undefined, undefined, store);
        return database;
      },
      closeDatabase: database => {
        opened = database;
        lifetimeLock.assertHeld();
        if (failure === "artifact-and-close") throw closeFailure;
        database.close();
      } });
    if (failure === "none") assert.equal((await running).closure, "proved");
    else await assert.rejects(running, error => {
      if (failure === "artifact") return error === artifactFailure;
      assert.ok(error instanceof RuntimeCustodyUncertainError);
      const contains = (value: unknown, target: unknown): boolean => value === target
        || value instanceof AggregateError && value.errors.some(member => contains(member, target));
      assert.equal(contains(error, artifactFailure), true);
      assert.equal(contains(error, closeFailure), true);
      return true;
    });
    assert.equal(writerCreated, true);
    if (failure !== "none") assert.ok(artifactFailure instanceof Error);
    assert.ok(issued); assert.ok(database);
    const actualDatabase = database, actualChild = issued;
    f.machine.assertLive();
    if (failure === "artifact-and-close") {
      issued.assertLive(); assert.equal(database.getMeta().profileId, f.admission.profileBinding.profileId);
      lifetimeLock.assertHeld();
    } else {
      assert.throws(() => actualDatabase.getMeta(), /closed/u); assert.throws(() => actualChild.assertLive());
      lifetimeLock.assertHeld();
    }
  } finally { vi.restoreAllMocks(); opened?.close(); await f.close(); }
});

it("retains the actual native opening owner and both failures when invalid authority cannot close", async () => {
  await runCredentialSourceRetentionCase("worker-native-open");
});
