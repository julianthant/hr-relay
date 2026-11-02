import { createNativeBrowserProbe } from "../../../../src/backend/runtime/browser/native-browser.js";
import type { TestClock } from "../../../../src/rules/time/clock.js";
import type { BrowserSystemId } from "../../../../src/rules/identity/ids.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { boundProfileCredentials, type createBoundProfileFixture } from "../admission-fixture.js";
import { stopSyntheticDatabaseWorkers, detachBoundFixtureWorkers } from "../synthetic-database-admission.js";
import { testAdmittedWorker } from "../../fixtures/run-lifecycle-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { createBrowserSessionFactoryFixtures } from "./session-factory-fixtures.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createBrowserRoots,onboardingProfileDirectory, type BrowserRoots, type BrowserRootLaunchInput, type BrowserProfileProbeOptions } from "../../../../src/backend/storage/browser-roots.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import type { SignUpOperation } from "../../../../src/models/profiles/profile.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

// Consumer tests mock this port; registry authority is exercised by the storage integration tests.
export function mockBrowserRootPort() {
  let generation = 0;
  const probe = async (input: BrowserRootLaunchInput, options: BrowserProfileProbeOptions) => {
    mkdirSync(input.profileDirectory, { recursive: true, mode: 0o700 });
    await options.probe(input.profileRoot, input.profileDirectory);
  };
  const browserRoots: BrowserRoots = {
    inventory: () => ({ schemaVersion: 1, installationId: randomUUID(), revision: 0, nextGeneration: generation + 1, roots: [] }),
    beginLaunch: () => ({ launchId: randomUUID(), generation: ++generation, opened() {}, closing() {}, closed() {}, uncertain(error): never { throw error; } }),
    probe,
    async withUnused(directory, options, body, owner) {
      if (owner === undefined) throw new Error("mock-browser-root-owner-required");
      await probe(owner, options);
      return body({ assertCurrent() {}, remove() { rmSync(directory, { recursive: true }); mkdirSync(dirname(directory), { recursive: true, mode: 0o700 }); } });
    },
  };
  return { browserRoots, browserOwner: { profileId: randomUUID(), database: {} as AuthorityDatabase } };
}

export async function seedRegisteredBrowserProfiles(fixture: Pick<Awaited<ReturnType<typeof createBoundProfileFixture>>, "admission" | "stateRoot" | "path">, clock: TestClock, systems: readonly BrowserSystemId[]) {
  const database = AuthorityDatabase.open(fixture.admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "registered-browser-fixture" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(fixture.admission));
  const profileRoot = join(fixture.stateRoot, "browsers"), paths: string[] = [];
  try {
    const resolved = resolveConfigWithProvenance({}, { primaryDisplay: null }, clock, fixture.admission);
    database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, ...resolved, capturedAt: clock.now().toISOString() });
    const roots = createBrowserRoots(fixture.admission);
    const browser = createBrowserSessionFactoryFixtures(clock, randomUUID(), { schedule: () => ({ cancel() {} }) });
    for (const [index, system] of systems.entries()) {
      const worker = testAdmittedWorker(database, clock, { path: fixture.path, workflow: "person-lookup", poolIndex: index + 1, browserSystems: [system] });
      const profileDirectory = join(profileRoot, `w${String(worker.member.ordinal)}`, system);
      await roots.probe({ profileId: fixture.admission.profileBinding.profileId, profileRoot, profileDirectory, credentialFingerprint: resolved.fingerprint,
        owner: { kind: "worker", database, workerId: worker.workerId } }, createNativeBrowserProbe({ clock, scheduler: { schedule: () => ({ cancel() {} }) },
        closeProofMs: 1000, launchTimeoutMs: 1000, signal: new AbortController().signal, launcher: browser.fakeLauncher().launcher }));
      database.authority.workerControls.observe({ workerId: worker.workerId, leaseGeneration: worker.lease.leaseGeneration, sessionId: randomUUID(), system,
        configFingerprint: resolved.fingerprint, signInFingerprint: resolved.fingerprint, browserMode: "headless", profileDirectory, acceptDownloads: false, exclusive: false,
        health: "closed", observedAt: clock.now().toISOString(), openedAt: clock.now().toISOString(), profileRevision: 1 });
      paths.push(profileDirectory);
    }
    stopSyntheticDatabaseWorkers({ database, path: fixture.path }); detachBoundFixtureWorkers(database);
    return { profileRoot, paths };
  } finally { database.close(); }
}

export function seedRegisteredSignupBrowser(machine: RuntimeAdmission, operation: SignUpOperation): void {
  const draft = operation.onboarding;
  if (draft === undefined) throw new Error("fixture-onboarding-required");
  const profileRoot = join(machine.stateRoot, "browsers", "onboarding");
  const profileDirectory = onboardingProfileDirectory(profileRoot, { ...operation, accountId: draft.accountId, generation: draft.generation });
  const launch = createBrowserRoots(machine).beginLaunch({ profileId: operation.profileId, profileRoot, profileDirectory,
    credentialFingerprint: null, owner: { kind: "signup", operationId: operation.operationId, accountId: draft.accountId, providerGeneration: draft.generation } });
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 }); launch.opened();
}
