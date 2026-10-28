import { testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { syntheticDatabasePath } from "../synthetic-database-admission.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { type DuoCeremonyGateFactory } from "../../../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { defineVerifiedLoginRecipe } from "../../../../src/backend/systems/browser-shared/authenticated-application.js";
import { type SystemLoginContext } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { type BrowserSystemId, type WorkerId, BrowserSessionIdSchema, FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { type TestClock, manualClock } from "../../../../src/rules/time/clock.js";
import { type DuoCeremonyLeaseToken } from "../../../../src/workflow-kit/duo-ceremony-lease.js";
import { type BrowserSessionCloseProof, type WorkerBrowserSessionFactory } from "../../../../src/workflow-kit/session.js";
import { FIXTURE_DUO_CREDENTIAL_KEY, openDuoCeremonyLeaseDatabase } from "../duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../phase1f-executor-harness.js";
import { type AuthorityDatabase } from "../synthetic-storage-admission.js";

interface CeremonyScript {
  /** Called with the minted token when the ceremony half starts. Resolve it to let the ceremony finish. */
  readonly onCeremony: (token: DuoCeremonyLeaseToken, context: SystemLoginContext) => Promise<void>;
}



export function createLoginContractTestWorld() {
  const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");

  const WORKER_A = WorkerIdSchema.parse("person-lookup-worker-1");

  const RUN_FINGERPRINT = FingerprintSchema.parse("3".repeat(64));

  const SYSTEM: BrowserSystemId = "ucpath";

  const NEED = { system: SYSTEM, access: "read", session: "reuse-worker" } as const;

  const T0 = new Date("2026-08-21T12:00:00.000Z");

  const CONFIG = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(T0)).config;

  function recipeFactory(
    workerId: WorkerId,
    script: CeremonyScript,
    options: Readonly<{ withDiscard?: boolean }> = {},
  ): Readonly<{
    factory: WorkerBrowserSessionFactory;
    opens: () => number;
    closes: () => number;
    discards: () => readonly unknown[];
  }> {
    let opens = 0;
    let closes = 0;
    const discards: unknown[] = [];
    const page = { url: () => "https://app.example/" } as unknown as Page;
    const factory: WorkerBrowserSessionFactory = {
      probeProfile: async () => undefined,
      async open(input) {
        opens += 1;
        let ceremonyCompleted = false;
        const sessionId = BrowserSessionIdSchema.parse(`00000000-0000-4000-8000-${String(opens).padStart(12, "0")}`);
        const recipe = defineVerifiedLoginRecipe({
          system: SYSTEM,
          verify: async () => ceremonyCompleted
            ? { authenticated: true, evidence: { system: SYSTEM, url: page.url(), positive: "stub session", negative: "no form" } }
            : { authenticated: false, reason: "the stub session is not proven until the ceremony ran" },
          navigate: async () => undefined,
          ceremony: async (context, token) => {
            await script.onCeremony(token, context);
            ceremonyCompleted = true;
          },
        });
        return {
          profileRevision: 1,
          sessionId,
          system: input.system,
          instance: input.instance,
          configFingerprint: input.configFingerprint,
          signInFingerprint: input.configFingerprint,
          acceptDownloads: input.acceptDownloads,
          exclusive: input.exclusive,
          driver: { system: input.system },
          authentication: {
            authenticate: (system, authOptions) => recipe({
              page,
              config: CONFIG,
              instance: "prod",
              label: `worker ${workerId} ${system} session`,
              signal: authOptions.signal ?? input.signal,
              credentials: { userId: "stub-user", password: "stub-pass" },
              recordEvidence: () => undefined,
              duoCeremony: input.duoCeremony,
            }),
          },
          async reset() { return undefined; },
          async close(): Promise<BrowserSessionCloseProof> {
            closes += 1;
            return { sessionId, system: input.system, pagesClosed: true, contextClosed: true };
          },
        };
      },
      ...(options.withDiscard === false ? {} : {
        async discardProfile(input) {
          discards.push(input);
          return { profileDirectory: `/tmp/fixture-profiles/${input.workerId}/${input.system}` };
        },
      }),
    };
    return { factory, opens: () => opens, closes: () => closes, discards: () => Object.freeze([...discards]) };
  }

  function managerFor(
    workerId: WorkerId,
    factory: WorkerBrowserSessionFactory,
    clock: TestClock,
    scheduler: ManualScheduler,
    duoCeremony: DuoCeremonyGateFactory,
  ): WorkerSessionManager {
    const manager = new WorkerSessionManager({
      workerId,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory,
      clock,
      scheduler,
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony,
    });
    manager.bindRunConfigFingerprint(RUN_FINGERPRINT);
    return manager;
  }

  const databases: AuthorityDatabase[] = [];

  async function sharedAuthority(clock: TestClock): Promise<AuthorityDatabase> {
    const database = await openDuoCeremonyLeaseDatabase(clock);
    for (const poolIndex of [1, 2]) testWorkerPorts(database, clock, {
      path: syntheticDatabasePath(database), descriptor: personLookupDescriptor, poolIndex,
    });
    databases.push(database);
    return database;
  }

  function leaseRow(database: AuthorityDatabase) {
    const row = database.authority.duoCeremonyLeases.get(FIXTURE_DUO_CREDENTIAL_KEY);
    assert.ok(row !== undefined, "the credential's lease row must exist");
    return row;
  }
  const cleanup = () => {
    for (const database of databases.splice(0)) database.close();
  };
  return { WORKER_A, SYSTEM, NEED, T0, recipeFactory, managerFor, databases, sharedAuthority, leaseRow, RUN_FINGERPRINT, cleanup };
}
