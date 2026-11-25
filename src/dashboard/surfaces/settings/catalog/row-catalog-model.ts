/** Which view a `?catalogView=` link names. Route-owned, like the Archive's `archiveView`. */
export type CatalogView = "vocabulary" | "selectors";

/** A query value this build does not render is dropped rather than trusted. */
export function parseCatalogView(raw: string | null): CatalogView | undefined {
  if (raw === "vocabulary" || raw === "selectors") return raw;
  return undefined;
}
