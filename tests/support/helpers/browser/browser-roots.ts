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
import { createBrowserRoots,onboardingProfileDirectory, type SignupBrowserRootInput, type BrowserRoots, type BrowserRootLaunchInput, type BrowserProfileProbeOptions } from "../../../../src/backend/storage/browser-roots.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import type { SignUpOperation } from "../../../../src/models/profiles/profile.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

// Consumer tests mock this port; registry authority is exercised by the storage integration tests.
export function mockBrowserRootPort() {
  let generation = 0, nextHandle = 1;
  const allocations = new Map<string, BrowserRootLaunchInput>();
  const key = (input: SignupBrowserRootInput) => JSON.stringify([input.profileId, input.profileRoot, input.owner]);
  const launch = () => ({ launchId: randomUUID(), generation: ++generation, opened() {}, closing() {}, closed() {}, async recover(_probe: BrowserProfileProbeOptions, assertCurrent: () => void, proof: () => Promise<void>) { assertCurrent(); await proof(); assertCurrent(); }, uncertain(error: unknown): never { throw error; } });
  const probe = async (input: BrowserRootLaunchInput, options: BrowserProfileProbeOptions) => {
    mkdirSync(input.profileDirectory, { recursive: true, mode: 0o700 });
    await options.probe(input.profileRoot, input.profileDirectory);
  };
  const browserRoots: BrowserRoots = {
    inventory: () => ({ schemaVersion: 2, installationId: randomUUID(), revision: 0, nextHandle, nextGeneration: generation + 1, roots: [] }),
    beginLaunch: launch,
    signupRoot: input => allocations.get(key(input)),
    beginSignupLaunch(input) {
      const root = allocations.get(key(input)) ?? { ...input, profileDirectory: onboardingProfileDirectory(input.profileRoot, nextHandle++) };
      allocations.set(key(input), root);
      return { ...launch(), input: root };
    },
    probe,
    async withUnused(directory, options, body, owner) {
      if (owner === undefined) throw new Error("mock-browser-root-owner-required");
      await probe(owner, options);
      return body({ assertCurrent() {}, remove() { for (const [id, allocation] of allocations) if (allocation.profileDirectory === directory) allocations.delete(id); rmSync(directory, { recursive: true }); mkdirSync(dirname(directory), { recursive: true, mode: 0o700 }); } });
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
  const launch = createBrowserRoots(machine).beginSignupLaunch({ profileId: operation.profileId, profileRoot,
    credentialFingerprint: null, owner: { kind: "signup", operationId: operation.operationId, accountId: draft.accountId, providerGeneration: draft.generation } });
  const profileDirectory = launch.input.profileDirectory;
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 }); launch.opened();
}
