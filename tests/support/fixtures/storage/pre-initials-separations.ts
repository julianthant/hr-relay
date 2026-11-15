import { z } from "zod";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { JsonValueSchema, type JsonValue } from "../../../../src/rules/validation/canonical-json.js";

/** Canonical-input hash of the last Separations input built before the stored Timekeeper initials. */
export const PRE_INITIALS_CANONICAL_INPUT_HASH = "9139ca6501ab707e3c47dfe55fcc89741dfc53dda0b783a7afb8ee2c2e1ee77d";
/** Its profile-name-domain predecessor ("generation 1"). */
export const NAME_DOMAIN_CANONICAL_INPUT_HASH = "66dc2f33bf56808164be764f921a1e5a2a95afd5e0a7b760fdba687ee81575dc";
/** `deriveSchemaHash(SeparationsInput, "input")` as the last pre-initials build stamped it on a run's ingress. */
export const PRE_INITIALS_INGRESS_HASH = "6f758be309a16f5c63e5d19e1d13b39e1cdb2a8f2926a62a0416e7ca0d7f7bd0";
/** Its profile-name-domain predecessor. */
export const NAME_DOMAIN_INGRESS_HASH = "a41fa298a2fd74d2b4e16eef959ea032868cf4c9bfaf2f00e3393257eac1717a";
/** The letters the pre-initials build derived from the composition fixture's timekeeper name; written literally, never derived. */
export const PRE_INITIALS_TIMEKEEPER_INITIALS = "DT";

const GENERATIONS = Object.freeze({
  "pre-initials": Object.freeze({ canonical: PRE_INITIALS_CANONICAL_INPUT_HASH, ingress: PRE_INITIALS_INGRESS_HASH }),
  "name-domain": Object.freeze({ canonical: NAME_DOMAIN_CANONICAL_INPUT_HASH, ingress: NAME_DOMAIN_INGRESS_HASH }),
});
export type PreInitialsGeneration = keyof typeof GENERATIONS;

/** A current Separations run as the earlier build stored it: no `timekeeperInitials` in the canonical value, and that generation's pinned hashes. Everything else is kept. */
export function preInitialsSeparationsRun(run: RunRecord, generation: PreInitialsGeneration): RunRecord {
  const { timekeeperInitials: _initials, ...value } = z.record(z.string(), z.unknown()).parse(run.input.parsed.value);
  const hashes = GENERATIONS[generation];
  return RunRecordSchema.parse({ ...run, input: { ...run.input, ingressSchemaHash: hashes.ingress,
    parsed: { ...run.input.parsed, schemaHash: hashes.canonical, value } } });
}

/** The commit's scope input when that build executed the write: the stored value plus the letters it derived at execution time. */
export function preInitialsExecutionInput(run: RunRecord): JsonValue {
  return JsonValueSchema.parse({ ...z.record(z.string(), z.unknown()).parse(run.input.parsed.value), timekeeperInitials: PRE_INITIALS_TIMEKEEPER_INITIALS });
}

/** A reconciled-dates comment as that build signed it: the trailing `-<initials>` carries the derived letters. */
export function preInitialsSignedComment(comment: string): string {
  return comment.replace(/-[A-Z]{1,8}$/u, `-${PRE_INITIALS_TIMEKEEPER_INITIALS}`);
}
