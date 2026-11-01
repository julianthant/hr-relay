import { z } from "zod";
import { UcpathContactAddressFieldsSchema } from "../systems/ucpath/emergency-contacts.js";

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
