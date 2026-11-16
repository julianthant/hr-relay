import { createPrivateKey, createPublicKey } from "node:crypto";
import type { BrowserContext, Frame, Page } from "playwright";
import { z } from "zod";
import type { DraftDuoPendingCredential } from "../../profiles/onboarding-duo.js";
import type { DuoPlatformCredential } from "../../storage/configuration/duo-signing.js";

type PlatformPurpose = Readonly<{ purpose: "enrollment" } | { purpose: "login"; credentials: readonly DuoPlatformCredential[] }>;
export type DuoPlatformAuthenticator = Readonly<{
  mechanism: "chromium-platform";
  credential(credentialId: string, rpId: string, createdAt: string): Promise<DraftDuoPendingCredential & { transport: "internal"; initialSignCount: number }>;
}>;
const CounterSchema = z.number().int().min(0).max(0xffff_ffff);
function cdpId(credentialId: string): string {
  const bytes = Buffer.from(credentialId, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== credentialId) throw new Error("duo-platform-credential-scope-changed");
  return bytes.toString("base64");
}

export async function prepareDuoPlatformAuthenticator(context: BrowserContext, page: Page | Frame, input: PlatformPurpose): Promise<DuoPlatformAuthenticator> {
  const session = await context.newCDPSession(page);
  await session.send("WebAuthn.enable");
  const enrollment = input.purpose === "enrollment";
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
    isUserVerified: enrollment, automaticPresenceSimulation: enrollment,
  } });
  if (input.purpose === "login") {
    await session.send("WebAuthn.setResponseOverrideBits", { authenticatorId, isBogusSignature: true });
    for (const credential of input.credentials) {
      await session.send("WebAuthn.addCredential", { authenticatorId, credential: {
        credentialId: cdpId(credential.credentialId), rpId: credential.rpId, privateKey: credential.privateKeyPkcs8,
        isResidentCredential: credential.isResidentCredential, signCount: CounterSchema.parse(credential.signCount),
        ...(credential.userHandle === undefined ? {} : { userHandle: credential.userHandle }),
      } });
    }
  }
  let exported = false;
  return { mechanism: "chromium-platform", async credential(credentialId, rpId, createdAt) {
    if (!enrollment || exported) throw new Error("duo-platform-credential-already-handed-off");
    exported = true;
    const credentialIdBase64 = cdpId(credentialId);
    // Existing native requests must not bypass the canonical signer.
    await session.send("WebAuthn.setResponseOverrideBits", { authenticatorId, isBogusSignature: true });
    await session.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
    await session.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
    const { credential } = await session.send("WebAuthn.getCredential", { authenticatorId, credentialId: credentialIdBase64 });
    if (credential.credentialId !== credentialIdBase64 || credential.rpId !== rpId) throw new Error("duo-platform-credential-scope-changed");
    const initialSignCount = CounterSchema.parse(credential.signCount);
    const key = createPrivateKey({ key: Buffer.from(credential.privateKey, "base64"), format: "der", type: "pkcs8" });
    return { credentialId, privateKeyPkcs8: credential.privateKey,
      publicKeySpki: createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64"),
      ...(credential.userHandle === undefined ? {} : { userHandle: credential.userHandle }),
      transport: "internal", isResidentCredential: credential.isResidentCredential, createdAt, initialSignCount };
  } };
}
