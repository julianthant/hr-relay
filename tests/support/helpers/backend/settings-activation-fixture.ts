import { RunEnvelopeSchema } from "../../../../src/models/run/envelope.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createBoundProfileFixture } from "../admission-fixture.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, type SettingsPatch } from "../../../../src/models/config/settings.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { createCredentialStore } from "../synthetic-storage-admission.js";
import { executeSettingsCommand, type CommandAuthority } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService, type CreateRunRequest, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { QUEUED_RUN } from "../../fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";

export function settingsFixture(isolateBrowser = false) {
  const profile = createBoundProfileFixture();
  const root = profile.stateRoot;
  const path = profile.path;
  const clock = manualClock(new Date("2026-09-09T12:00:00.000Z"));
  const host = hostConfigFacts({ HRAUTO_HOST_PRIMARY_DISPLAY: "2560x1440" });
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 10, migrationOwner: "settings-proof" }, clock);
  const resolveSettings = (value: unknown) => {
    const result = resolveConfigWithProvenance(value, host, clock);
    const configured = result;
    if (!isolateBrowser) return configured;
    // A fixed process configuration for the synthetic launch target; these roots are
    // deliberately not editable settings and never appear in the save patch.
    const config = { ...configured.config, paths: { ...configured.config.paths, browserProfileRoot: join(root, "profiles"),
      downloadsDir: join(root, "downloads"), duoExtensionDir: join(root, "extension") },
      features: { ...configured.config.features, duoWebAuthn: false } };
    return { ...configured, config, fingerprint: FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(config))) };
  };
  const resolved = resolveSettings({});
  const snapshot = { ...resolved, configSnapshotId: randomUUID(), revision: 1,
    capturedAt: clock.now().toISOString(), capturedBy: "local-operator" };
  database.authority.runtimeConfig.initialize(snapshot);
  let resolutions = 0;
  const settings = createSettingsApplicationExecutor((value) => {
    resolutions += 1; return resolveSettings(value);
  }, createCredentialStore({ stateRoot: root }));
  const command = (patch: SettingsPatch, expectedRevision: number = readSettings(database.authority).revision) => ({
    commandId: randomUUID(), family: "settings", type: "apply-settings", requestedAt: clock.now().toISOString(),
    requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
  });
  const execute = (request: unknown, authority: CommandAuthority = database) => executeSettingsCommand({
    authority, settings, clock, ids: { uuid: randomUUID },
  }, request);
  const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
  const published: string[] = [];
  const service = new RunRecordService({ database, clock, ids: { uuid: randomUUID }, publishQueued: (run) => {
    emitter.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Settings proof" }));
    database.afterAuthorityCommit(() => published.push(run.envelope.runId));
  } });
  const request = (overrides: Partial<CreateRunRequest> = {}): CreateRunRequest => ({
    commandId: randomUUID(), code: "pl", matchKey: "settings-proof", workflow: "person-lookup",
    descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
    configFingerprint: snapshot.fingerprint, configSnapshotId: snapshot.configSnapshotId,
    resolvedInstance: RunEnvelopeSchema.shape.resolvedInstance.parse(QUEUED_RUN.envelope.resolvedInstance), priority: "bulk", shape: "single", dryRun: true,
    input: QUEUED_RUN.input, runtimeConfig: selectRunRuntime(database.authority), ...overrides,
  });
  return { root, path, clock, host, database, snapshot, service, request, command, execute, published,
    resolutions: () => resolutions,
    save: (patch: SettingsPatch) => execute(command(patch)),
    create: (overrides: Partial<CreateRunRequest> = {}) => requireLifecycleApplied(service.create(request(overrides))),
    close: () => { database.close(); profile.close(); },
  };
}
