/**
 * **S55's upstream half** — resolving a UCPath department to the EXACT visible
 * text of the Kuali `Department*` option that names it.
 *
 * ## Why this is a fold, and where the other half lives
 *
 * §4e's staged-variables model wants the department to arrive at the write as a
 * VARIABLE: one value, already decided, never recomputed at fill time. So the
 * decision happens here, on data the run already read, and the driver's prepare
 * does only what a driver can do — refuse an option the LIVE control does not
 * offer (`department-option-not-offered`, carrying the complete observed list).
 * Two refusals, two layers, two different facts: "this repository could not name
 * an option" and "the page no longer carries the one we named".
 *
 * ## The code is the key. The description is evidence, not a matcher.
 *
 * Kuali renders every department option as `<6-digit code> - <description>`
 * (live-captured 2026-08-12, `docs/migrations/separations.md` §9.3's S55 list),
 * and that code IS the UCPath dept id. So an exact code match is a real
 * identity, immune to every way two systems spell the same department.
 *
 * Legacy has that tier and then two more (`legacy:src/systems/kuali/navigate.ts:328-400`
 * @ `1bffbd658db34ce84a08e69484db3a40b3658d6e`): UCPath description ⊆ option
 * text, then option name ⊆ UCPath description with a "specific enough" heuristic
 * and a longest-match tiebreak. **Neither ports**, for §4a's reason stated one
 * control over: a bidirectional substring match is what makes a Kuali type of
 * `"Other"` file as *Accepted Another Job*, and a department is the field that
 * decides which unit's separation record this becomes. There is no default arm
 * and no fuzzy tier — an unresolvable department REFUSES, by name.
 *
 * A normalized-exact DESCRIPTION tier is not the safe middle ground it looks
 * like, and is deliberately absent too. UCPath renders `HOUSING/DINING/HOSPITALITY`
 * where Kuali renders `Housing/Dining/Hospitality`, so such a tier is either
 * dead (compare verbatim) or case- and whitespace-insensitive — which is a
 * quieter fuzzy match, not a different kind of match. Both descriptions are
 * carried on the resolution instead, so the operator reading the gate packet
 * sees what UCPath said beside what Kuali offered and can disbelieve it.
 *
 * ## The option text is returned VERBATIM
 *
 * `"000719 -  Supply Chain Services"` really is served with a double space after
 * the dash (legacy ISS-B05, 2026-06-22 — the reason legacy selects by INDEX
 * rather than by label). Reconstructing `<code> - <description>` from the parts
 * would produce a string the control does not carry, and the driver would then
 * refuse the very option it is standing in front of. What comes out of here is
 * one of the strings that went in.
 */
import { z } from "zod";
import type { UcpathJobCell } from "../ui/ucpath-job-summary.js";
import { KualiDepartmentOptionSchema } from "../ui/kuali-separation-finalization.js";

export const DEPARTMENT_OPTION_REFUSAL_CODES = [
  /** The UCPath dept id cell was blank, or is not a numeric code (S24). */
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
    /** What UCPath called this department, rendered exactly as the gate shows it. */
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

/**
 * An absent cell renders as its OWN reason, never as a blank.
 *
 * Same rule and same wording as `job-summary-classification.ts`'s `cellText`:
 * `""` and "the grid rendered this cell empty" are different facts, and a
 * refusal that quoted the first would be describing something that never
 * happened.
 */
function cellText(cell: UcpathJobCell): string {
  return cell.state === "present" ? cell.value : `(unreadable: ${cell.reason})`;
}

/**
 * The leading numeric code of a `"CODE - Name"` option, or `""` when it has none
 * (Kuali's `- - -` sentinel has none, which is why it can never match).
 *
 * Ported from `legacy:src/systems/kuali/navigate.ts:303-309` @ `1bffbd65…`.
 */
export function kualiDepartmentOptionCode(option: string): string {
  return /^\s*(\d+)\s*-/u.exec(option)?.[1] ?? "";
}

/**
 * The description half of a `"CODE - Name"` option, trimmed. Returns `""` when
 * the option is nothing but a code.
 *
 * Ported from `legacy:src/systems/kuali/navigate.ts:294-300` @ `1bffbd65…`,
 * minus its lowercasing: legacy normalizes because it MATCHES on this string,
 * and this one is only ever displayed.
 */
export function kualiDepartmentOptionDescription(option: string): string {
  return option.replace(/^\s*\d+\s*-\s*/u, "").trim();
}

/**
 * Two dept codes name the same department when they are equal as numbers.
 *
 * Ported from legacy's `deptCodesMatch` (`navigate.ts:311-325` @ `1bffbd65…`),
 * which exists so a UCPath `"141"` still matches a Kuali `"000141"`. Both
 * systems serve zero-padded 6-digit codes today; the comparison is padding-
 * agnostic anyway because zero-padding is a rendering choice, not an identity.
 * It is NOT a fuzzy tier: leading zeros are the only difference it tolerates,
 * and a non-numeric string on either side matches nothing.
 */
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

/**
 * Resolve the one Kuali `Department*` option this separation must be staged
 * against, or refuse by name.
 *
 * `observedOptions` is the COMPLETE option list the run read off this document's
 * own control (§3.2 MAP EVERYTHING) — not a captured constant, because a new
 * campus department is a legitimate option this repository has never seen and
 * must not have to be taught about before somebody can be separated.
 */
export function resolveKualiDepartmentOption(input: Readonly<{
  /** The UCPath *Dept ID* cell, with its absent arm (S24). */
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
