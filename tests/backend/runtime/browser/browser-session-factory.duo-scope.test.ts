import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { defineVerifiedLoginRecipe } from "../../../../src/backend/systems/browser-shared/authenticated-application.js";
import type { SystemLoginContext } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import type { DuoCeremonyGate } from "../../../../src/workflow-kit/duo-ceremony-lease.js";
import { assertDuoCeremonyLeaseToken } from "../../../../src/workflow-kit/duo-ceremony-lease.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { FIXTURE_DUO_CREDENTIAL_KEY, fixtureDuoCeremonyGate } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { fixtureDuoSigningSource, fixtureWorkflowWorker } from "../../../support/helpers/browser/duo-signing.js";

const modes = ["valid", "valid-and-cleared", "absent", "forged", "retired", "wrong-system", "wrong-worker", "wrong-credential", "expired"] as const;

describe("actual factory and recipe signing scope", () => {
  for (const mode of modes) it(`${mode} uses the repository-issued token and actual callback wiring`, async () => {
    const clock = manualClock(new Date("2026-11-01T00:00:00Z"));
    const canonicalWorker = WorkerIdSchema.parse("person-lookup-worker-1");
    const workerId = mode === "wrong-worker" ? WorkerIdSchema.parse("other-worker") : canonicalWorker;
    const gate = await fixtureDuoCeremonyGate(mode === "wrong-system" ? "crm" : "ucpath", canonicalWorker, clock);
    const { withTempRuntime, factoryFor, fakeLauncher, recordingBindings } = createBrowserSessionFactoryFixtures(clock,
      randomUUID(), { schedule: () => ({ cancel() {} }) });
    await withTempRuntime(async ({ config }) => {
      const broker = fixtureWorkflowWorker();
      let signs = 0, authenticated = false, scopeSeen = false, tokenStillCurrentAfterScope = false, brokerStopped = false;
      let reply: (() => void) | undefined, stopped: (() => void) | undefined;
      const stopPromise = new Promise<void>(resolve => { stopped = resolve; });
      broker.owner.reply = () => reply?.();
      const stop = broker.owner.stop.bind(broker.owner);
      broker.owner.stop = () => { brokerStopped = true; stop(); stopped?.(); };
      const request = async () => {
        const replyPromise = new Promise<void>(resolve => { reply = resolve; });
        broker.request({ id: randomUUID(), request: { requestId: randomUUID(), rpId: "duosecurity.com", origin: "https://test.duosecurity.com",
          challenge: "AQID", allowCredentials: ["AQID"], accountNames: ["fixture-user"] } });
        await Promise.race([replyPromise, stopPromise]);
      };
      const source = fixtureDuoSigningSource({ identity: () => mode === "wrong-credential" ? FingerprintSchema.parse("e".repeat(64)) : FIXTURE_DUO_CREDENTIAL_KEY,
        credentials: () => [{ credentialId: "AQID", rpId: "duosecurity.com", transport: "usb", isResidentCredential: false }],
        async sign(input) { signs++; return { credentialId: input.credentialId, authenticatorData: "AQID", clientDataJSON: "AQID",
          signature: "AQID", transport: "usb", userHandle: null, signCount: signs }; } });
      const recipe = defineVerifiedLoginRecipe({ system: "ucpath", navigate: async () => undefined,
        verify: async () => authenticated ? { authenticated: true, evidence: { system: "ucpath", url: "https://fixture.invalid/app", positive: "fixture ready", negative: "fixture no sign-in" } }
          : { authenticated: false, reason: "fixture login required" },
        ceremony: async () => { await request(); authenticated = true; },
      });
      const baseBindings = recordingBindings();
      assert.ok(baseBindings.ucpath);
      const bindings = { ...baseBindings, ucpath: { ...baseBindings.ucpath, login: async (context: SystemLoginContext) => {
        assert.ok(context.withDuoSigningScope); scopeSeen = true;
        if (mode === "absent") { const { withDuoSigningScope: _scope, ...unscoped } = context; return recipe(unscoped); }
        return recipe(context);
      } } };
      const injectedGate: DuoCeremonyGate = { withCeremony: run => gate.withCeremony(async token => {
        if (mode === "retired") gate.dispose();
        if (mode === "expired") clock.advanceWall(Date.parse(token.expiresAt) - clock.nowMs() + 1);
        // A structural copy deliberately has no repository-issued identity.
        const result = await run(mode === "forged" ? { ...token } : token);
        if (mode === "valid-and-cleared") {
          assertDuoCeremonyLeaseToken(token, { system: "ucpath" }); tokenStillCurrentAfterScope = true;
          assert.equal(signs, 1); assert.equal(brokerStopped, false); await request();
        }
        return result;
      }) };
      const resource = await factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, fakeLauncher({ serviceWorker: broker.worker }),
        bindings, undefined, undefined, undefined, source).open({ workerId, workflowId: WorkflowIdSchema.parse("person-lookup"), system: "ucpath", instance: "prod",
          configFingerprint: FingerprintSchema.parse("a".repeat(64)), acceptDownloads: false, exclusive: false, signal: new AbortController().signal, duoCeremony: injectedGate });
      try {
        if (mode === "valid") assert.equal(await resource.authentication.authenticate("ucpath", {}), "logged-in");
        else await assert.rejects(resource.authentication.authenticate("ucpath", {}));
        assert.equal(scopeSeen, true);
        assert.equal(signs, mode === "valid" || mode === "valid-and-cleared" ? 1 : 0);
        assert.equal(tokenStillCurrentAfterScope, mode === "valid-and-cleared");
      } finally { await resource.close({ reason: "worker-stop" }); gate.dispose(); }
    });
  });
});
