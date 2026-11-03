import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { outermostOperationProof, type OperationProof } from "./credential-safe-file.js";

const SCRYPT_KEY_BYTES = 32;
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
type PasswordDerivation = Readonly<{ password: Buffer; salt: Buffer; derived: Buffer }>;
const operationDerivations = new WeakMap<OperationProof, PasswordDerivation[]>();

function derivePassword(password: string, salt: Buffer): Buffer {
  const proof = outermostOperationProof();
  if (proof === undefined) return scryptSync(password, salt, SCRYPT_KEY_BYTES, SCRYPT_OPTIONS);
  let derivations = operationDerivations.get(proof);
  if (derivations === undefined) {
    const owned: PasswordDerivation[] = [];
    derivations = owned;
    operationDerivations.set(proof, owned);
    proof.release.push(() => {
      for (const entry of owned) {
        entry.password.fill(0); entry.salt.fill(0); entry.derived.fill(0);
      }
      owned.length = 0;
      operationDerivations.delete(proof);
    });
  }
  const input = Buffer.from(password, "utf8");
  try {
    const existing = derivations.find(entry => entry.salt.equals(salt) && entry.password.byteLength === input.byteLength
      && timingSafeEqual(entry.password, input));
    if (existing !== undefined) return existing.derived;
    const derived = scryptSync(password, salt, SCRYPT_KEY_BYTES, SCRYPT_OPTIONS);
    derivations.push({ password: Buffer.from(input), salt: Buffer.from(salt), derived });
    return derived;
  } finally { input.fill(0); }
}

export interface SyntheticVerifier {
  readonly emailKey: string;
  readonly salt: string;
  readonly passwordVerifier: string;
}

function normalizeEmail(email: string): string {
  const normalized = email.normalize("NFKC").trim().toLowerCase();
  if (normalized.length === 0 || normalized !== email.trim().toLowerCase()) {
    throw new Error("profile email is not a plain address");
  }
  return normalized;
}

export function emailKey(pepper: Uint8Array, email: string): string {
  return createHmac("sha256", pepper).update(normalizeEmail(email)).digest("hex");
}

export function createSyntheticVerifier(pepper: Uint8Array, email: string, password: string): SyntheticVerifier {
  if (password.length === 0) throw new Error("profile password is empty");
  const salt = randomBytes(16);
  const verifier = derivePassword(password, salt);
  return { emailKey: emailKey(pepper, email), salt: salt.toString("hex"), passwordVerifier: verifier.toString("hex") };
}

export function passwordMatches(password: string, verifier: SyntheticVerifier): boolean {
  const actual = derivePassword(password, Buffer.from(verifier.salt, "hex"));
  const expected = Buffer.from(verifier.passwordVerifier, "hex");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export function lockoutDelayMs(consecutiveFailures: number): number {
  if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 0) {
    throw new Error("profile lockout count is invalid");
  }
  if (consecutiveFailures < 5) return 0;
  const steps = Math.min(consecutiveFailures - 5, 4);
  return 60_000 * (2 ** steps);
}

export function emailMatch(
  records: readonly { readonly profileId: string; readonly emailKey: string }[],
  pepper: Uint8Array,
  email: string,
): "unknown" | { readonly profileId: string } {
  const key = emailKey(pepper, email);
  const matches = records.filter((record) => record.emailKey === key);
  if (matches.length === 0) return "unknown";
  if (matches.length > 1) throw new Error("profile email key is not unique");
  const match = matches[0];
  if (match === undefined) return "unknown";
  return { profileId: match.profileId };
}

export function acceptChangedPassword(): "unavailable" {
  return "unavailable";
}
