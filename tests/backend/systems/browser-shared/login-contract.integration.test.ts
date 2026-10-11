import { hostConfigFacts } from "../../../../src/models/config/host-display.js";

import assert from "node:assert/strict";
import type { Page } from "playwright";
import { afterEach,describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import type { DuoCeremonyGateFactory } from "../../../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { defineVerifiedLoginRecipe } from "../../../../src/backend/systems/browser-shared/authenticated-application.js";
import type { SystemLoginContext } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { DuoTerminalRefusalError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import type { BrowserSystemId,WorkerId } from "../../../../src/rules/identity/ids.js";
import {
BrowserSessionIdSchema,
FingerprintSchema,
WorkerIdSchema,
WorkflowIdSchema,
} from "../../../../src/rules/identity/ids.js";
import type { TestClock } from "../../../../src/rules/time/clock.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import type { DuoCeremonyLeaseToken } from "../../../../src/workflow-kit/duo-ceremony-lease.js";
import type {
BrowserSessionCloseProof,
WorkerBrowserSessionFactory,
} from "../../../../src/workflow-kit/session.js";
import {
duoCeremonyGatesOver,
FIXTURE_DUO_CREDENTIAL_KEY,
openDuoCeremonyLeaseDatabase
} from "../../../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS,ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";
import type { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");
const WORKER_A = WorkerIdSchema.parse("person-lookup-worker-1");
const RUN_FINGERPRINT = FingerprintSchema.parse("3".repeat(64));
const SYSTEM: BrowserSystemId = "ucpath";
const NEED = { system: SYSTEM, access: "read", session: "reuse-worker" } as const;
const T0 = new Date("2026-08-21T12:00:00.000Z");
const CONFIG = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(T0)).config;

interface CeremonyScript {
  /** Called with the minted token when the ceremony half starts. Resolve it to let the ceremony finish. */
  readonly onCeremony: (token: DuoCeremonyLeaseToken, context: SystemLoginContext) => Promise<void>;
}


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
function sharedAuthority(clock: TestClock): AuthorityDatabase {
  const database = openDuoCeremonyLeaseDatabase(clock);
  database.withAuthorityTransaction(repositories => {
    repositories.workerPools.plan({ workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 2, requestedBy: "local-operator", now: clock.now().toISOString() });
    for (const poolIndex of [1, 2]) repositories.workerSlots.allocate({ workflow: WORKFLOW_ID, poolIndex, commandId: null, now: clock.now().toISOString() });
  });
  databases.push(database);
  return database;
}
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function leaseRow(database: AuthorityDatabase) {
  const row = database.authority.duoCeremonyLeases.get(FIXTURE_DUO_CREDENTIAL_KEY);
  assert.ok(row !== undefined, "the credential's lease row must exist");
  return row;
}

describe("two workers, one credential, one ceremony at a time", () => {

  it("recovers from ONE Duo terminal refusal on a fresh profile under the SAME lease generation", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const tokens: DuoCeremonyLeaseToken[] = [];
    let refusalsLeft = 1;
    const a = recipeFactory(WORKER_A, {
      onCeremony: async (token, context) => {
        tokens.push(token);
        if (refusalsLeft > 0) {
          refusalsLeft -= 1;
          throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", context.page.url());
        }
      },
    });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    const result = await manager.withDriver(NEED, "prod", new AbortController().signal, async () => "recovered");
    assert.equal(result, "recovered");
    assert.equal(a.opens(), 2, "the burned context was replaced by a fresh one");
    assert.equal(a.closes(), 1, "the burned context was closed with proof before the directory was touched");
    assert.deepEqual(a.discards(), [{
      workerId: WORKER_A, system: SYSTEM, instance: "prod", configFingerprint: RUN_FINGERPRINT, browserMode: "headless",
    }]);
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0], tokens[1], "the retry ran under the very token the first ceremony held");
    assert.equal(tokens[0]?.generation, 1);
    assert.equal(leaseRow(database).generation, 1, "no release and re-acquire happened between the two attempts");
    assert.equal(leaseRow(database).state, "released");
    await manager.closeAll("worker-stop");
  });

  it("fails loud naming the profile directory on the SECOND refusal, and releases the lease", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const a = recipeFactory(WORKER_A, {
      onCeremony: async (_token, context) => {
        throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", context.page.url());
      },
    });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    await assert.rejects(
      manager.withDriver(NEED, "prod", new AbortController().signal, async () => "never"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Duo refused the WebAuthn assertion AGAIN on a freshly created profile at \/tmp\/fixture-profiles\/person-lookup-worker-1\/ucpath/);
        assert.match(error.message, /not deleted a third time/);
        assert.ok(error.cause instanceof DuoTerminalRefusalError);
        return true;
      },
    );
    assert.equal(a.discards().length, 1, "the directory was recreated exactly once");
    assert.equal(a.opens(), 2);
    assert.equal(a.closes(), 2, "both burned contexts were closed with proof");
    assert.equal(leaseRow(database).generation, 1);
    assert.equal(leaseRow(database).state, "released", "the lease is released after the second refusal");
  });

  it("refuses the recovery by name when the factory cannot discard a profile, and releases the lease", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = sharedAuthority(clock);
    const a = recipeFactory(WORKER_A, {
      onCeremony: async (_token, context) => {
        throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", context.page.url());
      },
    }, { withDiscard: false });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    await assert.rejects(
      manager.withDriver(NEED, "prod", new AbortController().signal, async () => "never"),
      /cannot discard the burned browser profile \(no discardProfile\)/,
    );
    assert.equal(a.opens(), 1, "no retry without a fresh profile");
    assert.equal(a.closes(), 1);
    assert.equal(leaseRow(database).state, "released");
  });
});
