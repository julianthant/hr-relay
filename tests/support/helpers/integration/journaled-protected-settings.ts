import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { ProtectedSettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import type { CredentialStore } from "../../../../src/models/config/credential-store.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import type { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";

/** Publish synthetic credentials through the real independent store and marked audit door. */
export function journalProtectedSettings(
  database: AuthorityDatabase,
  store: CredentialStore,
  entries: z.infer<typeof ProtectedSettingsCommandRequestSchema>["payload"]["entries"],
  now = "2026-08-28T12:00:00.000Z",
): void {
  const command = ProtectedSettingsCommandRequestSchema.parse({
    commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "settings-surface",
    family: "settings", type: "apply-protected-settings", target: { expectedRevision: store.read().revision },
    payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries },
  });
  const result = executeSettingsCommand({ authority: database, clock: manualClock(new Date(now)), ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(() => { throw new Error("protected fixture reached ordinary settings"); }, store) }, command);
  if (result.state !== "applied") throw new Error("synthetic protected publication refused");
}
