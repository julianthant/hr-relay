import type { DuoEnrollmentScope } from "../../models/config/duo-credential-store.js";
import type { ProfileOnboardingMethod } from "../../models/profiles/public-profile.js";

export interface DraftDuoAttempt {
  readonly operationId: string;
  readonly profileId: string;
  readonly generation: number;
  readonly attemptId: string;
  readonly method: ProfileOnboardingMethod;
  readonly expiresAt: string;
}

export interface DraftDuoObservedContext {
  readonly contextId: string;
  readonly tabId: number;
  readonly accountId: string;
  readonly origin: string;
  readonly rpId: string;
}

export interface DraftDuoPendingCredential {
  readonly credentialId: string;
  readonly privateKeyPkcs8: string;
  readonly publicKeySpki: string;
  readonly userHandle?: string;
  readonly transport: "internal" | "usb";
  readonly isResidentCredential: boolean;
  readonly createdAt: string;
}

export interface DraftDuoCeremonyReceipt {
  readonly credentialId: string;
  readonly requestId: string;
  readonly mechanism: "fast-duo" | "native-platform";
  readonly softwareInterceptionDisabled: boolean;
}

export interface DraftDuoPortalReceipt {
  readonly credentialId: string;
  readonly requestId: string;
  readonly acceptance: "portal-accepted" | "exact-credential-request";
}

// Issued by the draft owner after observing the owned provider tab. No profile admission is exposed.
export interface DraftDuoCapability {
  readonly attempt: DraftDuoAttempt;
  readonly scope: DuoEnrollmentScope;
  assertCurrent(): void;
  persistPending(credential: DraftDuoPendingCredential): Promise<Readonly<{ revision: number }>>;
  provision(credentialId: string): Promise<Readonly<DraftDuoPendingCredential & { highWater: number }>>;
  reserveSignCount(input: Readonly<{ credentialId: string; attemptId: string }>): Promise<Readonly<{ count: number; revision: number }>>;
  recordCeremony(receipt: DraftDuoCeremonyReceipt): Promise<void>;
  recordPortalAcceptance(receipt: DraftDuoPortalReceipt): Promise<void>;
  retainUnknown(): Promise<void>;
}

export interface ProfileOnboardingDuoProvider {
  start(attempt: DraftDuoAttempt,
    bindObservedContext: (context: DraftDuoObservedContext) => Promise<DraftDuoCapability>): Promise<void>;
  cancel(attempt: DraftDuoAttempt): Promise<Readonly<{ state: "closed" | "uncertain" }>>;
}
