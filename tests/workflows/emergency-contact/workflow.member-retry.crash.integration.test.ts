import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "vitest";
import { z } from "zod";
import { testProcessImport } from "../../support/compiled-process.js";
import { credentialKeychainTestEnvironment } from "../../support/helpers/credential-keychain-fake.js";

const launch = (args: string[]) => spawn(process.execPath,
  ["--import", testProcessImport(), fileURLToPath(new URL("../../support/processes/ec-member-retry-controller.ts", import.meta.url)), ...args],
  { env: credentialKeychainTestEnvironment(process.env), stdio: ["ignore", "ignore", "pipe", "ipc"] });

for (const boundary of ["before-commit", "retry", "resume", "resume-rollback", "fence", "commit", "resume-failed", "settlement", "settlement-failed", "parent-requested"]) describe(`EC crash at ${boundary}`, () => {
  let owner: ReturnType<typeof launch>;
  let closed: Promise<unknown[]>;
  let latest: unknown;
  beforeEach(async context => {
    owner = launch([boundary]);
    const errors: string[] = []; owner.stderr?.on("data", chunk => errors.push(String(chunk)));
    closed = once(owner, "close");
    owner.on("message", value => { latest = value; });
    const owned: { workspace?: string } = {};
    context.onTestFinished(async () => {
      if (owner.exitCode === null && owner.signalCode === null) { owner.kill("SIGKILL"); await closed; }
      if (owned.workspace !== undefined) rmSync(owned.workspace, { recursive: true, force: true });
    });
    const initial: unknown[] = await Promise.race([once(owner, "message"), closed.then(() => { throw new Error(`EC owner exited before evidence: ${errors.join("")}`); })]);
    owned.workspace = z.object({ workspace: z.string() }).parse(initial[0]).workspace;
  });
  it("retains immutable evidence through an actual process crash and fresh admitted reopen", async () => {
    const [, termination] = await closed; assert.equal(termination, "SIGKILL");
    const successor = launch([boundary, JSON.stringify(latest)]);
    const successorClosed: Promise<unknown[]> = once(successor, "close");
    const errors: string[] = []; successor.stderr?.on("data", chunk => errors.push(String(chunk)));
    try {
      const proof: unknown[] = await Promise.race([once(successor, "message"), successorClosed.then(() => { throw new Error(`EC successor exited before proof: ${errors.join("")}`); })]);
      assert.deepEqual(proof[0], { observed: true });
      const [code] = await successorClosed; assert.equal(code, 0, errors.join(""));
    } finally {
      if (successor.exitCode === null && successor.signalCode === null) { successor.kill("SIGKILL"); await successorClosed; }
    }
  });
});
