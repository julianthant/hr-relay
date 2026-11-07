import { join } from "node:path";
import { createCredentialStore, type CredentialStoreHooks } from "../../../src/backend/storage/configuration/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, type ProtectedSettingsPatch } from "../../../src/models/config/protected-settings.js";
import { createBoundProfileFixture } from "./admission-fixture.js";

export function createCredentialPersistenceFixtures(roots: string[], firstCommand: string, now: string) {
  const cleanups: (() => Promise<void>)[] = [];
  async function fixture(hooks?: CredentialStoreHooks) {
    const profile = await createBoundProfileFixture();
    roots.push(profile.workspace);
    cleanups.push(() => profile.closeController());
    const store = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot, hooks });
    return { ...profile, tracker: profile.stateRoot, directory: join(profile.stateRoot, "credentials"),
      path: join(profile.stateRoot, "credentials", "protected.json"), store };
  }
  async function releaseFixtures(): Promise<void> {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  }
  function request(input: { readonly commandId: string; readonly writeId: string; readonly expectedRevision: number;
    readonly entries: ProtectedSettingsPatch; readonly updatedAt?: string }) {
    return ProtectedSettingsApplyInputSchema.parse({ ...input, commandFingerprint: input.commandId === firstCommand ? "1".repeat(64) : "2".repeat(64),
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: input.updatedAt ?? now });
  }
  return { fixture, releaseFixtures, request };
}
