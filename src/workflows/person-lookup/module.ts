/**
 * The server composition value for person-lookup: the bundle-safe descriptor
 * plus the lazy store loaders the daemon needs (doc 02 §1.2).
 *
 * The split is what keeps `descriptor.ts` client-safe. This module may reach
 * into stores; the descriptor may not, and the coverage guard walks its import
 * graph to prove it.
 *
 * All three implementing stores land with 1f. The control registry verifies at boot that every
 * descriptor contract resolves through one of these exact factory-defined stores.
 */
import { defineWorkflowRole } from "../../domain/workflow/module-role.js";
import { defineIntakeProjection } from "../../domain/intake/projection.js";
import { CANONICAL_FIELDS } from "../../domain/fields/registry.js";
import { crmStore } from "../../stores/crm/index.js";
import { personLookupStore } from "../../stores/person-lookup/index.js";
import { ucpathStore } from "../../stores/ucpath/index.js";
import { personLookupDescriptor, PersonLookupInput } from "./descriptor.js";

/**
 * The first real intake projection (doc 06 §2.7, D172) — a spreadsheet of
 * people fanning out one lookup per row.
 *
 * **Two targets, and deliberately only two.** `emplId` and `name` are the whole
 * of what a roster row says about a person; `keepNonHdh` and `includeCrmDates`
 * are execution options, recorded as `execution-option` in
 * `config/canonical-field-inventory.json` precisely because they describe the
 * RUN rather than the subject. Binding a spreadsheet column to one would let a
 * file decide whether this system reads CRM.
 *
 * **Neither target is `required`, and that is the union telling the truth.**
 * `PersonLookupInput` accepts `{name}` or `{emplId, name?}`, so no single path
 * is present in every valid input — and a projection that claimed otherwise
 * would reject, with `unmapped-required`, rows the workflow itself accepts. The
 * combination is still enforced: §5's pipeline parses every assembled row
 * through this exact schema, so a row carrying neither identifier is rejected
 * with the schema's own words rather than passed on.
 *
 * It is declared HERE, on the server module, rather than on the descriptor, so
 * it stays out of `contractFingerprint` — an operator-facing mapping surface is
 * not part of the contract a run replays against (D170).
 */
export const personLookupIntake = defineIntakeProjection(PersonLookupInput, {
  emplId: CANONICAL_FIELDS.eid,
  name: CANONICAL_FIELDS.fullName,
});

export const personLookupModule = Object.freeze({
  descriptor: personLookupDescriptor,
  stores: Object.freeze([ucpathStore, crmStore, personLookupStore]),
  intake: personLookupIntake,
  // An ordinary workflow that stands on its own — no composition owns it (D219).
  role: defineWorkflowRole({ kind: "standalone" }),
});
