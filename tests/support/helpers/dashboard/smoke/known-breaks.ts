/** Records the rules today's dashboard breaks in a surface's stories, each with the ticket that fixes it. A break that shows only at some
 * widths names them; a plain rule name applies at every width. A story the table does not name has none. */
import type { StateRuleName } from "./state-rule-limits.js";
import type { CatalogueEntry } from "./story-catalogue.js";

export type KnownBreak = StateRuleName | readonly [StateRuleName, ...number[]];

export function withKnownBreaks(entries: readonly CatalogueEntry[], surface: string, ticket: string, table: Readonly<Record<string, readonly KnownBreak[]>>): readonly CatalogueEntry[] {
  const unknown = Object.keys(table).filter(key => !entries.some(entry => entry.id === `${surface}/${key}`));
  if (unknown.length > 0) throw new Error(`The ${surface} break table names stories that do not exist: ${unknown.join(", ")}.`);
  return entries.map(entry => {
    const breaks = table[entry.id.slice(surface.length + 1)];
    if (breaks === undefined) return entry;
    const rules = breaks.map(item => typeof item === "string" ? { rule: item, widths: undefined } : { rule: item[0], widths: item.slice(1) as readonly number[] });
    const narrow = rules.filter(item => item.widths !== undefined && item.widths.length > 0);
    return { ...entry, story: { ...entry.story,
      knownFailures: Object.fromEntries(rules.map(item => [item.rule, ticket])),
      ...(narrow.length === 0 ? {} : { knownFailureWidths: Object.fromEntries(narrow.map(item => [item.rule, item.widths])) }) } };
  });
}
