import { join } from "node:path";
import { z } from "zod";
import { AutomaticRepairNoticeWireSchema, type AutomaticRepairNoticeWire } from "../../../models/dashboard/storage.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { readPrivateFile } from "../configuration/credential-safe-file.js";
import { hasUnprovedSourceClosure } from "../source-closure.js";

const RepairRecordSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), profileId: z.uuid(), operationId: z.uuid(),
  backupTime: z.iso.datetime(), restoredAt: z.iso.datetime(), authorityGeneration: z.number().int().nonnegative(),
  manifestFileName: z.string().regex(/^authority-g\d+-\d+-[0-9a-f-]{36}(?:\.shutdown)?\.sqlite\.manifest\.json$/u) });

export function readAutomaticRepairNotice(input: RuntimeAdmission): AutomaticRepairNoticeWire {
  const admission = requireRuntimeAdmission(input); admission.assertProfileRuntime();
  try {
    const context = admission.readInstallationContext(), binding = admission.profileBinding;
    if (context === undefined) throw new Error("automatic-repair-notice-installation-required");
    const file = readPrivateFile(join(context.workspace, ".tracker", "control", `automatic-repair-${binding.profileId}.json`), { label: "lock", maxBytes: 64_000 });
    if (file === undefined) return { state: "none" };
    const record = RepairRecordSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
    if (record.installationId !== binding.installationId || record.profileId !== binding.profileId || Date.parse(record.backupTime) > Date.parse(record.restoredAt)) throw new Error("automatic-repair-notice-binding-invalid");
    admission.assertProfileRuntime();
    return AutomaticRepairNoticeWireSchema.parse({ state: "restored", backupTime: record.backupTime, restoredAt: record.restoredAt });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); throw error; }
    return { state: "unavailable", message: ERROR_CATALOG.STORAGE_AUTOMATIC_REPAIR_NOTICE_UNAVAILABLE.text };
  }
}
