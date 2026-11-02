import { createPrivateKey, createPublicKey } from "node:crypto";
import type { BrowserContext, Frame, Page } from "playwright";
import { z } from "zod";
import type { DraftDuoPendingCredential } from "../../profiles/onboarding-duo.js";

export type OnboardingPlatformAuthenticator =
  | Readonly<{ mechanism: "native-platform" }>
  | Readonly<{ mechanism: "chromium-platform"; credential(credentialId: string, rpId: string, createdAt: string): Promise<DraftDuoPendingCredential> }>;

export async function prepareOnboardingPlatformAuthenticator(context: BrowserContext, page: Page | Frame): Promise<OnboardingPlatformAuthenticator> {
  const available = z.boolean().parse(await page.evaluate(async () => typeof PublicKeyCredential === "function"
    && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  if (available) return { mechanism: "native-platform" };
  const session = await context.newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  return { mechanism: "chromium-platform", async credential(credentialId, rpId, createdAt) {
    const result = await session.send("WebAuthn.getCredential", { authenticatorId, credentialId });
    const credential = result.credential;
    if (credential.credentialId !== credentialId || credential.rpId !== rpId) throw new Error("onboarding-platform-credential-scope-changed");
    const key = createPrivateKey({ key: Buffer.from(credential.privateKey, "base64"), format: "der", type: "pkcs8" });
    return { credentialId, privateKeyPkcs8: credential.privateKey,
      publicKeySpki: createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64"),
      ...(credential.userHandle === undefined ? {} : { userHandle: credential.userHandle }),
      transport: "internal", isResidentCredential: credential.isResidentCredential, createdAt };
  } };
}
