import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { z } from "zod";
import type { Fingerprint } from "../../../rules/identity/ids.js";

const EncodedSchema = z.string().min(1).max(16_384).regex(/^[A-Za-z0-9+/_-]+={0,2}$/u).refine(value =>
  [Buffer.from(value, "base64").toString("base64"), Buffer.from(value, "base64").toString("base64url")].includes(value));
export const DuoAssertionRequestSchema = z.strictObject({
  requestId: z.uuid(), credentialId: EncodedSchema,
  rpId: z.literal("duosecurity.com"), challenge: EncodedSchema,
  origin: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && url.origin === value
      && (url.hostname === "duosecurity.com" || url.hostname.endsWith(".duosecurity.com"));
  }),
});
export const DuoWorkflowRequestSchema = DuoAssertionRequestSchema.omit({ credentialId: true }).extend({
  allowCredentials: z.array(EncodedSchema).max(1000), accountNames: z.array(z.string().min(1).max(128)).max(20),
});
export type DuoWorkflowRequest = z.infer<typeof DuoWorkflowRequestSchema>;
export type DuoAssertionRequest = z.infer<typeof DuoAssertionRequestSchema>;
export interface DuoPublicCredential {
  readonly credentialId: string;
  readonly rpId: "duosecurity.com";
  readonly transport: "internal" | "usb";
  readonly userHandle?: string;
  readonly isResidentCredential: boolean;
}
export interface DuoAssertion {
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;
  readonly credentialId: string;
  readonly userHandle: string | null;
  readonly transport: "internal" | "usb";
  readonly signCount: number;
}
export interface DuoSigningSource {
  assertCurrent(): void;
  identity(): Fingerprint;
  credentials(): readonly DuoPublicCredential[];
  sign(request: DuoAssertionRequest): Promise<DuoAssertion>;
}

export function validateDuoKeyPair(privateKeyPkcs8: string, publicKeySpki: string): void {
  for (const value of [privateKeyPkcs8, publicKeySpki]) if (Buffer.from(value, "base64").toString("base64") !== value) throw new Error("duo-key-encoding-invalid");
  const key = createPrivateKey({ key: Buffer.from(privateKeyPkcs8, "base64"), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    || !createPublicKey(key).export({ format: "der", type: "spki" }).equals(Buffer.from(publicKeySpki, "base64"))) throw new Error("duo-key-pair-invalid");
}

export function createDuoAssertion(
  material: Readonly<{ privateKeyPkcs8: string; credentialId: string; transport: "internal" | "usb"; userHandle?: string }>,
  request: DuoAssertionRequest,
  count: number,
): DuoAssertion {
  const parsed = DuoAssertionRequestSchema.parse(request);
  if (parsed.credentialId !== material.credentialId || !Number.isInteger(count) || count < 1 || count > 0xffff_ffff) throw new Error("duo-signature-input-invalid");
  const challenge = Buffer.from(parsed.challenge, "base64");
  if (challenge.length === 0 || challenge.length > 4096) throw new Error("duo-challenge-invalid");
  const authenticatorData = Buffer.alloc(37);
  createHash("sha256").update(parsed.rpId).digest().copy(authenticatorData);
  authenticatorData[32] = 0x05;
  authenticatorData.writeUInt32BE(count, 33);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: challenge.toString("base64url"), origin: parsed.origin, crossOrigin: false }));
  const key = createPrivateKey({ key: Buffer.from(material.privateKeyPkcs8, "base64"), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("duo-key-invalid");
  const signature = sign("sha256", Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]), { key, dsaEncoding: "der" });
  return { authenticatorData: authenticatorData.toString("base64"), clientDataJSON: clientDataJSON.toString("base64"), signature: signature.toString("base64"),
    credentialId: material.credentialId, userHandle: material.userHandle ?? null, transport: material.transport, signCount: count };
}
