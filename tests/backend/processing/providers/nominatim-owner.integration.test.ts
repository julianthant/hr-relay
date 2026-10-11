import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,it } from "vitest";
import { createNominatimService } from "../../../../src/backend/processing/providers/nominatim-owner.js";
import { acquireRuntimeRestoreAdmission,readRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";


const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const request = ProviderRequestEnvelopeSchema.parse({ capability: "geocode.nominatim", payload: { schemaHash: "a".repeat(64), value: { street: "1 Test Road", country: "US" } } });
function root() { const path = mkdtempSync(join(tmpdir(), "relay-nominatim-")); cleanups.push(() => rmSync(path, { recursive: true, force: true })); return path; }
function options(milliseconds = 10_000, controller = new AbortController()) { return { requestId: randomUUID(), signal: controller.signal, deadlineMonotonicMs: systemClock.monotonicMs() + milliseconds }; }
function _message(process: ChildProcess, kind: string): Promise<Record<string, unknown>> {
  return new Promise((done, reject) => {
    const timer = setTimeout(() => { process.removeListener("message", receive); reject(new Error(`synthetic child did not send ${kind}`)); }, 8000);
    const receive = (value: unknown) => { if (typeof value === "object" && value !== null && "kind" in value && value.kind === kind) { clearTimeout(timer); process.removeListener("message", receive); done(value); } };
    process.on("message", receive);
  });
}

it("recovers the same instance after restore refusal and proved startup cleanup without replay", async () => {
  const path = root(); const admission = acquireRuntimeRestoreAdmission({ processLockRoot: path, pid: process.pid }); let calls = 0;
  const service = createNominatimService({ processLockRoot: path, clock: systemClock, adapter: () => { if (++calls === 1) throw new Error("synthetic factory failed before fetch"); return { capability: "geocode.nominatim", invoke: async () => ({ response: { state: "unavailable", reason: { code: "adapter-unavailable", message: "synthetic" } }, evidence: { summary: "synthetic", capturedAt: IsoInstantSchema.parse(systemClock.now().toISOString()) } }) }; } }); cleanups.push(() => service.stop());
  assert.equal((await service.invoke(request, options())).response.state, "unavailable"); assert.equal(calls, 0);
  admission.release(); assert.equal((await service.invoke(request, options())).response.state, "unavailable"); assert.equal(calls, 1);
  assert.equal(readRuntimeProcessLock(path, "geocode")?.releasedAt !== null, true);
  const previous = readRuntimeProcessLock(path, "geocode")?.generation ?? 0;
  await service.invoke(request, options()); assert.equal(calls, 2); assert.ok((readRuntimeProcessLock(path, "geocode")?.generation ?? 0) > previous);
});
