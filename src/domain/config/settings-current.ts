import { z } from "zod";
import {
  CommandAuditIdSchema,
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
} from "../ids.js";

/** The exact latest settings result committed with its command journal and audit. */
export const SettingsCurrentRecordSchema = z.strictObject({
  revision: PositiveIntSchema,
  settingsFingerprint: FingerprintSchema,
  commandId: CommandIdSchema,
  commandFingerprint: FingerprintSchema,
  auditId: CommandAuditIdSchema,
  committedAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (record.revision < 2) {
    context.addIssue({
      code: "custom",
      path: ["revision"],
      message: "settings current authority begins at the first applied revision 2",
    });
  }
});

export type SettingsCurrentRecord = z.infer<typeof SettingsCurrentRecordSchema>;
