import { canonicalJsonStringify } from "../validation/canonical-json.js";

export function resolveWorksheetRows<Row>(rows: readonly Row[], values: (row: Row) => unknown) {
  const [first, ...rest] = rows;
  if (first === undefined) return { state: "missing" } as const;
  const signature = canonicalJsonStringify(values(first));
  return rest.every(row => canonicalJsonStringify(values(row)) === signature)
    ? { state: "resolved", row: first } as const
    : { state: "ambiguous", rows } as const;
}
