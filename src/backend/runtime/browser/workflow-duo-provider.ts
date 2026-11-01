import { hasUnprovedSourceClosure } from "../../storage/source-closure.js";
import type { BrowserContext } from "playwright";
import { z } from "zod";
import type { Config } from "../../../models/config/schema.js";
import { DuoWorkflowRequestSchema, type DuoSigningSource } from "../../storage/configuration/duo-signing.js";
import { duoAccountMatches } from "../../profiles/profile-onboarding.js";

const RequestSchema = z.strictObject({ id: z.uuid(), request: DuoWorkflowRequestSchema });

export async function provisionWorkflowDuo(input: Readonly<{
  context: BrowserContext; config: Config; source: DuoSigningSource; accountName: string;
  assertOwner(): void;
  assertSigningScope(): void;
}>): Promise<Readonly<{ assertCurrent(): void; stop(): Promise<void> }>> {
  const { context, config, source } = input;
  let stopped = false;
  let failure: Error | undefined;
  const current = (): void => {
    input.assertOwner(); source.assertCurrent();
    if (failure !== undefined) throw failure;
    if (stopped) throw new Error("duo-session-revoked");
  };
  const signingCurrent = (): void => { current(); input.assertSigningScope(); };
  const ownedWorker = (url: string): boolean => /^chrome-extension:\/\/[a-p]{32}\/src\/workflow-background\.js$/u.test(url);
  current();
  const workers = context.serviceWorkers().filter(worker => ownedWorker(worker.url()));
  if (workers.length > 1) throw new Error("duo-worker-ambiguous");
  const worker = workers[0] ?? await context.waitForEvent("serviceworker", { predicate: value => ownedWorker(value.url()), timeout: config.timeouts.navigationMs });
  current();
  const call = (method: "install" | "next" | "assertContext" | "reply" | "stop", args: readonly unknown[] = []) => worker.evaluate(async command => {
    const owner: unknown = Reflect.get(globalThis, "relayWorkflow");
    if (typeof owner !== "object" || owner === null) throw new Error("duo-worker-unavailable");
    const operation: unknown = Reflect.get(owner, command.method);
    if (typeof operation !== "function") throw new Error("duo-worker-unavailable");
    const result: unknown = await Reflect.apply(operation, owner, command.args);
    return result;
  }, { method, args });
  await call("install");
  current();
  let stopping: Promise<void> | undefined;
  const stopWorker = (): Promise<void> => stopping ??= call("stop").then(() => undefined);
  const pump = (async () => {
    while (!stopped) {
      current();
      const raw = await call("next");
      if (stopped && raw === null) return;
      current();
      const { id, request } = RequestSchema.parse(raw);
      signingCurrent();
      await call("assertContext", [id]); signingCurrent();
      const owner = input.accountName.includes("@") ? input.accountName : `${input.accountName}@ucsd.edu`;
      if (request.accountNames.some(name => !duoAccountMatches(owner, name))
        || request.allowCredentials.length === 0 && request.accountNames.length === 0) throw new Error("duo-account-mismatch");
      const candidates = source.credentials().filter(credential => credential.rpId === request.rpId
        && (request.allowCredentials.length > 0
          ? request.allowCredentials.some(allowed => Buffer.from(allowed, "base64").equals(Buffer.from(credential.credentialId, "base64url")))
          : credential.isResidentCredential && credential.userHandle !== undefined && credential.userHandle.length > 0));
      const credential = candidates.find(row => row.transport === (request.allowCredentials.length > 0 ? "internal" : "usb")) ?? candidates[0];
      let value: unknown = { passThrough: true };
      if (credential !== undefined) {
        const assertion = await source.sign({ requestId: request.requestId, origin: request.origin, rpId: request.rpId,
          challenge: request.challenge, credentialId: credential.credentialId });
        signingCurrent();
        value = { ok: true, credentialId: assertion.credentialId, authenticatorData: assertion.authenticatorData,
          clientDataJSON: assertion.clientDataJSON, signature: assertion.signature, userHandle: assertion.userHandle, transport: assertion.transport };
      }
      signingCurrent();
      await call("assertContext", [id]); signingCurrent();
      await call("reply", [id, { ok: true, value }]); signingCurrent();
    }
  })().catch(async error => {
    if (!stopped || hasUnprovedSourceClosure(error)) failure = error instanceof Error ? error : new Error("duo-signing-unavailable", { cause: error });
    try { await stopWorker(); }
    catch (stopError) { failure = new AggregateError([error, stopError], "duo-broker-stop-unproved", { cause: stopError }); }
  });
  return Object.freeze({ assertCurrent: current, async stop() {
    stopped = true;
    const outcomes = await Promise.allSettled([stopWorker(), pump]);
    const errors: unknown[] = [];
    for (const result of outcomes) if (result.status === "rejected") { const reason: unknown = result.reason; errors.push(reason); }
    if (hasUnprovedSourceClosure(failure) && !errors.includes(failure)) errors.push(failure);
    if (errors.length > 0) throw new AggregateError(errors, "duo-broker-stop-unproved");
  } });
}
