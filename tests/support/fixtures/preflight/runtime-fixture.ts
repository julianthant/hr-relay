import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { createBoundProfileFixture, boundProfileCredentials, type BoundProfileStorageFixture } from "../../helpers/admission-fixture.js";
import { copyFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialProtectedStoreRecord, PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedStoreRecordSchema } from "../../../../src/models/config/protected-settings.js";
import { PreflightAdmissionScopeSchema } from "../../../../src/rules/preflight/preflight-admission.js";
import { createPreflightAuthority, type PreflightRunner } from "../../../../src/models/preflight/preflight.js";
import { PROVIDER_ADAPTER_SPECS, SYSTEM_RUNTIME_SPECS, type RuntimeCapability } from "../../../../src/models/runtime/runtime-dependencies.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { createRuntimePreflightRunners, type RuntimePreflightRunnerInput } from "../../../../src/backend/app/preflight/runtime-runners.js";
import { createTimeoutDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/timeout-deadline-scheduler.js";
import { createDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";

export function populatedProtectedRecord(omitted?: string) {
  const names = ["ucpathUserId", "ucpathPassword", "timekeeperName", "sharepointOnboardingRosterUrl"];
  return ProtectedStoreRecordSchema.parse({ ...initialProtectedStoreRecord(), revision: 2,
    entries: Object.fromEntries(names.filter(name => name !== omitted).map((name, index) => [name, {
      value: name === "sharepointOnboardingRosterUrl" ? "https://example.invalid/private-marker" : "private-marker",
      valueId: `${String(index+1).repeat(8)}-1111-4111-8111-111111111111`, updatedAt: "2026-09-19T12:00:00.000Z",
    }])),
    lastApplied: { commandId: "77777777-7777-4777-8777-777777777777", commandFingerprint: "7".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: "88888888-8888-4888-8888-888888888888" },
  });
}

/** Fresh private inputs; the executable factory, strict authority and SQLite doctor are production code. */
export async function runtimeFixture(capabilities: readonly RuntimeCapability[], profileFixture?: () => Promise<BoundProfileStorageFixture>) {
  const profile = await (profileFixture ?? createBoundProfileFixture)();
  const root = profile.workspace, stateRoot = profile.stateRoot, artifactRoot = profile.admission.artifactRoot;
  const clock = manualClock(new Date("2026-09-19T12:00:00.000Z"));
  const duo = createDuoCredentialStore(profile.admission, clock);
  const databasePath = join(stateRoot, "state.db");
  const database = AuthorityDatabase.open({ path: databasePath, busyTimeoutMs: 100, migrationOwner: "setup-corpus" }, clock);
  database.close();
  copyFileSync(join(process.cwd(), "package.json"), join(root, "package.json"));
  copyFileSync(join(process.cwd(), "package-lock.json"), join(root, "package-lock.json"));
  const config = structuredClone(resolveConfigWithProvenance({}, hostConfigFacts({}), clock, { stateRoot, artifactRoot }).config);
  config.paths.duoExtensionDir = join(root, "extension");
  config.features.duoWebAuthn = true;
  mkdirSync(config.paths.duoExtensionDir); writeFileSync(join(config.paths.duoExtensionDir, "workflow-manifest.json"), "{}");
  const executable = join(root, "chromium"); writeFileSync(executable, "synthetic executable asset", {mode: 0o700});
  config.annualDates.FY2027 = {jobEndDate:"6/30/2027", kronosDefaultStartDate:"7/1/2026", kronosDefaultEndDate:"6/30/2027"};
  for (const system of SYSTEM_RUNTIME_SPECS) Reflect.set(config.urls[system.configKey], "prod",
    Object.fromEntries(system.routes.map(route => [route, `https://prod.example.invalid/${route}`])));
  const providerAvailability: Record<string, boolean> = {};
  for (const provider of PROVIDER_ADAPTER_SPECS) {
    for (const capability of provider.capabilities) providerAvailability[`${provider.provider}/${capability}`] = true;
  }
  let record = populatedProtectedRecord();
  const doctorOptions = { stateRootTrustAnchor: root, stateRoot, authorityPath: databasePath, backupDirectory: join(stateRoot, "backups", "authority"), busyTimeoutMs: 100 };
  const input: RuntimePreflightRunnerInput = { config, duo, providerAvailability, protectedSecrets: { read: () => record }, browserExecutablePath: () => executable,
    scope: PreflightAdmissionScopeSchema.parse({configSnapshotId:"11111111-1111-4111-8111-111111111111", configFingerprint:"a".repeat(64), descriptorFingerprint:"b".repeat(64), requestedCapabilities:capabilities}),
    dashboard: {repoRoot:root, stateRoot, artifactRoot, backendPort:0, frontendPort:0, clock,
      authorityHealth: new AuthorityHealthPreflightRunner(profile.admission, doctorOptions, clock, boundProfileCredentials(profile.admission)) },
  };
  const report = (transform?: (runners: readonly PreflightRunner[]) => readonly PreflightRunner[]) => {
    const runners = createRuntimePreflightRunners(input);
    return createPreflightAuthority({...input.scope, runners: transform === undefined ? runners : transform(runners), clock, scheduler:createTimeoutDeadlineScheduler(clock)}).refresh(new AbortController().signal);
  };
  return {root, duo, credentials: boundProfileCredentials(profile.admission), admission: profile.admission, stateRoot, artifactRoot, databasePath, doctorOptions, clock, input, executable, report, setProtected(next: typeof record) {record=next;}, async close() {
    if (profileFixture !== undefined) for (const name of ["package.json", "package-lock.json", "extension", "chromium"]) rmSync(join(root, name), { recursive: true });
    await profile.close();
  }};
}
