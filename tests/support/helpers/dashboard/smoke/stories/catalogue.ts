/** Every story the gallery page can mount and the check loop iterates. Add a surface's table here. */
import type { CatalogueEntry } from "../story-catalogue.js";
import { COMMAND_NOTICE_STORIES } from "./command-notice-stories.js";
import { EXPLORER_STORIES } from "./explorer-stories.js";
import { SPREADSHEETS_STORIES } from "./spreadsheets-stories.js";
import { ASSISTANT_STORIES } from "./assistant-stories.js";
import { ASSISTANT_REPLY_PARTS_STORIES } from "./assistant-reply-parts-stories.js";
import { ANALYTICS_STORIES } from "./analytics-stories.js";
import { INTAKE_STORIES } from "./intake-stories.js";
import { NOTIFICATIONS_STORIES } from "./notifications-stories.js";
import { QUEUE_ROW_STORIES } from "./queue-row-stories.js";
import { RUN_DIALOG_STORIES } from "./run-dialog-stories.js";
import { RUN_PANEL_STORIES } from "./run-panel-stories.js";
import { SESSIONS_STORIES } from "./sessions-stories.js";
import { SETTINGS_STORIES } from "./settings-stories.js";
import { SHELL_STORIES } from "./shell-stories.js";
import { SIGN_IN_STORIES } from "./sign-in-stories.js";

export const CATALOGUE: readonly CatalogueEntry[] = Object.freeze([...QUEUE_ROW_STORIES, ...SHELL_STORIES, ...SIGN_IN_STORIES, ...RUN_PANEL_STORIES, ...RUN_DIALOG_STORIES, ...INTAKE_STORIES, ...SETTINGS_STORIES, ...SESSIONS_STORIES, ...NOTIFICATIONS_STORIES,
  ...EXPLORER_STORIES, ...ANALYTICS_STORIES, ...ASSISTANT_STORIES, ...ASSISTANT_REPLY_PARTS_STORIES, ...SPREADSHEETS_STORIES, ...COMMAND_NOTICE_STORIES]);
