import { z } from "zod";
import type { MutationCapability } from "./driver.js";
import { UcpathContactAddressFieldsSchema } from "../systems/ucpath/emergency-contacts.js";
import type { UcpathContactSet, UcpathEmergencyContactInput, UcpathContactPlan } from "../systems/ucpath/emergency-contacts.js";

export const UcpathContactDisplayedNameSchema = z.literal("ucpath.emergency-contact.displayed-name").brand<"ObservationId">();
export const UCPATH_CONTACT_DISPLAYED_NAME = UcpathContactDisplayedNameSchema.parse("ucpath.emergency-contact.displayed-name");

export class UcpathContactSaveError extends Error {
  constructor(readonly code: "CONTACT_SAVE_UNAVAILABLE" | "saved-effect-mismatch") { super(code); this.name = "UcpathContactSaveError"; }
}

export interface UcpathEmergencyContactDriver {
  readEmergencyContacts(input: Pick<UcpathEmergencyContactInput, "emplId" | "expectedName">): Promise<UcpathContactSet>;
  saveEmergencyContact(input: UcpathEmergencyContactInput & { plan: UcpathContactPlan }, capability: MutationCapability): Promise<UcpathContactSet>;
  stageEmergencyContact(input: UcpathEmergencyContactInput, plan: UcpathContactPlan): Promise<UcpathContactSet>;
}

export type UcpathContactObservations = Readonly<Record<typeof UCPATH_CONTACT_DISPLAYED_NAME, string>>;

export const UcpathContactPageRowSchema = z.strictObject({
  rowIndex: z.number().int().nonnegative(),
  name: z.string(),
  relationship: z.string(),
  primary: z.boolean(),
  phone: z.string(),
  sameAddressAsEmployee: z.boolean(),
  address: UcpathContactAddressFieldsSchema.nullable(),
});
export type UcpathContactPageRow = z.infer<typeof UcpathContactPageRowSchema>;

/** Identity comes from resolved header displays, never the search input. */
export const UcpathContactPageSnapshotSchema = z.strictObject({
  pageStateId: z.string(),
  displayedEid: z.string(),
  displayedName: z.string(),
  observation: z.enum(["persisted", "staged"]),
  view: z.enum(["all", "paged"]),
  totalRows: z.number().int().nonnegative(),
  rows: z.array(UcpathContactPageRowSchema),
  observedAt: z.string(),
});
export type UcpathContactPageSnapshot = z.infer<typeof UcpathContactPageSnapshotSchema>;
