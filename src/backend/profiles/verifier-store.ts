import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ProfileIdSchema } from "../../models/profiles/profile.js";
import { encodePrivate } from "../../rules/validation/private-equal.js";
import {
  CREDENTIAL_DIRECTORY_MODE,
  ensureChildDirectory,
  fsyncPath,
  replacePrivateFile,
  writePrivateStage,
} from "../storage/configuration/credential-safe-file.js";
import {
  createSyntheticVerifier,
  emailKey,
  emailMatch,
  lockoutDelayMs,
  passwordMatches,
  type SyntheticVerifier,
} from "./synthetic-verifier.js";

const VerifierRowSchema = z.strictObject({
  profileId: ProfileIdSchema,
  emailKey: z.string().regex(/^[0-9a-f]{64}$/u),
  salt: z.string().regex(/^[0-9a-f]{32}$/u),
  passwordVerifier: z.string().regex(/^[0-9a-f]{64}$/u),
  consecutiveFailures: z.number().int().nonnegative(),
  lockedUntilMs: z.number().int().nonnegative().optional(),
});

const VerifierDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profiles: z.array(VerifierRowSchema),
});

type VerifierDocument = z.infer<typeof VerifierDocumentSchema>;

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
    return VerifierDocumentSchema.parse(JSON.parse(readFileSync(documentPath, "utf8")));
  }

  function write(document: VerifierDocument): void {
    writeBytes(documentPath, encodePrivate(VerifierDocumentSchema.parse(document)));
  }

  function row(profileId: string): z.infer<typeof VerifierRowSchema> {
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
