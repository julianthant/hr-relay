import { z } from "zod";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createDuoCredentialStore } from "../../../src/backend/storage/configuration/duo-credential-store.js";
import { DuoCredentialCommitUncertainError } from "../../../src/models/failures/errors.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const [workspace, profileId, credentialId, at] = z.tuple([z.string().min(1), z.uuid(), z.string().min(1), z.iso.datetime()]).parse(process.argv.slice(2));
const machine = acquireEntrypointAdmission(workspace, "shared");
const admission = machine.admitProfile(machine.issueRegisteredProfileClaim(profileId));
const store = createDuoCredentialStore(admission, machine, manualClock(new Date(at)));
process.on("message", (input: unknown) => {
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
    process.disconnect();
    return;
  }
  try {
    const result = store.reserve(credentialId);
    if (command === "reserve-then-crash") process.exit(23);
    process.send?.({ type: "reserved", ...result });
  } catch {
    process.send?.({ type: "failed", code: "DUO_FIXTURE_RESERVATION_FAILED" });
    process.exitCode = 1;
  }
});
process.send?.({ type: "ready", pid: process.pid });
