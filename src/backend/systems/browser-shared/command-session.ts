import type { Page } from "playwright";
import type { Config } from "../../../models/config/schema.js";
import type { ProtectedSecretSource } from "../../../models/config/secrets.js";
import type { DuoCeremonyGate, DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import type { DuoSigningSource } from "../../storage/configuration/duo-signing.js";
import type { AuthenticatedApplicationEvidence } from "./login-contract.js";

export interface CommandBrowserInput {
  readonly commandId: string;
  readonly requestDigest: string;
  readonly signal: AbortSignal;
  readonly config: Config;
  readonly protectedSecrets: ProtectedSecretSource;
  readonly duo?: DuoSigningSource;
  readonly assertCurrent: () => void;
}
export interface CommandBrowserContext {
  readonly page: Page;
  readonly signal: AbortSignal;
  readonly assertCurrent: () => void;
  readonly credentials: Readonly<{ userId: string; password: string }>;
  readonly duoCeremony: DuoCeremonyGate;
  readonly withDuoSigningScope: <T>(token: DuoCeremonyLeaseToken, body: () => Promise<T>) => Promise<T>;
  readonly recordEvidence: (evidence: AuthenticatedApplicationEvidence) => void;
  readonly assertDuoCurrent: () => void;
  readonly acquisitionRemainingMs: () => number;
}
export interface CommandBrowserScope {
  readonly signal: AbortSignal;
  readonly assertCurrent: () => void;
  withBrowser<T>(use: (browser: CommandBrowserContext) => Promise<T>): Promise<T>;
}
export interface CommandBrowserCommands {
  withCommand<T>(input: CommandBrowserInput, body: (scope: CommandBrowserScope) => Promise<T>): Promise<T>;
}
