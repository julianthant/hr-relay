/** Resolving a UCPath department to the EXACT visible text of the Kuali `Department*` option that names it: the 6-digit code is the key, and an unresolvable department refuses by name. */
import { z } from "zod";
import type { UcpathJobCell } from "../../models/ui/ucpath-job-summary.js";
import { KualiDepartmentOptionSchema } from "../../models/ui/kuali-separation-finalization.js";

export const DEPARTMENT_OPTION_REFUSAL_CODES = [
  /** The UCPath department ID is blank or nonnumeric. */
  "department-code-unreadable",
  /** No option on the live control carries that dept id. */
  "department-code-not-offered",
  /** Two or more options carry it, so "the" option does not exist. */
  "department-option-ambiguous",
  /** An option matched and its text cannot be staged (the blank sentinel, padding, non-ASCII). */
  "department-option-unusable",
] as const;
export const DepartmentOptionRefusalCodeSchema = z.enum(DEPARTMENT_OPTION_REFUSAL_CODES);
export type DepartmentOptionRefusalCode = z.infer<typeof DepartmentOptionRefusalCodeSchema>;

export const DepartmentOptionResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("resolved"),
    /** The option's visible text, VERBATIM — the value the driver will select. */
    option: KualiDepartmentOptionSchema,
    /** The option's own leading code, as the control rendered it. */
    departmentCode: z.string().regex(/^\d+$/u),
    /** The option's text after `<code> - `, so the two names can be compared by a human. */
    optionDescription: z.string().min(1),
    /** What UCPath called this department, retained exactly in the identity packet. */
    ucpathDepartment: z.string().min(1),
    /** How many options the control carried — §3.2's evidence, and the drift signal. */
    observedOptionCount: z.number().int().positive(),
  }),
  z.strictObject({
    state: z.literal("refused"),
    code: DepartmentOptionRefusalCodeSchema,
    reason: z.string().min(1),
  }),
]);
export type DepartmentOptionResolution = z.infer<typeof DepartmentOptionResolutionSchema>;

/** An absent cell renders as its OWN reason, never as a blank: `""` and "the grid rendered this cell empty" are different facts. */
function cellText(cell: UcpathJobCell): string {
  return cell.state === "present" ? cell.value : `(unreadable: ${cell.reason})`;
}

/** The leading numeric code of a `"CODE - Name"` option, or `""` when it has none (Kuali's `- - -` sentinel has none, which is why it can never match). */
export function kualiDepartmentOptionCode(option: string): string {
  return /^\s*(\d+)\s*-/u.exec(option)?.[1] ?? "";
}

/** The description half of a `"CODE - Name"` option, trimmed; the option text is only ever displayed, so it is not lowercased for matching. */
export function kualiDepartmentOptionDescription(option: string): string {
  return option.replace(/^\s*\d+\s*-\s*/u, "").trim();
}

/** Two dept codes name the same department when they are equal as numbers, so a zero-padded code matches its unpadded spelling; this is NOT a fuzzy tier. */
export function sameDepartmentCode(left: string, right: string): boolean {
  const canonical = (value: string): string | undefined => {
    const trimmed = value.trim();
    if (!/^\d+$/u.test(trimmed)) return undefined;
    return trimmed.replace(/^0+(?=\d)/u, "");
  };
  const a = canonical(left);
  const b = canonical(right);
  return a !== undefined && a === b;
}

/** Resolve the one Kuali `Department*` option this separation must be staged against, against the COMPLETE option list the run read off this document's own control. */
export function resolveKualiDepartmentOption(input: Readonly<{
  /** Preserve the department read's absent arm. */
  deptId: UcpathJobCell;
  /** The UCPath *Department* description cell, with its absent arm. */
  department: UcpathJobCell;
  observedOptions: readonly string[];
}>): DepartmentOptionResolution {
  const ucpathDepartment = cellText(input.department);
  if (input.deptId.state === "absent") {
    return DepartmentOptionResolutionSchema.parse({
      state: "refused",
      code: "department-code-unreadable",
      reason: `UCPath did not render a Dept ID for this employment (${input.deptId.reason}), and the `
        + `Kuali Department option is keyed by it. The department UCPath did show is `
        + `${JSON.stringify(ucpathDepartment)}; matching on that text instead is the substring tier `
        + "§4a deleted. Refusing to name a department for a real separation record.",
    });
  }
  const code = input.deptId.value.trim();
  if (!/^\d+$/u.test(code)) {
    return DepartmentOptionResolutionSchema.parse({
      state: "refused",
      code: "department-code-unreadable",
      reason: `UCPath rendered ${JSON.stringify(input.deptId.value)} as this employment's Dept ID, `
        + "which is not a numeric department code. Kuali keys every Department option by that code, so "
        + "there is nothing to match on.",
    });
  }

  const matches = input.observedOptions.filter(
    (option) => sameDepartmentCode(kualiDepartmentOptionCode(option), code),
  );
  if (matches.length === 0) {
    return DepartmentOptionResolutionSchema.parse({
      state: "refused",
      code: "department-code-not-offered",
      reason: `no Kuali Department option carries UCPath dept id ${JSON.stringify(code)} `
        + `(${JSON.stringify(ucpathDepartment)}). The control offered `
        + `${String(input.observedOptions.length)}: ${JSON.stringify(input.observedOptions)}. `
        + "Refusing to guess one by name — a wrong department on a filed separation is invisible to "
        + "everyone downstream.",
    });
  }
  if (matches.length > 1) {
    return DepartmentOptionResolutionSchema.parse({
      state: "refused",
      code: "department-option-ambiguous",
      reason: `${String(matches.length)} Kuali Department options carry UCPath dept id `
        + `${JSON.stringify(code)}: ${JSON.stringify(matches)}. One dept id names one department, so a `
        + "control offering it twice is a control this run does not understand.",
    });
  }

  const option = matches[0] ?? "";
  const parsed = KualiDepartmentOptionSchema.safeParse(option);
  if (!parsed.success) {
    return DepartmentOptionResolutionSchema.parse({
      state: "refused",
      code: "department-option-unusable",
      reason: `the Kuali Department option for dept id ${JSON.stringify(code)} is `
        + `${JSON.stringify(option)}, which cannot be staged as a form value: `
        + `${parsed.error.issues.map((issue) => issue.message).join("; ")}.`,
    });
  }
  const optionDescription = kualiDepartmentOptionDescription(option);
  if (optionDescription.length === 0) {
    return DepartmentOptionResolutionSchema.parse({
      state: "refused",
      code: "department-option-unusable",
      reason: `the Kuali Department option for dept id ${JSON.stringify(code)} is `
        + `${JSON.stringify(option)} — a code with no department name after it. An option a human `
        + "cannot read at the gate is not one this run will stage.",
    });
  }

  return DepartmentOptionResolutionSchema.parse({
    state: "resolved",
    option: parsed.data,
    departmentCode: kualiDepartmentOptionCode(option),
    optionDescription,
    ucpathDepartment,
    observedOptionCount: input.observedOptions.length,
  });
}
