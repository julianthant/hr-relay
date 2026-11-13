import { fsyncPath, replacePrivateFile, writePrivateStage } from "../private-path.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ProfileVerifierDocumentSchema } from "../../../models/profiles/profile.js";
import { encodePrivate } from "../../../rules/validation/private-equal.js";
import { sameDirectory, fileIdentityObservation, readPrivateFile, CREDENTIAL_DIRECTORY_MODE, ensureChildDirectory } from "./credential-safe-file.js";
import {
  createSyntheticVerifier,
  emailKey,
  emailMatch,
  lockoutDelayMs,
  passwordMatches,
  type SyntheticVerifier,
} from "./synthetic-verifier.js";


type VerifierDocument = z.infer<typeof ProfileVerifierDocumentSchema>;
export interface PreparedProfileVerifier { readonly profileId: string; }
const preparedVerifiers = new WeakMap<PreparedProfileVerifier, { root: string; row: VerifierDocument["profiles"][number]; pepper: Buffer; pepperFile: Readonly<{ device: number | string; inode: number | string; digest: string }>; assertCurrent(): void }>();
export function verifyPreparedProfileVerifier(witness: PreparedProfileVerifier, machineRoot: string, profileId: string, expectedEmailKey: string) {
  const issued = preparedVerifiers.get(witness);
  if (issued === undefined || issued.root !== machineRoot || issued.row.profileId !== profileId || issued.row.emailKey !== expectedEmailKey) throw new Error("profile-verifier-publication-unissued");
  issued.assertCurrent(); return issued.row;
}
export function preparedProfileVerifierPepperWitness(witness: PreparedProfileVerifier, machineRoot: string, profileId: string, expectedEmailKey: string) {
  verifyPreparedProfileVerifier(witness, machineRoot, profileId, expectedEmailKey);
  const issued = preparedVerifiers.get(witness);
  if (issued === undefined) throw new Error("profile-verifier-publication-unissued");
  return Object.freeze({ ...issued.pepperFile });
}
export function assertPreparedProfileVerifierInput(witness: PreparedProfileVerifier, email: string, password: string): void {
  const issued = preparedVerifiers.get(witness);
  if (issued === undefined) throw new Error("profile-verifier-publication-unissued");
  issued.assertCurrent();
  if (emailKey(issued.pepper, email) !== issued.row.emailKey || !passwordMatches(password, issued.row)) throw new Error("profile-verifier-protected-input-mismatch");
}


export function createProfileVerifiers(machineRoot: string) {
  const directory = join(machineRoot, "machine");
  const pepperPath = join(directory, "profile-pepper");
  const documentPath = join(directory, "profile-verifiers.json");

  function ensureMachine(): void {
    ensureChildDirectory(machineRoot, directory, "profile verifiers", CREDENTIAL_DIRECTORY_MODE, CREDENTIAL_DIRECTORY_MODE);
  }

  function writeBytes(path: string, bytes: Uint8Array): void {
    const stage = join(directory, `.verifier.${randomUUID()}.tmp`);
    try {
      writePrivateStage(stage, bytes);
      replacePrivateFile(stage, path);
      fsyncPath(directory);
    } finally {
      if (existsSync(stage)) rmSync(stage);
    }
  }

  function pepper(): Buffer {
    ensureMachine();
    if (!existsSync(pepperPath)) writeBytes(pepperPath, randomBytes(32));
    const loaded = readFileSync(pepperPath);
    if (loaded.byteLength !== 32) throw new Error("profile pepper is malformed");
    return loaded;
  }

  function read(): VerifierDocument {
    ensureMachine();
    if (!existsSync(documentPath)) return { schemaVersion: 1, profiles: [] };
    return ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(documentPath, "utf8")));
  }

  function write(document: VerifierDocument): void {
    writeBytes(documentPath, encodePrivate(ProfileVerifierDocumentSchema.parse(document)));
  }

  function row(profileId: string): z.infer<typeof ProfileVerifierDocumentSchema>["profiles"][number] {
    const found = read().profiles.find((entry) => entry.profileId === profileId);
    if (found === undefined) throw new Error("profile verifier is missing");
    return found;
  }

  return Object.freeze({
    identify(email: string): "unknown" | { readonly profileId: string } {
      return emailMatch(read().profiles, pepper(), email);
    },
    emailKeyFor(email: string): string {
      return emailKey(pepper(), email);
    },
    prepare(profileId: string, email: string, password: string): PreparedProfileVerifier {
      const created = createSyntheticVerifier(pepper(), email, password);
      const document = readPrivateFile(documentPath, { label: "lock", maxBytes: 1_048_576 }), sourcePepper = readPrivateFile(pepperPath, { label: "lock", maxBytes: 32 });
      if (document === undefined || sourcePepper === undefined || sourcePepper.bytes.length !== 32) throw new Error("profile-verifier-source-required");
      const current = ProfileVerifierDocumentSchema.parse(JSON.parse(document.bytes.toString("utf8")));
      if (current.profiles.some(entry => entry.profileId === profileId || entry.emailKey === created.emailKey)) throw new Error("profile verifier already exists");
      const row = ProfileVerifierDocumentSchema.shape.profiles.element.parse({ profileId, ...created, consecutiveFailures: 0 });
      const assertCurrent = () => {
        for (const [path, before] of [[documentPath, document], [pepperPath, sourcePepper]] as const) {
          const after = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
          if (after === undefined || !sameDirectory(after.identity, before.identity)
            || createHash("sha256").update(after.bytes).digest("hex") !== createHash("sha256").update(before.bytes).digest("hex")) throw new Error("profile-verifier-publication-source-changed");
        }
      };
      const witness = Object.freeze({ profileId });
      preparedVerifiers.set(witness, { root: machineRoot, row: Object.freeze(row), pepper: sourcePepper.bytes,
        pepperFile: { ...fileIdentityObservation(sourcePepper.identity, { preserveSafeNumbers: true }), digest: createHash("sha256").update(sourcePepper.bytes).digest("hex") }, assertCurrent });
      assertCurrent(); return witness;
    },
    save(profileId: string, email: string, password: string): void {
      const created = createSyntheticVerifier(pepper(), email, password);
      const current = read();
      if (current.profiles.some((entry) => entry.profileId === profileId || entry.emailKey === created.emailKey)) {
        throw new Error("profile verifier already exists");
      }
      write({
        schemaVersion: 1,
        profiles: [...current.profiles, {
          profileId,
          emailKey: created.emailKey,
          salt: created.salt,
          passwordVerifier: created.passwordVerifier,
          consecutiveFailures: 0,
        }],
      });
    },
    /** Derive a profile's replacement login row now. `swap` replaces only that row and clears its failures; `landed` reads back whether the swap took effect. */
    prepareLoginChange(profileId: string, email: string, password: string): { swap(): void; landed(): boolean } {
      const created = createSyntheticVerifier(pepper(), email, password);
      return Object.freeze({
        swap() {
          const current = read();
          if (current.profiles.some(entry => entry.profileId !== profileId && entry.emailKey === created.emailKey)) throw new Error("profile verifier email is taken");
          if (!current.profiles.some(entry => entry.profileId === profileId)) throw new Error("profile verifier is missing");
          write({ schemaVersion: 1, profiles: current.profiles.map(entry => entry.profileId === profileId
            ? { profileId, emailKey: created.emailKey, salt: created.salt, passwordVerifier: created.passwordVerifier, consecutiveFailures: 0 } : entry) });
        },
        landed() {
          const current = row(profileId);
          return current.emailKey === created.emailKey && current.salt === created.salt && current.passwordVerifier === created.passwordVerifier;
        },
      });
    },
    passwordMatches(profileId: string, password: string): boolean {
      const current = row(profileId);
      const verifier: SyntheticVerifier = {
        emailKey: current.emailKey,
        salt: current.salt,
        passwordVerifier: current.passwordVerifier,
      };
      return passwordMatches(password, verifier);
    },
    locked(profileId: string, nowMs: number): boolean {
      const until = row(profileId).lockedUntilMs;
      return until !== undefined && nowMs < until;
    },
    recordFailure(profileId: string, nowMs: number): void {
      const current = read();
      const profiles = current.profiles.map((entry) => {
        if (entry.profileId !== profileId) return entry;
        const consecutiveFailures = entry.consecutiveFailures + 1;
        const delay = lockoutDelayMs(consecutiveFailures);
        return {
          ...entry,
          consecutiveFailures,
          ...(delay > 0 ? { lockedUntilMs: nowMs + delay } : {}),
        };
      });
      write({ schemaVersion: 1, profiles });
    },
    clearFailures(profileId: string): void {
      const current = read();
      write({
        schemaVersion: 1,
        profiles: current.profiles.map((entry) => entry.profileId === profileId
          ? { profileId: entry.profileId, emailKey: entry.emailKey, salt: entry.salt, passwordVerifier: entry.passwordVerifier, consecutiveFailures: 0 }
          : entry),
      });
    },
  });
}
