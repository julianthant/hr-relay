import { redactedEvidenceId } from "../../../../rules/redaction/redaction.js";
import { AbsentEvidenceSchema } from "../../../../rules/write-safety/write-safety-primitives.js";
import { IsoInstantSchema, FingerprintSchema, EvidenceRefSchema } from "../../../../rules/identity/ids.js";
import type { z } from "zod";
import type { I9Driver } from "../../../../models/ui/i9.js";
import { I9_PROFILE_STAGED, I9_REMOTE_STAGED, I9_SEARCH_READ, I9_SEARCH_RESULTS, I9ProfileTargetSchema, I9RemoteTargetSchema,
  I9ProfileProofSchema, I9RemoteProofSchema, i9ProfileKey, i9RemoteKey, I9_PROFILE_SUBJECT,
  type I9ProfileTarget, type I9RemoteTarget } from "../../../../models/ui/i9-creation.js";
import type { I9SignerOutput } from "../../../../models/systems/i9/read-section2-signer.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { containsDryRunSample } from "../../../../models/workflow/dry-run.js";
import { deriveIdempotencyKeyDigest } from "../../../../rules/write-safety/write-safety.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";

export function createDeterministicI9Driver(options: Readonly<{
  lookup: I9SignerOutput;
  profiles?: readonly z.infer<typeof I9ProfileProofSchema>[];
  records?: readonly z.infer<typeof I9RemoteProofSchema>[];
  observedName?: string;
  profileSubmitFailure?: Error;
  remoteSubmitFailure?: Error;
  createdProfileId?: string;
  now: string;
}>) {
  const now = IsoInstantSchema.parse(options.now);
  const events: string[] = [];
  const profiles = [...options.profiles ?? []], records = [...options.records ?? []];
  let stagedProfile: I9ProfileTarget | undefined, stagedRemote: I9RemoteTarget | undefined;
  let displayedName: string | undefined;
  const absence = (key: string) => ({ state: "absent" as const,
    evidence: AbsentEvidenceSchema.parse({ idempotencyKeyDigest: deriveIdempotencyKeyDigest("i9", key), source: I9_SEARCH_RESULTS, sourceState: I9_SEARCH_READ,
      observedAt: now, queryDigest: sha256Hex(key), evidenceRef: `observation:${redactedEvidenceId("i9-absence", [key, now])}` }) });
  const prepare = async (steps: readonly string[], capture: () => Promise<void>) => {
    for (const step of steps) { events.push(`prepare:${step}`); await capture(); }
  };
  const driver: I9Driver = {
    system: "i9",
    async readSection2Signer() { events.push("lookup"); return options.lookup; },
    async searchEmployees() { throw new Error("I-9 semantic fixture has no raw search surface"); },
    async readRecordSummary() { throw new Error("I-9 semantic fixture has no raw summary surface"); },
    async read(id) {
      if (id !== I9_PROFILE_SUBJECT || displayedName === undefined || stagedProfile === undefined && stagedRemote === undefined) {
        throw new Error("I-9 fixture has no matching staged subject");
      }
      return displayedName;
    },
    async probeProfile(input) {
      events.push("probe:profile");
      const rows = profiles.filter(row => row.email.toLowerCase() === input.email.toLowerCase() && row.dob === input.dob);
      if (rows.length > 1) return { state: "ambiguous", matches: rows.length, observedAt: now,
        queryDigest: FingerprintSchema.parse(sha256Hex(i9ProfileKey(input))), evidence: rows.map(row => EvidenceRefSchema.parse(`observation:${redactedEvidenceId("i9-match", [row.profileId])}`)) };
      const row = rows[0];
      if (row === undefined) return absence(i9ProfileKey(input));
      if (row.firstName !== input.firstName || row.lastName !== input.lastName || row.departmentNumber !== input.departmentNumber) {
        return { state: "unknown", reason: "profile-identity-mismatch", observedAt: now };
      }
      return { state: "present", proof: I9ProfileProofSchema.parse(row) };
    },
    async prepareProfile(input, capture) {
      stagedProfile = undefined; stagedRemote = undefined;
      const target = I9ProfileTargetSchema.parse(input);
      await prepare(["new-profile", "first-name", "middle-name", "last-name", "ssn", "dob", "email", "worksite", "profile-readback"], capture);
      stagedProfile = target;
      displayedName = options.observedName ?? `${target.firstName} ${target.lastName}`;
      return { stagedPageState: I9_PROFILE_STAGED, observedName: displayedName };
    },
    async saveProfile(capability) {
      assertMintedMutationCapability(capability);
      const target = stagedProfile; if (target === undefined) throw new Error("I-9 fixture profile is not staged");
      stagedProfile = undefined;
      events.push("commit:profile");
      const proof = I9ProfileProofSchema.parse({ kind: "i9-profile", profileId: options.createdProfileId ?? String(900001 + profiles.length),
        firstName: target.firstName, lastName: target.lastName, dob: target.dob, email: target.email,
        departmentNumber: target.departmentNumber, source: "saved-profile-read" });
      profiles.push(proof);
      if (options.profileSubmitFailure !== undefined) throw options.profileSubmitFailure;
      return proof;
    },
    async probeRemote(input) {
      events.push("probe:remote");
      if (containsDryRunSample(input)) throw new Error("A sample must not be probed as a real record");
      const rows = records.filter(row => row.profileId === input.profileId && row.startDate === input.startDate);
      if (rows.length > 1) return { state: "ambiguous", matches: rows.length, observedAt: now,
        queryDigest: FingerprintSchema.parse(sha256Hex(i9RemoteKey(input))), evidence: rows.map(row => EvidenceRefSchema.parse(`observation:${redactedEvidenceId("i9-match", [row.i9Id])}`)) };
      const row = rows[0];
      if (row === undefined) return absence(i9RemoteKey(input));
      if (row.email !== input.email) return { state: "unknown", reason: "record-identity-mismatch", observedAt: now };
      return { state: "present", proof: I9RemoteProofSchema.parse(row) };
    },
    async prepareRemote(input, capture) {
      stagedRemote = undefined; stagedProfile = undefined;
      const target = I9RemoteTargetSchema.parse(input);
      await prepare(["remote-profile", "remote-section1", "remote-start-date", "remote-email-readback"], capture);
      stagedRemote = target;
      displayedName = options.observedName ?? `${target.firstName} ${target.lastName}`;
      return { stagedPageState: I9_REMOTE_STAGED, observedName: displayedName };
    },
    async createRemote(capability) {
      assertMintedMutationCapability(capability);
      const target = stagedRemote; if (target === undefined) throw new Error("I-9 fixture remote record is not staged");
      if (containsDryRunSample(target)) throw new Error("I-9 fixture cannot submit a preview target");
      stagedRemote = undefined;
      events.push("commit:remote");
      const proof = I9RemoteProofSchema.parse({ kind: "i9-remote-record", profileId: target.profileId,
        i9Id: String(900002 + records.length), startDate: target.startDate, email: target.email, source: "i9-record-read" });
      records.push(proof);
      if (options.remoteSubmitFailure !== undefined) throw options.remoteSubmitFailure;
      return proof;
    },
  };
  return Object.assign(driver, { events, profiles, records });
}
