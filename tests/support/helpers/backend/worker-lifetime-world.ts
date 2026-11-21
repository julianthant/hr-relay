import { testProcessImport } from "../../compiled-process.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../fixtures/phase1c-contract-fixtures.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { writeFenceFixtureInput } from "../write-fence-fixture.js";

import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";


import type { createRunRecordServiceTestWorld } from "./run-record-service-world.js";

const ownerLines = new WeakMap<ChildProcess, () => Promise<string>>();
function readOwnerLine(child: ChildProcess): Promise<string> {
  const existing = ownerLines.get(child);
  if (existing !== undefined) return existing();
  if (child.stdout === null) throw new Error("fence owner has no stdout");
  let pending = "";
  const queue: string[] = [];
  let notify: (() => void) | undefined;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    pending += chunk;
    for (let newline = pending.indexOf("\n"); newline !== -1; newline = pending.indexOf("\n")) {
      queue.push(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      notify?.();
      notify = undefined;
    }
  });
  const read = async (): Promise<string> => {
    const deadline = Date.now() + 15_000;
    while (queue.length === 0) {
      if (Date.now() > deadline) throw new Error("fence owner produced no line");
      await new Promise<void>(resolve => { notify = resolve; setTimeout(resolve, 50); });
    }
    const line = queue.shift();
    if (line === undefined) throw new Error("fence owner closed its channel");
    return line;
  };
  ownerLines.set(child, read);
  return read();
}
export async function ownedWorkerLifetimeFixture(world: ReturnType<typeof createRunRecordServiceTestWorld>, options?: { fenceInOwner?: boolean }) {
  const h = await world.fixture();
  const children = new Set<() => Promise<void>>();
  const dispose = async () => {
    const failures = (await Promise.allSettled([...children].map(stop => stop())))
      .flatMap(result => result.status === "rejected" ? [result.reason as unknown] : []);
    if (failures.length > 0) throw new AggregateError(failures, "fixture worker cleanup failed");
  };
  const slot = h.database.authority.workerSlots.list()[0];
  if (slot === undefined) throw new Error("missing member");
  const now = h.clock.now().toISOString();
  const owner = async (authorityPath = join(h.root, "state.db"), onSpawn?: (child: ChildProcess) => void) => {
    const child = options?.fenceInOwner === true
      ? spawn(process.execPath, ["--import", testProcessImport(), fileURLToPath(new URL("../../../support/processes/write-fence-owner.ts", import.meta.url)), authorityPath, String(h.lifetime.port)], { stdio: ["pipe", "pipe", "inherit", "ipc"] })
      : spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: {} });
    const closed = new Promise<void>(resolve => { child.once("close", () => resolve()); });
    const stop = async () => {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await closed;
      children.delete(stop);
    };
    children.add(stop);
    try {
      await once(child, "spawn");
      onSpawn?.(child);
      if (options?.fenceInOwner === true) {
        await h.lifetime.share(child);
        await readOwnerLine(child);
      }
      if (child.pid === undefined) throw new Error("missing actual child pid");
      return { child, pid: child.pid };
    } catch (error) {
      try { await stop(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "fixture worker acquisition and cleanup failed", { cause: error }); }
      throw error;
    }
  };
  const old = await owner();
  return { ...h, slot, old, now, owner,
    fence: async (input: unknown) => {
      if (old.child.stdin === null) throw new Error("fence owner has no channel");
      old.child.stdin.write(`${JSON.stringify(input)}\n`);
      const line = await readOwnerLine(old.child);
      const parsed = z.object({
        state: z.string().optional(),
        error: z.string().optional(),
        refusal: z.object({ reason: z.string().optional() }).optional(),
      }).parse(JSON.parse(line));
      if (parsed.error !== undefined) throw new Error(parsed.error);
      if (parsed.state === "refused") throw new Error(`fixture fence refused: ${parsed.refusal?.reason ?? "unknown"}`);
      return parsed;
    },
    dispose };
}


export async function attemptingOwnedWrite(h: Pick<Awaited<ReturnType<typeof ownedWorkerLifetimeFixture>>, "database" | "fence">, run: RunRecord) {
  const proof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: run.envelope.runId,
    attempt: run.envelope.attempt, afterPrepareSpanPath: `${run.envelope.traceId}/crm-dates/prepare` };
  const bindingProofDigest = deriveWriteBindingProofDigest(proof);
  const intent = { ...WRITE_INTENT_ATTEMPTING, writeIntentId: randomUUID(), workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId, runId: run.envelope.runId, runAttempt: run.envelope.attempt, bindingProof: proof, bindingProofDigest };
  await h.fence(writeFenceFixtureInput(h.database, { intent, attempt: { ...WRITE_ATTEMPT, writeIntentId: intent.writeIntentId,
    runId: intent.runId, runAttempt: intent.runAttempt, bindingProof: proof, bindingProofDigest } }));
  const stored = h.database.authority.writeIntents.get(intent.writeIntentId);
  if (stored === undefined || stored.status !== "attempting") throw new Error("fixture-write-fence-missing");
  return stored;
}
