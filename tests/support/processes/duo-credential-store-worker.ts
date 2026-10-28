import { z } from "zod";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createDuoCredentialStore, DuoCredentialCommitUncertainError } from "../../../src/backend/storage/configuration/duo-credential-store.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";

import { manualClock } from "../../../src/rules/time/clock.js";

function reservationCauses(error: unknown) {
  const names = new Set(["Error", "TypeError", "RangeError", "AggregateError", "ZodError", "DuoCredentialCommitUncertainError",
    "CredentialKeyCustodyError", "PrivateFileLockUnavailableError", "RuntimeLifetimeLockReleasedError", "AuthoritySourceClosureUnprovedError"]);
  const reasons = ["duo-publication-pending", "duo-transaction-unissued", "duo-transaction-not-committed", "duo-document-membership-mismatch",
    "duo-document-custody-changed", "duo-publication-file-changed", "duo-publication-prior-changed", "duo-profile-authority-changed",
    "duo-machine-authority-changed", "duo-document-required", "duo-ready-credential-required", "duo-counter-exhausted",
    "profile-registry-publication-busy", "profile-registry-observation-changed", "profile-registry-continuity-mismatch", "directory-integrity"];
  const causes: { name: string; code: string; reason: string }[] = [];
  let current = error;
  for (let depth = 0; depth < 6; depth++) {
    const message = current instanceof Error ? current.message : undefined;
    causes.push({ name: current instanceof Error && names.has(current.name) ? current.name : "unclassified",
      code: current instanceof Error && "code" in current && typeof current.code === "string" && Object.hasOwn(ERROR_CATALOG, current.code) ? current.code : "unclassified",
      reason: message === undefined ? "unclassified" : reasons.find(reason => message.includes(reason)) ?? "unclassified" });
    if (!(current instanceof Error) || current.cause === undefined) break;
    current = current.cause;
  }
  return causes;
}

const [workspace, profileId, credentialId, at, port] = z.tuple([z.string().min(1), z.uuid(), z.string().min(1), z.iso.datetime(), z.coerce.number().int().positive()]).parse(process.argv.slice(2));
const parentStop = new AbortController();
const lifetime = await WorkerRuntimeLifetimeLock.receive(port, () => parentStop.abort(new Error("fixture-parent-disconnected")));
parentStop.signal.throwIfAborted();
const machine = acquireSharedRuntimeAdmission(workspace, lifetime);
const admission = machine.admitProfile(machine.issueRegisteredProfileClaim(profileId));
const store = createDuoCredentialStore(admission, machine, manualClock(new Date(at)));
process.on("message", (input: unknown) => { void command(input).catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; }); });
async function command(input: unknown): Promise<void> {
  const command = z.enum(["reserve", "reserve-then-crash", "interrupt-publication", "close"]).parse(input);
  if (command === "interrupt-publication") {
    try { store.interruptReserve(credentialId); }
    catch (error) {
      if (error instanceof DuoCredentialCommitUncertainError) {
        process.send?.({ type: "uncertain", name: error.name });
        process.exit(97);
      }
      process.send?.({ type: "failed", name: error instanceof Error ? error.name : "unknown" });
      process.exit(96);
    }
    process.send?.({ type: "failed", name: "interrupt-returned" });
    process.exit(96);
  }
  if (command === "close") {
    admission.release(); machine.release();
    if (process.disconnect === undefined) throw new Error('duo-worker-ipc-required');
    await lifetime.close();
    if (process.connected) process.disconnect();
    return;
  }
  try {
    const result = store.reserve(credentialId);
    if (command === "reserve-then-crash") process.exit(23);
    process.send?.({ type: "reserved", ...result });
  } catch (error) {
    process.send?.({ type: "failed", code: "DUO_FIXTURE_RESERVATION_FAILED", phase: command, causes: reservationCauses(error) });
    process.exitCode = 1;
  }
}
parentStop.signal.addEventListener("abort", () => {
  process.exitCode = 1;
  void command("close").catch(error => { setImmediate(() => { throw error; }); });
}, { once: true });
process.send?.({ type: "ready", pid: process.pid });
