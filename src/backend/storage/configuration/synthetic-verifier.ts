import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { outermostOperationProof, type OperationProof } from "./credential-safe-file.js";

const SCRYPT_KEY_BYTES = 32;
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const operationDerivations = new WeakMap<OperationProof, Map<string, Buffer>>();

function derivePassword(password: string, salt: Buffer): Buffer {
  const proof = outermostOperationProof();
  if (proof === undefined) return scryptSync(password, salt, SCRYPT_KEY_BYTES, SCRYPT_OPTIONS);
  let derivations = operationDerivations.get(proof);
  if (derivations === undefined) {
    const owned = new Map<string, Buffer>();
    derivations = owned;
    operationDerivations.set(proof, owned);
    proof.release.push(() => {
      for (const bytes of owned.values()) bytes.fill(0);
      owned.clear();
      operationDerivations.delete(proof);
    });
  }
  const key = createHash("sha256").update(JSON.stringify([password, salt.toString("hex")])).digest("hex");
  const existing = derivations.get(key);
  if (existing !== undefined) return existing;
  const derived = scryptSync(password, salt, SCRYPT_KEY_BYTES, SCRYPT_OPTIONS);
  derivations.set(key, derived);
  return derived;
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
