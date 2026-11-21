/** Every story the gallery page can mount and the check loop iterates. Add a surface's table here. */
import type { CatalogueEntry } from "../story-catalogue.js";
import { QUEUE_ROW_STORIES } from "./queue-row-stories.js";

export const CATALOGUE: readonly CatalogueEntry[] = Object.freeze([...QUEUE_ROW_STORIES]);
