/** Every story the gallery page can mount and the check loop iterates. Add a surface's table here. */
import type { CatalogueEntry } from "../story-catalogue.js";
import { INTAKE_STORIES } from "./intake-stories.js";
import { QUEUE_ROW_STORIES } from "./queue-row-stories.js";
import { RUN_DIALOG_STORIES } from "./run-dialog-stories.js";
import { SHELL_STORIES } from "./shell-stories.js";
import { SIGN_IN_STORIES } from "./sign-in-stories.js";

export const CATALOGUE: readonly CatalogueEntry[] = Object.freeze([...QUEUE_ROW_STORIES, ...SHELL_STORIES, ...SIGN_IN_STORIES, ...RUN_DIALOG_STORIES, ...INTAKE_STORIES]);
