import type { z } from "zod";
import { CANONICAL_FIELDS } from "../../models/fields/registry.js";
import { UsDateSchema } from "../../models/config/schema.js";
import { DateOnlySchema } from "../identity/ids.js";
import { HirePlanSchema, OnboardingReadHirePlan } from "../../models/workflows/onboarding/read-hire-plan.js";
import { rosterHireNames } from "./roster-name.js";

const EMPTY = new Set(["n/a", "na", "n.a.", "none", "-", "--", "null"]);

function clean(value: string): string {
  const trimmed = value.trim();
  return EMPTY.has(trimmed.toLowerCase()) ? "" : trimmed;
}

function dateCode(value: string): string {
  const [month, day, year] = UsDateSchema.parse(value).split("/");
  return DateOnlySchema.parse(`${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

function usDate(value: string): string {
  const [year, month, day] = dateCode(value).split("-");
  return `${String(month)}/${String(day)}/${String(year)}`;
}

export function readHirePlan(input: z.input<typeof OnboardingReadHirePlan.input>): z.infer<typeof HirePlanSchema> {
  const parsed = OnboardingReadHirePlan.input.parse(input);
  if (parsed.roster.binding.rowKey.email.toLowerCase() !== parsed.crm.requestedEmail.toLowerCase()) {
    throw new Error("Roster snapshot row key does not match the CRM subject");
  }
  const raw = parsed.crm.fields;
  const { legal, preferred } = rosterHireNames(parsed.roster.references,
    { firstName: clean(raw.firstName), middleName: clean(raw.middleName), lastName: clean(raw.lastName) });
  const appointment = /^(\d+)\s+\S/u.exec(clean(raw.appointment));
  if (appointment?.[1] === undefined) throw new Error("CRM appointment has no classification number");
  const department = /\((\d{4,6})\)\s*$/u.exec(parsed.crm.department.trim());
  if (department?.[1] === undefined) throw new Error("CRM department has no department number");
  const wage = /^\$(\d+)(?:\.(\d{1,2}))?(?:\s+per\s+hour)?$/iu.exec(clean(raw.wage));
  if (wage?.[1] === undefined) throw new Error("CRM compensation rate is not an hourly dollar amount");
  const hourlyRateMinor = Number(wage[1]) * 100 + Number((wage[2] === undefined ? "" : wage[2]).padEnd(2, "0"));
  const ssn = clean(raw.ssn);
  if (ssn !== "" && !/^\d{3}-\d{2}-\d{4}$/u.test(ssn)) throw new Error("CRM SSN has an invalid format");
  const ssnState = ssn === "" ? "absent" : /^9\d{2}-/u.test(ssn) ? "itin-or-placeholder" : "provided";
  const jobEndDateSource = clean(raw.expectedJobEndDate) === "" ? "configured" : "crm";
  const expectedJobEndDate = usDate(UsDateSchema.parse(jobEndDateSource === "crm" ? clean(raw.expectedJobEndDate) : parsed.configuredJobEndDate));
  const effectiveDate = usDate(clean(raw.effectiveDate));
  if (dateCode(expectedJobEndDate) < dateCode(effectiveDate)) throw new Error("Expected job end date precedes the hire effective date");
  const postalCode = parsed.postalCodeOverride === undefined
    ? clean(raw.postalCode).replace(/^(\d{5})-\d{1,3}$/u, "$1")
    : parsed.postalCodeOverride;
  const dob = clean(raw.dob);
  return HirePlanSchema.parse({
    recordId: parsed.crm.recordId, roster: parsed.roster.binding,
    postalCodeOverride: parsed.postalCodeOverride === undefined ? null : parsed.postalCodeOverride,
    jobEndDateSource, ssnState,
    employee: {
      firstName: legal.firstName, lastName: legal.lastName, middleName: legal.middleName,
      preferredFirstName: preferred.firstName, preferredLastName: preferred.lastName, preferredMiddleName: preferred.middleName,
      ssn: ssnState === "provided" ? CANONICAL_FIELDS.ssn.schema.parse(ssn.replaceAll("-", "")) : null,
      dob: CANONICAL_FIELDS.dob.schema.parse(dateCode(dob)),
      address: clean(raw.address), addressLine2: clean(raw.addressLine2), city: clean(raw.city), state: clean(raw.state), postalCode,
      phone: clean(raw.phone), email: clean(raw.email), positionNumber: clean(raw.positionNumber),
      departmentNumber: department[1], recruitmentNumber: clean(parsed.crm.recruitmentNumber),
      employeeClassification: appointment[1], hourlyRateMinor, effectiveDate, expectedJobEndDate,
    },
  });
}
