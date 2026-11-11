import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRunResourcesFactory } from "../../../../src/backend/app/composition/worker/run-resources.js";
import { assertProfileBrowserRoot } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { composeRuntimePreflight } from "../../../../src/backend/app/preflight/runtime-admission.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createNominatimWorkerAdapter } from "../../../../src/backend/processing/providers/nominatim-owner.js";
import { initialProtectedStoreRecord } from "../../../../src/models/config/protected-settings.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { boundProfileCredentials } from "../admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../fixtures/preflight-seams.js";

export async function delegationConfigResources(input: {
  database: AuthorityDatabase;
  deps: RunExecutorDependencies;
  admission: RuntimeAdmission;
  resolve(workflowId: string): AnyWorkflowDescriptor | undefined;
  descriptor: AnyWorkflowDescriptor;
}) {
  const { database, deps, admission } = input;
  const observations: { snapshotId: string; fingerprint: string; taskMs: number }[] = [];
  const preflight = composeRuntimePreflight({ admission, credentials: boundProfileCredentials(admission),
    database, clock: deps.clock, repoRoot: process.cwd(), isolation: rebuildRuntimeIsolation,
    descriptors: { resolve: workflowId => input.resolve(workflowId) }, descriptorSetHash: input.descriptor.contractFingerprint,
    protectedSecrets: { read: () => initialProtectedStoreRecord() }, environment: {}, runnerFactory: selected => {
      observations.push({ snapshotId: selected.scope.configSnapshotId,
        fingerprint: selected.scope.configFingerprint, taskMs: selected.config.timeouts.taskMs });
      return healthyRuntimePreflightRunners(selected);
    } });
  const artifacts = createContentAddressedArtifactWriter({ admission });
  await artifacts.ready;
  const resources = createRunResourcesFactory({ admission, database, authority: database.authority,
    artifacts, clock: deps.clock, ids: { uuid: randomUUID }, scheduler: deps.scheduler,
    isolation: rebuildRuntimeIsolation, environment: {}, preflight,
    nominatim: createNominatimWorkerAdapter(deps.clock),
    ocr: { capability: "ocr.extract", policy: { kind: "chatgpt-subscription-only", timeoutMs: 120_000 },
      invoke: async () => { throw new Error("snapshot proof must not call OCR"); } },
    protectedSecrets: { read: () => { throw new Error("snapshot proof must not read secrets"); } },
    duoCeremony: { openGate: () => { throw new Error("snapshot proof must not open Duo"); } },
    assertProfileOwner: () => { throw new Error("snapshot proof must not acquire a browser profile"); },
    assertBrowserRoot: root => assertProfileBrowserRoot(admission, root) });
  return {
    observations,
    async observe(run: RunRecord, signal: AbortSignal) {
      const selected = resources.forRun(run);
      const scope = preflight.runScope(run.envelope);
      const report = await preflight.admission.prepare(scope, signal);
      assert.ok(report.results.every(result => result.status === "pass"));
      preflight.admission.assertReady(scope);
      return selected;
    },
    stop: resources.stop,
  };
}
