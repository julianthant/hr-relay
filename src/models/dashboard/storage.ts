/** The storage doctor wire: a browser-safe projection of the recovery report, built only from a parsed backend report and the same schema objects. */
import { z } from "zod";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import {
  AuthorityUpgradeInspectionSchema,
  BackupHealthSchema,
  BackupServiceStateSchema,
  DoctorAuthorityWireSchema,
  DoctorCountsSchema,
  ProtectedSettingsInspectionSchema,
  RestoreCandidateSchema,
  SpanAuthorityReconciliationSchema,
  StorageRecoveryInspectionSchema,
} from "../storage/storage-status.js";

export const StorageDoctorWireSchema = z.strictObject({
  recovery: StorageRecoveryInspectionSchema,
  mode: z.literal("read-only"),
  authorityUpgrades: AuthorityUpgradeInspectionSchema,
  protectedSettings: ProtectedSettingsInspectionSchema,
  checkedAt: IsoInstantSchema,
  authority: DoctorAuthorityWireSchema,
  counts: DoctorCountsSchema,
  spanAuthority: SpanAuthorityReconciliationSchema,
  backup: BackupHealthSchema,
  restoreCandidates: z.array(RestoreCandidateSchema),
  service: BackupServiceStateSchema,
});
export type StorageDoctorWire = z.infer<typeof StorageDoctorWireSchema>;

export const StorageDoctorLatestWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("never-run") }),
  z.strictObject({ state: z.literal("completed"), report: StorageDoctorWireSchema }),
]);
export type StorageDoctorLatestWire = z.infer<typeof StorageDoctorLatestWireSchema>;
