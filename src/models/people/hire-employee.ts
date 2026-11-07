import { z } from "zod";
import { CANONICAL_FIELDS } from "../fields/registry.js";
import { UsDateSchema } from "../config/schema.js";

export const HireEmployeeSchema = z.strictObject({
  firstName: z.string().min(1), lastName: z.string().min(1), middleName: z.string(),
  preferredFirstName: z.string().min(1), preferredLastName: z.string().min(1), preferredMiddleName: z.string(),
  ssn: CANONICAL_FIELDS.ssn.schema.nullable(), dob: CANONICAL_FIELDS.dob.schema,
  address: z.string().min(1), addressLine2: z.string(), city: z.string().min(1),
  state: CANONICAL_FIELDS.state.schema, postalCode: CANONICAL_FIELDS.postalCode.schema,
  phone: z.string(), email: z.email(), positionNumber: z.string().min(1),
  departmentNumber: z.string().regex(/^\d{4,6}$/u), recruitmentNumber: z.string(),
  employeeClassification: z.string().regex(/^\d+$/u),
  hourlyRateMinor: z.number().int().positive(), effectiveDate: UsDateSchema, expectedJobEndDate: UsDateSchema,
});
export type HireEmployee = z.infer<typeof HireEmployeeSchema>;

